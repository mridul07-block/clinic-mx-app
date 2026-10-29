-- PAT-10 review: the follow ups are fixed at discharge and each is open only in its own window.
-- The discharge trigger writes one `follow_up_schedule` row per interval as the setting stood then,
-- with the job; what is due is read from these rows, so a later change of the setting moves
-- nothing scheduled. A follow up is due from its day until the next one's day (the last for
-- `links.follow_up_days`), so a missed one lapses and never comes back once a later one is due or
-- answered. Recommended defaults chosen under the user's standing approval, 29 October 2026
-- (DECISION PAT-10; docs/runbooks/feedback.md).

CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.follow_up_schedule
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint

-- Those who check patients in read the schedule of episodes at their centres; nobody signed in
-- writes it; Velyx support stays read only.
CREATE POLICY follow_up_schedule_read ON public.follow_up_schedule FOR SELECT TO authenticated
  USING (
    (SELECT internal.jwt_checks_in())
    AND EXISTS (SELECT 1 FROM public.episode e
      WHERE e.id = follow_up_schedule.episode_id AND internal.jwt_sees_centre(e.centre_id))
  );--> statement-breakpoint
CREATE POLICY support_read_only_insert ON public.follow_up_schedule AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.follow_up_schedule AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.follow_up_schedule AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.follow_up_schedule FROM authenticated;--> statement-breakpoint

-- Each scheduled follow up of a discharged episode: its interval, its day, the day its window
-- closes (the next one's day; the last after `links.follow_up_days`), and whether it is answered.
DROP FUNCTION internal.follow_ups_of(uuid) CASCADE;--> statement-breakpoint
CREATE FUNCTION internal.follow_ups_of(p_episode_id uuid)
RETURNS TABLE (follow_up text, due_on date, closes_on date, answered boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT f.follow_up, f.due_on,
    coalesce(
      lead(f.due_on) OVER (ORDER BY f.due_on, f.follow_up),
      f.due_on + coalesce(
        (SELECT (s.value #>> '{}')::int FROM public.setting s WHERE s.key = 'links.follow_up_days'),
        7
      )
    ),
    EXISTS (
      SELECT 1 FROM public.feedback a
      WHERE a.episode_id = f.episode_id AND a.survey_key = 'follow_up'
        AND a.answers ->> 'follow_up' = f.follow_up
    )
  FROM public.follow_up_schedule f
  JOIN public.episode e ON e.id = f.episode_id AND e.status = 'discharged'
  WHERE f.episode_id = p_episode_id
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.follow_ups_of(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.follow_ups_of(uuid) TO authenticated, clinic_patient;--> statement-breakpoint

-- The follow up a link answers now: the one whose window holds today (IST), when unanswered.
CREATE OR REPLACE FUNCTION internal.follow_up_due(p_episode_id uuid) RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT f.follow_up FROM internal.follow_ups_of(p_episode_id) f
  WHERE NOT f.answered
    AND f.due_on <= (now() AT TIME ZONE 'Asia/Kolkata')::date
    AND (now() AT TIME ZONE 'Asia/Kolkata')::date < f.closes_on
  ORDER BY f.due_on DESC
  LIMIT 1
$$;--> statement-breakpoint

-- The desk: whom for, the follow up due now (null when none), and the next one's day.
CREATE OR REPLACE FUNCTION internal.follow_up_check_target(p_episode_id uuid)
RETURNS TABLE (patient_id uuid, due text, next_on date)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT e.patient_id, internal.follow_up_due(e.id),
    (SELECT min(f.due_on) FROM internal.follow_ups_of(e.id) f
      WHERE f.due_on > (now() AT TIME ZONE 'Asia/Kolkata')::date)
  FROM public.episode e
  WHERE e.id = p_episode_id AND e.status = 'discharged'
    AND coalesce((SELECT internal.jwt_checks_in()), false)
    AND internal.jwt_sees_centre(e.centre_id)
$$;--> statement-breakpoint

-- The desk's follow up links: re-made, as dropping follow_ups_of took the policy's chain with it.
DROP POLICY IF EXISTS patient_link_follow_up_issue ON public.patient_link;--> statement-breakpoint
CREATE POLICY patient_link_follow_up_issue ON public.patient_link FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT internal.jwt_checks_in())
    AND purpose = 'follow_up'
    AND EXISTS (SELECT 1 FROM public.episode e
      WHERE e.id = episode_id AND e.patient_id = patient_link.patient_id
        AND internal.jwt_sees_centre(e.centre_id))
    AND internal.follow_up_due(episode_id) IS NOT NULL
  );--> statement-breakpoint

-- OUT-10, OUT-11, PAT-09 as before; PAT-10's follow ups: each scheduled, and its job queued.
CREATE OR REPLACE FUNCTION internal.episode_discharged_follow_up() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  days integer;
  at_time time;
  follow_time time;
  closed_day date;
  step jsonb;
  due date;
BEGIN
  UPDATE public.appointment a
    SET status = 'cancelled', change_reason = 'clinic', changed_at = now(),
      changed_by = NEW.discharged_by, updated_at = now()
    WHERE a.episode_id = NEW.id AND a.status IN ('booked', 'confirmed') AND a.starts_at > now();
  UPDATE public.task t
    SET status = 'closed', decision = 'Closed automatically: the episode was discharged.',
      closed_by = NEW.discharged_by, closed_at = now(),
      assignee_staff_user_id = coalesce(t.assignee_staff_user_id, NEW.discharged_by),
      updated_at = now()
    WHERE t.episode_id = NEW.id AND t.kind = 'review.lost_to_follow_up' AND t.status = 'open';
  -- OUT-11: the discharge report and its WhatsApp message, once there was a signed consultation.
  IF EXISTS (
    SELECT 1 FROM public.consultation c WHERE c.episode_id = NEW.id AND c.status = 'signed'
  ) THEN
    INSERT INTO public.job (kind, payload, idempotency_key)
    VALUES ('documents.discharge_report', jsonb_build_object('episodeId', NEW.id),
      'discharge_report:' || NEW.id)
    ON CONFLICT (idempotency_key) DO NOTHING;
    INSERT INTO public.job (kind, payload, idempotency_key)
    VALUES ('whatsapp.discharge_report', jsonb_build_object('episodeId', NEW.id),
      'whatsapp.discharge_report:' || NEW.id)
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;
  closed_day := (coalesce(NEW.closed_at, now()) AT TIME ZONE 'Asia/Kolkata')::date;
  -- PAT-09: the review request, to every discharged patient, never filtered: the set day after
  -- discharge (IST) at the set time.
  SELECT (s.value #>> '{}')::int INTO days
    FROM public.setting s WHERE s.key = 'feedback.review_request_days';
  SELECT (s.value #>> '{}')::time INTO at_time
    FROM public.setting s WHERE s.key = 'feedback.review_request_time';
  INSERT INTO public.job (kind, payload, run_at, idempotency_key)
  VALUES ('whatsapp.review_request', jsonb_build_object('episodeId', NEW.id),
    greatest(
      ((closed_day + coalesce(days, 1)) + coalesce(at_time, time '10:00'))
        AT TIME ZONE 'Asia/Kolkata',
      now()
    ),
    'whatsapp.review_request:' || NEW.id)
  ON CONFLICT (idempotency_key) DO NOTHING;
  -- PAT-10: each follow up after discharge, scheduled and queued on its day at the set time (IST).
  SELECT (s.value #>> '{}')::time INTO follow_time
    FROM public.setting s WHERE s.key = 'engagement.follow_up_time';
  FOR step IN
    SELECT i.value FROM public.setting s CROSS JOIN jsonb_array_elements(s.value) i
    WHERE s.key = 'engagement.follow_ups_after_discharge'
  LOOP
    due := (closed_day + CASE step ->> 'unit'
        WHEN 'month' THEN make_interval(months => (step ->> 'count')::int)
        ELSE make_interval(weeks => (step ->> 'count')::int)
      END)::date;
    INSERT INTO public.follow_up_schedule (episode_id, follow_up, due_on)
    VALUES (NEW.id, (step ->> 'count') || '_' || (step ->> 'unit'), due)
    ON CONFLICT (episode_id, follow_up) DO NOTHING;
    INSERT INTO public.job (kind, payload, run_at, idempotency_key)
    VALUES ('whatsapp.follow_up_check',
      jsonb_build_object('episodeId', NEW.id, 'count', (step ->> 'count')::int,
        'unit', step ->> 'unit'),
      greatest((due + coalesce(follow_time, time '10:00')) AT TIME ZONE 'Asia/Kolkata', now()),
      'whatsapp.follow_up_check:' || NEW.id || ':' || (step ->> 'count') || '_' || (step ->> 'unit'))
    ON CONFLICT (idempotency_key) DO NOTHING;
  END LOOP;
  RETURN NULL;
END;
$$;

-- PAT-10: follow ups after discharge and recurrence (PRD J7.4: "Follow ups at 2 weeks, 6 weeks, 3
-- months and 12 months with Doing well, Some pain, Injured again"; J7.5: ""Injured again" records a
-- recurrence and alerts the consultant"; PRD section 7; TAD jobs). Recommended defaults chosen under
-- the user's standing approval, 29 October 2026 (DECISION PAT-10; docs/runbooks/feedback.md).
-- Discharging an episode queues one `whatsapp.follow_up_check` per interval in
-- `engagement.follow_ups_after_discharge`, on that day after discharge at `engagement.follow_up_time`
-- IST; WA-06 sends them. Until then the desk shows the due one as a QR. The patient answers each
-- interval once through a `follow_up` link; the answer is the record, and Injured again gives the
-- consultant who discharged the episode a high review task (the Centre Managers when they are no
-- longer active). A new linked episode still opens through the health form and SCH-14.

SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint
INSERT INTO public.setting (key, value, updated_by) VALUES
  ('engagement.follow_up_time', '"10:00"', 'system:migration'),
  ('links.follow_up_days', '7', 'system:migration')
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint
SELECT set_config('audit.actor', '', false);--> statement-breakpoint

-- Each follow up of a discharged episode: its interval ("2_week"), the IST day it is due, and
-- whether it is answered. From the setting as it stands.
CREATE OR REPLACE FUNCTION internal.follow_ups_of(p_episode_id uuid)
RETURNS TABLE (follow_up text, due_on date, answered boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT (i.value ->> 'count') || '_' || (i.value ->> 'unit'),
    ((e.closed_at AT TIME ZONE 'Asia/Kolkata')::date
      + CASE i.value ->> 'unit'
          WHEN 'month' THEN make_interval(months => (i.value ->> 'count')::int)
          ELSE make_interval(weeks => (i.value ->> 'count')::int)
        END)::date,
    EXISTS (
      SELECT 1 FROM public.feedback f
      WHERE f.episode_id = e.id AND f.survey_key = 'follow_up'
        AND f.answers ->> 'follow_up' = (i.value ->> 'count') || '_' || (i.value ->> 'unit')
    )
  FROM public.episode e
  CROSS JOIN public.setting s
  CROSS JOIN jsonb_array_elements(s.value) i
  WHERE e.id = p_episode_id AND e.status = 'discharged' AND e.closed_at IS NOT NULL
    AND s.key = 'engagement.follow_ups_after_discharge'
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.follow_ups_of(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.follow_ups_of(uuid) TO authenticated, clinic_patient;--> statement-breakpoint

-- The follow up a link answers now: the newest one due (today IST or before) and unanswered.
CREATE OR REPLACE FUNCTION internal.follow_up_due(p_episode_id uuid) RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT f.follow_up FROM internal.follow_ups_of(p_episode_id) f
  WHERE NOT f.answered AND f.due_on <= (now() AT TIME ZONE 'Asia/Kolkata')::date
  ORDER BY f.due_on DESC
  LIMIT 1
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.follow_up_due(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.follow_up_due(uuid) TO authenticated, clinic_patient;--> statement-breakpoint

-- OUT-10, OUT-11 and PAT-09 as before; PAT-10 adds the follow ups, each its own job.
CREATE OR REPLACE FUNCTION internal.episode_discharged_follow_up() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  days integer;
  at_time time;
  follow_time time;
  closed_day date;
  step jsonb;
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
  -- PAT-10: each follow up after discharge, on its day at the set time (IST).
  SELECT (s.value #>> '{}')::time INTO follow_time
    FROM public.setting s WHERE s.key = 'engagement.follow_up_time';
  FOR step IN
    SELECT i.value FROM public.setting s CROSS JOIN jsonb_array_elements(s.value) i
    WHERE s.key = 'engagement.follow_ups_after_discharge'
  LOOP
    INSERT INTO public.job (kind, payload, run_at, idempotency_key)
    VALUES ('whatsapp.follow_up_check',
      jsonb_build_object('episodeId', NEW.id, 'count', (step ->> 'count')::int,
        'unit', step ->> 'unit'),
      greatest(
        ((closed_day + CASE step ->> 'unit'
            WHEN 'month' THEN make_interval(months => (step ->> 'count')::int)
            ELSE make_interval(weeks => (step ->> 'count')::int)
          END)::date + coalesce(follow_time, time '10:00')) AT TIME ZONE 'Asia/Kolkata',
        now()
      ),
      'whatsapp.follow_up_check:' || NEW.id || ':' || (step ->> 'count') || '_' || (step ->> 'unit'))
    ON CONFLICT (idempotency_key) DO NOTHING;
  END LOOP;
  RETURN NULL;
END;
$$;--> statement-breakpoint

-- What the page's link answers for. A feedback link: after the consultation, at discharge, or after
-- the first treatment, as before. A follow up link (PAT-10): its discharged episode's newest due,
-- unanswered follow up, kept with the episode's centre and the consultant who discharged it.
DROP POLICY feedback_patient_answer ON public.feedback;--> statement-breakpoint
DROP FUNCTION internal.feedback_subject();--> statement-breakpoint
CREATE FUNCTION internal.feedback_subject()
RETURNS TABLE (
  survey_key public.feedback_survey_key, patient_id uuid, episode_id uuid, appointment_id uuid,
  consultation_id uuid, centre_id uuid, physio_id uuid, follow_up text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH link AS (
    SELECT l.patient_id, l.appointment_id, l.episode_id, l.purpose
    FROM public.patient_link l
    WHERE l.id = internal.jwt_patient_link_id()
      AND l.purpose IN ('feedback', 'follow_up')
      AND l.revoked_at IS NULL AND l.completed_at IS NULL AND l.expires_at > now()
  )
  SELECT 'post_consultation'::public.feedback_survey_key, link.patient_id, c.episode_id, a.id,
    c.id, a.centre_id, c.physio_id, NULL::text
  FROM link
  JOIN public.appointment a ON a.id = link.appointment_id AND a.patient_id = link.patient_id
  JOIN public.consultation c ON c.appointment_id = a.id AND c.status = 'signed'
  WHERE link.purpose = 'feedback'
    AND NOT EXISTS (SELECT 1 FROM public.feedback f WHERE f.consultation_id = c.id)
  UNION ALL
  SELECT 'discharge'::public.feedback_survey_key, link.patient_id, e.id, NULL::uuid, NULL::uuid,
    e.centre_id, e.discharged_by, NULL::text
  FROM link
  JOIN public.episode e ON e.id = link.episode_id AND e.patient_id = link.patient_id
  WHERE link.purpose = 'feedback' AND e.status = 'discharged'
    AND NOT EXISTS (
      SELECT 1 FROM public.feedback f WHERE f.episode_id = e.id AND f.survey_key = 'discharge'
    )
  UNION ALL
  SELECT 'first_treatment'::public.feedback_survey_key, link.patient_id, s.episode_id, a.id,
    NULL::uuid, a.centre_id, s.physio_id, NULL::text
  FROM link
  JOIN public.appointment a ON a.id = link.appointment_id AND a.patient_id = link.patient_id
  JOIN public.session s ON s.appointment_id = a.id AND s.number = 1 AND s.status = 'signed'
  WHERE link.purpose = 'feedback'
    AND internal.first_treatment_episode(s.episode_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.feedback f
      WHERE f.episode_id = s.episode_id AND f.survey_key = 'first_treatment'
    )
  UNION ALL
  SELECT 'follow_up'::public.feedback_survey_key, link.patient_id, e.id, NULL::uuid, NULL::uuid,
    e.centre_id, e.discharged_by, internal.follow_up_due(e.id)
  FROM link
  JOIN public.episode e ON e.id = link.episode_id AND e.patient_id = link.patient_id
  WHERE link.purpose = 'follow_up' AND e.status = 'discharged'
    AND internal.follow_up_due(e.id) IS NOT NULL
  LIMIT 1
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.feedback_subject() FROM PUBLIC, anon, authenticated;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.feedback_subject() TO clinic_patient;--> statement-breakpoint

-- The patient writes their answers once, for exactly that subject and survey (and follow up), now.
CREATE POLICY feedback_patient_answer ON public.feedback FOR INSERT TO clinic_patient
  WITH CHECK (
    patient_link_id = (SELECT internal.jwt_patient_link_id())
    AND submitted_at = now()
    AND EXISTS (
      SELECT 1 FROM internal.feedback_subject() s
      WHERE s.survey_key = feedback.survey_key
        AND s.patient_id = feedback.patient_id
        AND s.episode_id = feedback.episode_id
        AND s.appointment_id IS NOT DISTINCT FROM feedback.appointment_id
        AND s.consultation_id IS NOT DISTINCT FROM feedback.consultation_id
        AND s.centre_id = feedback.centre_id
        AND s.physio_id IS NOT DISTINCT FROM feedback.physio_id
        AND s.follow_up IS NOT DISTINCT FROM (feedback.answers ->> 'follow_up')
    )
  );--> statement-breakpoint

-- The page's own follow up link, still working, completes once its answer is in.
CREATE POLICY patient_link_patient_complete_follow_up ON public.patient_link FOR UPDATE
  TO clinic_patient
  USING (
    id = (SELECT internal.jwt_patient_link_id())
    AND purpose = 'follow_up'
    AND completed_at IS NULL
    AND revoked_at IS NULL
    AND expires_at > now()
  )
  WITH CHECK (
    id = (SELECT internal.jwt_patient_link_id())
    AND completed_at = now()
    AND (SELECT internal.feedback_submitted(id))
  );--> statement-breakpoint

-- Until WhatsApp sends them (WA-06), the desk shows the follow up as a QR on a discharged episode's
-- plan and payment sheet: whom for, the follow up due now (null when none), and the day of the next
-- one; for those who check in at the episode's centre.
CREATE OR REPLACE FUNCTION internal.follow_up_check_target(p_episode_id uuid)
RETURNS TABLE (patient_id uuid, due text, next_on date)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT e.patient_id, internal.follow_up_due(e.id),
    (SELECT min(f.due_on) FROM internal.follow_ups_of(e.id) f
      WHERE NOT f.answered AND f.due_on > (now() AT TIME ZONE 'Asia/Kolkata')::date)
  FROM public.episode e
  WHERE e.id = p_episode_id AND e.status = 'discharged'
    AND coalesce((SELECT internal.jwt_checks_in()), false)
    AND internal.jwt_sees_centre(e.centre_id)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.follow_up_check_target(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.follow_up_check_target(uuid) TO authenticated;--> statement-breakpoint

-- Those who check patients in read and issue follow up links for discharged episodes at their
-- centres, for the episode's own patient, while a follow up is due.
CREATE POLICY patient_link_follow_up_read ON public.patient_link FOR SELECT TO authenticated
  USING (
    (SELECT internal.jwt_checks_in())
    AND purpose = 'follow_up'
    AND EXISTS (SELECT 1 FROM public.episode e
      WHERE e.id = episode_id AND e.patient_id = patient_link.patient_id
        AND internal.jwt_sees_centre(e.centre_id))
  );--> statement-breakpoint
CREATE POLICY patient_link_follow_up_issue ON public.patient_link FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT internal.jwt_checks_in())
    AND purpose = 'follow_up'
    AND EXISTS (SELECT 1 FROM public.episode e
      WHERE e.id = episode_id AND e.patient_id = patient_link.patient_id
        AND internal.jwt_sees_centre(e.centre_id))
    AND internal.follow_up_due(episode_id) IS NOT NULL
  );--> statement-breakpoint

-- Injured again records a recurrence and alerts the consultant: a high review task for the
-- consultant who discharged the episode, or the centre's Centre Managers when that consultant is
-- no longer active. Runs as the patient's own insert (audited as them); SECURITY DEFINER, as
-- patients add no task themselves. The task names no patient in its details.
CREATE OR REPLACE FUNCTION internal.feedback_injured_again() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  consultant uuid;
BEGIN
  SELECT s.id INTO consultant FROM public.staff_user s
    WHERE s.id = NEW.physio_id AND s.active;
  INSERT INTO public.task (kind, title, details, priority, assignee_staff_user_id, assignee_role,
    centre_id, patient_id, episode_id)
  VALUES ('review.injured_again', 'Injured again after discharge',
    jsonb_build_object('feedbackId', NEW.id, 'followUp', NEW.answers ->> 'follow_up'), 'high',
    consultant, CASE WHEN consultant IS NULL THEN 'centre_manager'::public.staff_role END,
    NEW.centre_id, NEW.patient_id, NEW.episode_id);
  RETURN NULL;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.feedback_injured_again() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER feedback_injured_again AFTER INSERT ON public.feedback
  FOR EACH ROW
  WHEN (NEW.survey_key = 'follow_up' AND NEW.answers ->> 'since_discharge' = 'injured_again')
  EXECUTE FUNCTION internal.feedback_injured_again();--> statement-breakpoint

-- The Centre Manager's alerts (DSH-03): open Injured again reviews join the open clinical reviews.
CREATE OR REPLACE FUNCTION internal.manager_alert_counts()
RETURNS TABLE (centre_id uuid, item text, n bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
BEGIN
  IF NOT internal.reads_dashboards() THEN
    RAISE EXCEPTION 'The dashboards are for the Super Admin and Centre Managers'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
  WITH counts AS (
    SELECT e.centre_id,
      CASE
        WHEN r.status = 'raised' AND r.display = 'emergency' THEN 'red_flags_emergency'
        WHEN r.status = 'raised' THEN 'red_flags_raised'
        WHEN r.status = 'reviewed' THEN 'red_flags_reviewed'
        ELSE 'red_flags_referred'
      END AS item,
      count(*) AS n
    FROM public.red_flag_alert r
    JOIN public.episode e ON e.id = r.episode_id
    WHERE r.status <> 'closed'
    GROUP BY 1, 2
    UNION ALL
    SELECT a.centre_id, 'unsigned_notes', count(*)
    FROM (
      SELECT c.appointment_id FROM public.consultation c WHERE c.status = 'draft'
      UNION ALL
      SELECT s.appointment_id FROM public.session s WHERE s.status = 'draft'
    ) d
    JOIN public.appointment a ON a.id = d.appointment_id
    GROUP BY 1
    UNION ALL
    SELECT e.centre_id, 'reassessments_awaiting', count(*)
    FROM public.reassessment r
    JOIN public.episode e ON e.id = r.episode_id
    WHERE r.signed_at IS NULL
    GROUP BY 1
    UNION ALL
    SELECT t.centre_id, 'reviews_open', count(*)
    FROM public.task t
    WHERE t.kind IN ('review.new_symptoms', 'review.adverse_event', 'review.adverse_event_director',
        'review.worsening', 'review.still_sore', 'review.injured_again')
      AND t.status <> 'closed' AND t.centre_id IS NOT NULL
    GROUP BY 1
    UNION ALL
    SELECT t.centre_id, 'reviews_overdue', count(*)
    FROM public.task t
    WHERE t.kind = 'review.overdue' AND t.status <> 'closed' AND t.centre_id IS NOT NULL
    GROUP BY 1
    UNION ALL
    SELECT t.centre_id, 'service_recovery', count(*)
    FROM public.task t
    WHERE t.kind = 'feedback.service_recovery' AND t.status <> 'closed'
      AND t.centre_id IS NOT NULL
    GROUP BY 1
    UNION ALL
    SELECT e.centre_id,
      CASE e.status WHEN 'on_hold' THEN 'episodes_on_hold' ELSE 'episodes_lost' END,
      count(*)
    FROM public.episode e
    WHERE e.status IN ('on_hold', 'lost_to_follow_up')
    GROUP BY 1, 2
  )
  SELECT c.centre_id, c.item, c.n
  FROM counts c
  WHERE internal.jwt_sees_centre(c.centre_id)
  ORDER BY 1, 2;
END;
$$;

-- ALT-02: progress alerts, in part (recommended defaults chosen under the user's standing
-- approval, 28 October 2026; docs/runbooks/tasks.md). Two alerts need no number no document gives:
-- a session note signed "Worse", or with "Escalate" next, is a high task for the consultant who
-- signed the consultation (SOP 15.2: unexpected deterioration, same-day review); and a 6 week
-- review whose date has passed, not attended, nothing booked ahead and no final test, is a task
-- for them from the daily check (episodes.review_overdue). Plateau, no change, adherence,
-- milestones and repeated missed sessions wait for the client's thresholds (DECISION ALT-02).

-- Once signed: as before, and worse or escalated becomes a task too.
CREATE OR REPLACE FUNCTION internal.session_closed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  consultant uuid;
  details jsonb := jsonb_build_object('appointmentId', NEW.appointment_id, 'sessionId', NEW.id);
BEGIN
  UPDATE public.appointment a
    SET status = 'completed', completed_at = now(), updated_at = now()
    WHERE a.id = NEW.appointment_id AND a.status = 'in_progress';
  SELECT c.signed_by INTO consultant
    FROM public.consultation c
    WHERE c.episode_id = NEW.episode_id AND c.status = 'signed'
    ORDER BY c.signed_at DESC
    LIMIT 1;
  IF NEW.note #>> '{newSymptoms,answer}' = 'yes' THEN
    INSERT INTO public.task (kind, title, details, priority, assignee_staff_user_id,
      assignee_role, centre_id, patient_id, episode_id)
    VALUES ('review.new_symptoms',
      'New symptoms reported in session ' || NEW.number, details, 'high',
      consultant, CASE WHEN consultant IS NULL THEN 'centre_manager'::public.staff_role END,
      NEW.centre_id, NEW.patient_id, NEW.episode_id);
  END IF;
  -- ALT-02: worse after treatment, or escalated, is the consultant's same-day review (SOP 15.2).
  IF NEW.note #>> '{response,rating}' = 'worse' OR NEW.note #>> '{nextSession,plan}' = 'escalate' THEN
    INSERT INTO public.task (kind, title, details, priority, assignee_staff_user_id,
      assignee_role, centre_id, patient_id, episode_id)
    VALUES ('review.worsening',
      'Worse or escalated in session ' || NEW.number,
      details || jsonb_build_object('rating', NEW.note #>> '{response,rating}',
        'plan', NEW.note #>> '{nextSession,plan}'),
      'high',
      consultant, CASE WHEN consultant IS NULL THEN 'centre_manager'::public.staff_role END,
      NEW.centre_id, NEW.patient_id, NEW.episode_id);
  END IF;
  IF NEW.adverse_event IS NOT NULL THEN
    INSERT INTO public.task (kind, title, details, priority, assignee_staff_user_id,
      assignee_role, centre_id, patient_id, episode_id)
    VALUES ('review.adverse_event',
      'Adverse event in session ' || NEW.number, details, 'high',
      consultant, CASE WHEN consultant IS NULL THEN 'centre_manager'::public.staff_role END,
      NEW.centre_id, NEW.patient_id, NEW.episode_id),
      ('review.adverse_event_director',
      'Adverse event in session ' || NEW.number || ': Clinical Director review', details, 'high',
      NULL, 'super_admin'::public.staff_role,
      NEW.centre_id, NEW.patient_id, NEW.episode_id);
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint

-- The Centre Manager's alerts (DSH-03): worse or escalated joins the reviews to do; overdue 6 week
-- reviews are counted on their own.
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
        'review.worsening')
      AND t.status <> 'closed' AND t.centre_id IS NOT NULL
    GROUP BY 1
    UNION ALL
    SELECT t.centre_id, 'reviews_overdue', count(*)
    FROM public.task t
    WHERE t.kind = 'review.overdue' AND t.status <> 'closed' AND t.centre_id IS NOT NULL
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
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.manager_alert_counts() FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.manager_alert_counts() TO authenticated;--> statement-breakpoint

-- An episode leaving Active (discharged, on hold, lost to follow up) closes its open overdue
-- review task at once, as the system, saying why.
CREATE OR REPLACE FUNCTION internal.episode_closes_review_overdue() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  UPDATE public.task t
    SET status = 'closed', decision = 'Closed automatically: the episode is no longer Active.',
      closed_at = now(), updated_at = now()
    WHERE t.episode_id = NEW.id AND t.kind = 'review.overdue' AND t.status = 'open';
  RETURN NULL;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.episode_closes_review_overdue() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER episode_closes_review_overdue AFTER UPDATE OF status ON public.episode
  FOR EACH ROW WHEN (OLD.status = 'active' AND NEW.status <> 'active')
  EXECUTE FUNCTION internal.episode_closes_review_overdue();--> statement-breakpoint

-- The daily check (episodes.review_overdue, keyed by its IST date) queues the next day itself;
-- this queues the first: today at 6:00 AM IST, or tomorrow once that has passed.
SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint
INSERT INTO public.job (kind, payload, run_at, idempotency_key)
SELECT 'episodes.review_overdue', jsonb_build_object('date', day::text),
  (day + time '06:00') AT TIME ZONE 'Asia/Kolkata', 'episodes.review_overdue:' || day::text
FROM (
  SELECT CASE
    WHEN (now() AT TIME ZONE 'Asia/Kolkata')::time < time '06:00'
      THEN (now() AT TIME ZONE 'Asia/Kolkata')::date
    ELSE (now() AT TIME ZONE 'Asia/Kolkata')::date + 1
  END AS day
) first_run
ON CONFLICT (idempotency_key) DO NOTHING;--> statement-breakpoint
SELECT set_config('audit.actor', '', false);

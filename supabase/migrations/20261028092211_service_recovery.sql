-- PAT-08: service recovery (PRD J7.2; Blueprint section 14: "Negative feedback should create a
-- service-recovery task"). Recommended defaults chosen under the user's standing approval,
-- 28 October 2026 (docs/runbooks/feedback.md). Feedback with any No, or a recommendation score at
-- or below `feedback.recovery_score_max`, gives the centre's Centre Managers a high task at once;
-- one still open after `feedback.escalate_hours` gives the Clinical Director (the Super Admin, as
-- for adverse events) a task too, through the queued job `feedback.recovery_escalate`.

SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint
INSERT INTO public.setting (key, value, updated_by) VALUES
  ('feedback.recovery_score_max', '6', 'system:migration'),
  ('feedback.escalate_hours', '24', 'system:migration')
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint
SELECT set_config('audit.actor', '', false);--> statement-breakpoint

-- Runs as the patient's own insert (audited as them); SECURITY DEFINER, as patients add no task
-- or job themselves. The task names which questions were No and the score, never the patient.
CREATE OR REPLACE FUNCTION internal.feedback_service_recovery() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  noes text[];
  low boolean;
  recovery uuid;
  hours integer;
BEGIN
  SELECT coalesce(array_agg(a.key ORDER BY a.key), '{}') INTO noes
    FROM jsonb_each_text(NEW.answers) a
    WHERE a.value = 'no';
  low := NEW.score IS NOT NULL AND NEW.score <= (
    SELECT (s.value #>> '{}')::int FROM public.setting s WHERE s.key = 'feedback.recovery_score_max'
  );
  IF cardinality(noes) = 0 AND NOT coalesce(low, false) THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.task (kind, title, details, priority, assignee_role, centre_id, patient_id,
    episode_id)
  VALUES ('feedback.service_recovery',
    CASE NEW.survey_key
      WHEN 'discharge' THEN 'Service recovery: feedback at discharge'
      ELSE 'Service recovery: feedback after the consultation'
    END,
    jsonb_build_object('feedbackId', NEW.id, 'surveyKey', NEW.survey_key, 'noAnswers',
      to_jsonb(noes), 'score', NEW.score),
    'high', 'centre_manager', NEW.centre_id, NEW.patient_id, NEW.episode_id)
  RETURNING id INTO recovery;
  SELECT (s.value #>> '{}')::int INTO hours
    FROM public.setting s WHERE s.key = 'feedback.escalate_hours';
  INSERT INTO public.job (kind, payload, run_at, idempotency_key)
  VALUES ('feedback.recovery_escalate', jsonb_build_object('taskId', recovery),
    now() + make_interval(hours => hours), 'feedback.recovery_escalate:' || recovery);
  RETURN NULL;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.feedback_service_recovery() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER feedback_service_recovery AFTER INSERT ON public.feedback
  FOR EACH ROW EXECUTE FUNCTION internal.feedback_service_recovery();--> statement-breakpoint

-- The Centre Manager's alerts (DSH-03): open service recovery tasks join the counts.
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

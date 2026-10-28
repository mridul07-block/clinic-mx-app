-- PAT-05: the day after first treatment check (PRD J5.6: "Day after first treatment check: Better,
-- Same, Still sore. "Still sore" alerts the physio."; TAD jobs: next day, 10:00 AM). Recommended
-- defaults chosen under the user's standing approval, 29 October 2026 (DECISION PAT-05;
-- docs/runbooks/feedback.md). Signing the episode's session 1 queues the WhatsApp check for the
-- next day at 10:00 IST (settings); until WA-06 sends it, the desk shows it as a QR. The patient
-- answers once per episode through a feedback link for that session's visit; Still sore gives the
-- episode's treating physio (else the physio of session 1) a high review task. Better and Same are
-- recorded only.

SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint
INSERT INTO public.setting (key, value, updated_by) VALUES
  ('feedback.first_treatment_check_days', '1', 'system:migration'),
  ('feedback.first_treatment_check_time', '"10:00"', 'system:migration')
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint
SELECT set_config('audit.actor', '', false);--> statement-breakpoint

-- What the page's feedback link answers for: after the consultation (a link for the visit, its
-- signed consultation), at discharge (a link for the episode, once discharged), or after the first
-- treatment (a link for session 1's visit, once signed); while the link works and nobody has
-- answered for it. SECURITY DEFINER: the patient reads none of these itself.
DROP POLICY feedback_patient_answer ON public.feedback;--> statement-breakpoint
DROP FUNCTION internal.feedback_subject();--> statement-breakpoint
CREATE FUNCTION internal.feedback_subject()
RETURNS TABLE (
  survey_key public.feedback_survey_key, patient_id uuid, episode_id uuid, appointment_id uuid,
  consultation_id uuid, centre_id uuid, physio_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH link AS (
    SELECT l.patient_id, l.appointment_id, l.episode_id
    FROM public.patient_link l
    WHERE l.id = internal.jwt_patient_link_id()
      AND l.purpose = 'feedback'
      AND l.revoked_at IS NULL AND l.completed_at IS NULL AND l.expires_at > now()
  )
  SELECT 'post_consultation'::public.feedback_survey_key, link.patient_id, c.episode_id, a.id,
    c.id, a.centre_id, c.physio_id
  FROM link
  JOIN public.appointment a ON a.id = link.appointment_id AND a.patient_id = link.patient_id
  JOIN public.consultation c ON c.appointment_id = a.id AND c.status = 'signed'
  WHERE NOT EXISTS (SELECT 1 FROM public.feedback f WHERE f.consultation_id = c.id)
  UNION ALL
  SELECT 'discharge'::public.feedback_survey_key, link.patient_id, e.id, NULL::uuid, NULL::uuid,
    e.centre_id, e.discharged_by
  FROM link
  JOIN public.episode e ON e.id = link.episode_id AND e.patient_id = link.patient_id
  WHERE e.status = 'discharged'
    AND NOT EXISTS (
      SELECT 1 FROM public.feedback f WHERE f.episode_id = e.id AND f.survey_key = 'discharge'
    )
  UNION ALL
  SELECT 'first_treatment'::public.feedback_survey_key, link.patient_id, s.episode_id, a.id,
    NULL::uuid, a.centre_id, s.physio_id
  FROM link
  JOIN public.appointment a ON a.id = link.appointment_id AND a.patient_id = link.patient_id
  JOIN public.session s ON s.appointment_id = a.id AND s.number = 1 AND s.status = 'signed'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.feedback f
    WHERE f.episode_id = s.episode_id AND f.survey_key = 'first_treatment'
  )
  LIMIT 1
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.feedback_subject() FROM PUBLIC, anon, authenticated;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.feedback_subject() TO clinic_patient;--> statement-breakpoint

-- The patient writes their answers once, for exactly that subject and survey, now.
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
    )
  );--> statement-breakpoint

-- A feedback link is issued for a visit whose consultation is signed and unanswered, or whose
-- session is the episode's first treatment, signed and unanswered.
CREATE OR REPLACE FUNCTION internal.feedback_open_for(p_appointment_id uuid) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.consultation c
    WHERE c.appointment_id = p_appointment_id AND c.status = 'signed'
      AND NOT EXISTS (SELECT 1 FROM public.feedback f WHERE f.consultation_id = c.id)
  ) OR EXISTS (
    SELECT 1 FROM public.session s
    WHERE s.appointment_id = p_appointment_id AND s.number = 1 AND s.status = 'signed'
      AND NOT EXISTS (
        SELECT 1 FROM public.feedback f
        WHERE f.episode_id = s.episode_id AND f.survey_key = 'first_treatment'
      )
  )
$$;--> statement-breakpoint

-- Until WhatsApp sends the check (WA-06), the desk shows it as a QR on the plan and payment sheet:
-- the episode's first treatment's visit and patient, and whether it is answered; for those who
-- check in at the episode's centre. The desk reads no session itself.
CREATE OR REPLACE FUNCTION internal.first_treatment_check_target(p_episode_id uuid)
RETURNS TABLE (appointment_id uuid, patient_id uuid, received boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT a.id, a.patient_id,
    EXISTS (
      SELECT 1 FROM public.feedback f
      WHERE f.episode_id = s.episode_id AND f.survey_key = 'first_treatment'
    )
  FROM public.session s
  JOIN public.appointment a ON a.id = s.appointment_id
  JOIN public.episode e ON e.id = s.episode_id
  WHERE s.episode_id = p_episode_id AND s.number = 1 AND s.status = 'signed'
    AND coalesce((SELECT internal.jwt_checks_in()), false)
    AND internal.jwt_sees_centre(e.centre_id)
  ORDER BY s.signed_at, s.id
  LIMIT 1
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.first_treatment_check_target(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.first_treatment_check_target(uuid) TO authenticated;--> statement-breakpoint

-- Signing the episode's session 1 queues the check, once per episode, for the set day at the set
-- time in IST. SECURITY DEFINER: the physio who signs adds no job themselves.
CREATE OR REPLACE FUNCTION internal.session_first_treatment_check() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  days integer;
  at_time time;
BEGIN
  SELECT (s.value #>> '{}')::int INTO days
    FROM public.setting s WHERE s.key = 'feedback.first_treatment_check_days';
  SELECT (s.value #>> '{}')::time INTO at_time
    FROM public.setting s WHERE s.key = 'feedback.first_treatment_check_time';
  INSERT INTO public.job (kind, payload, run_at, idempotency_key)
  VALUES ('whatsapp.first_treatment_check',
    jsonb_build_object('sessionId', NEW.id, 'episodeId', NEW.episode_id,
      'appointmentId', NEW.appointment_id),
    (((now() AT TIME ZONE 'Asia/Kolkata')::date + coalesce(days, 1))
      + coalesce(at_time, time '10:00')) AT TIME ZONE 'Asia/Kolkata',
    'whatsapp.first_treatment_check:' || NEW.episode_id)
  ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN NULL;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.session_first_treatment_check() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER session_first_treatment_check AFTER UPDATE OF status ON public.session
  FOR EACH ROW
  WHEN (OLD.status = 'draft' AND NEW.status = 'signed' AND NEW.number = 1)
  EXECUTE FUNCTION internal.session_first_treatment_check();--> statement-breakpoint

-- Still sore alerts the physio: a high review task for the episode's treating physio, else the
-- physio of the first treatment. Runs as the patient's own insert (audited as them); SECURITY
-- DEFINER, as patients add no task themselves. The task names no patient in its details.
CREATE OR REPLACE FUNCTION internal.feedback_still_sore() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.task (kind, title, details, priority, assignee_staff_user_id, centre_id,
    patient_id, episode_id)
  VALUES ('review.still_sore', 'Still sore the day after the first treatment',
    jsonb_build_object('feedbackId', NEW.id),
    'high', coalesce(internal.episode_treating_physio(NEW.episode_id), NEW.physio_id),
    NEW.centre_id, NEW.patient_id, NEW.episode_id);
  RETURN NULL;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.feedback_still_sore() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER feedback_still_sore AFTER INSERT ON public.feedback
  FOR EACH ROW
  WHEN (NEW.survey_key = 'first_treatment' AND NEW.answers ->> 'since_first_treatment' = 'still_sore')
  EXECUTE FUNCTION internal.feedback_still_sore();--> statement-breakpoint

-- The Centre Manager's alerts (DSH-03): open Still sore reviews join the open clinical reviews.
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
        'review.worsening', 'review.still_sore')
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

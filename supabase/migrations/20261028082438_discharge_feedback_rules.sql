-- PAT-07: feedback at discharge (PRD J7.1; Blueprint section 14). Recommended defaults chosen under
-- the user's standing approval, 28 October 2026 (docs/runbooks/feedback.md). A feedback link for a
-- discharged episode takes the discharge questions and the 0 to 10 recommendation score once,
-- kept with the episode's centre and the consultant who discharged it.

-- What the page's feedback link answers for: after the consultation (a link for the visit, its
-- signed consultation), or at discharge (a link for the episode, once discharged); while the link
-- works and nobody has answered for it. SECURITY DEFINER: the patient reads neither itself.
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

-- Until WhatsApp sends the discharge report with "Give feedback" (OUT-11, WA-06), the desk shows
-- the link as a QR on the plan and payment sheet of a discharged episode: whom for, and whether
-- it is answered; for those who check in at the episode's centre.
CREATE OR REPLACE FUNCTION internal.discharge_feedback_target(p_episode_id uuid)
RETURNS TABLE (patient_id uuid, received boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT e.patient_id,
    EXISTS (
      SELECT 1 FROM public.feedback f WHERE f.episode_id = e.id AND f.survey_key = 'discharge'
    )
  FROM public.episode e
  WHERE e.id = p_episode_id AND e.status = 'discharged'
    AND coalesce((SELECT internal.jwt_checks_in()), false)
    AND internal.jwt_sees_centre(e.centre_id)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.discharge_feedback_target(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.discharge_feedback_target(uuid) TO authenticated;--> statement-breakpoint

-- Whether an episode is discharged and its discharge feedback still unanswered.
CREATE OR REPLACE FUNCTION internal.discharge_feedback_open(p_episode_id uuid) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.episode e
    WHERE e.id = p_episode_id AND e.status = 'discharged'
      AND NOT EXISTS (
        SELECT 1 FROM public.feedback f WHERE f.episode_id = e.id AND f.survey_key = 'discharge'
      )
  )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.discharge_feedback_open(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.discharge_feedback_open(uuid) TO authenticated;--> statement-breakpoint

-- Those who check patients in read and issue discharge feedback links for episodes at their
-- centres, for the episode's own patient, once discharged and unanswered.
CREATE POLICY patient_link_discharge_feedback_read ON public.patient_link FOR SELECT
  TO authenticated
  USING (
    (SELECT internal.jwt_checks_in())
    AND purpose = 'feedback'
    AND EXISTS (SELECT 1 FROM public.episode e
      WHERE e.id = episode_id AND e.patient_id = patient_link.patient_id
        AND internal.jwt_sees_centre(e.centre_id))
  );--> statement-breakpoint
CREATE POLICY patient_link_discharge_feedback_issue ON public.patient_link FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT internal.jwt_checks_in())
    AND purpose = 'feedback'
    AND EXISTS (SELECT 1 FROM public.episode e
      WHERE e.id = episode_id AND e.patient_id = patient_link.patient_id
        AND internal.jwt_sees_centre(e.centre_id))
    AND (SELECT internal.discharge_feedback_open(episode_id))
  );

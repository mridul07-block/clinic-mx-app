-- WA-06: the WhatsApp senders, part 1. A check's message (the first treatment check, a follow up)
-- stands for a patient link, so a tap on its reply button is recorded as that link's answer, the
-- same row the link page writes: what the link answers for is worked out from the link itself
-- (`internal.feedback_subject_of`), which the patient's page reads through its own link
-- (`internal.feedback_subject`, unchanged in what it returns). The server records a WhatsApp answer
-- as `system:whatsapp`; the triggers that give Still sore and Injured again their tasks fire as
-- for any answer. The review request's button opens a `review` link, which only redirects to the
-- episode's centre's Google review page (user decisions, 30 October 2026).

CREATE FUNCTION internal.feedback_subject_of(p_link_id uuid)
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
    WHERE l.id = p_link_id
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
REVOKE ALL ON FUNCTION internal.feedback_subject_of(uuid) FROM PUBLIC, anon, authenticated;--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.feedback_subject()
RETURNS TABLE (
  survey_key public.feedback_survey_key, patient_id uuid, episode_id uuid, appointment_id uuid,
  consultation_id uuid, centre_id uuid, physio_id uuid, follow_up text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT * FROM internal.feedback_subject_of(internal.jwt_patient_link_id())
$$;--> statement-breakpoint

SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint
INSERT INTO public.setting (key, value, updated_by) VALUES
  ('links.review_days', '30', 'system:migration')
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint
SELECT set_config('audit.actor', '', false);

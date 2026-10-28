-- PAT-05 review: the day after first treatment check is only for a treatment that is the patient's
-- first. An episode brought in with an opening entry (SCH-13: patients already in treatment at
-- launch) numbers its first session here 1, but that was not their first treatment, so it gets no
-- check: no job, no link, nothing at the desk. And the check follows the treatment, not the note:
-- it is sent the day after session 1's visit (IST), or at once when the note is signed after that.
-- Recommended defaults chosen under the user's standing approval, 29 October 2026 (DECISION PAT-05).

-- Whether an episode's session 1 is its first treatment: not an opening entry's episode.
CREATE OR REPLACE FUNCTION internal.first_treatment_episode(p_episode_id uuid) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.opening_entry o WHERE o.episode_id = p_episode_id)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.first_treatment_episode(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.first_treatment_episode(uuid) TO authenticated, clinic_patient;--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.feedback_subject()
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
  WHERE internal.first_treatment_episode(s.episode_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.feedback f
      WHERE f.episode_id = s.episode_id AND f.survey_key = 'first_treatment'
    )
  LIMIT 1
$$;--> statement-breakpoint

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
      AND internal.first_treatment_episode(s.episode_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.feedback f
        WHERE f.episode_id = s.episode_id AND f.survey_key = 'first_treatment'
      )
  )
$$;--> statement-breakpoint

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
    AND internal.first_treatment_episode(s.episode_id)
    AND coalesce((SELECT internal.jwt_checks_in()), false)
    AND internal.jwt_sees_centre(e.centre_id)
  ORDER BY s.signed_at, s.id
  LIMIT 1
$$;--> statement-breakpoint

-- Queued for the set day after session 1's visit (IST) at the set time, or at once when the note
-- is signed after that; never for an opening entry's episode.
CREATE OR REPLACE FUNCTION internal.session_first_treatment_check() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  days integer;
  at_time time;
  visit_day date;
BEGIN
  IF NOT internal.first_treatment_episode(NEW.episode_id) THEN
    RETURN NULL;
  END IF;
  SELECT (s.value #>> '{}')::int INTO days
    FROM public.setting s WHERE s.key = 'feedback.first_treatment_check_days';
  SELECT (s.value #>> '{}')::time INTO at_time
    FROM public.setting s WHERE s.key = 'feedback.first_treatment_check_time';
  SELECT (a.starts_at AT TIME ZONE 'Asia/Kolkata')::date INTO visit_day
    FROM public.appointment a WHERE a.id = NEW.appointment_id;
  INSERT INTO public.job (kind, payload, run_at, idempotency_key)
  VALUES ('whatsapp.first_treatment_check',
    jsonb_build_object('sessionId', NEW.id, 'episodeId', NEW.episode_id,
      'appointmentId', NEW.appointment_id),
    greatest(
      ((coalesce(visit_day, (now() AT TIME ZONE 'Asia/Kolkata')::date) + coalesce(days, 1))
        + coalesce(at_time, time '10:00')) AT TIME ZONE 'Asia/Kolkata',
      now()
    ),
    'whatsapp.first_treatment_check:' || NEW.episode_id)
  ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN NULL;
END;
$$;

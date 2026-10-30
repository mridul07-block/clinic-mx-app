-- OUT-09: the patient's clearance acknowledgement (PRD J6.5 "Patients acknowledge clearance and
-- warning signs on their phone"; SOP 14.2; Frontend Specification "Clearance acknowledgement:
-- Plan, warning signs to stop, residual risk; tick and sign"). The consultant writes the three
-- sections when signing Return to training or Return to sport; the patient reads them through the
-- episode's clearance link (the consultant's QR), ticks each and signs. Each section is one
-- consent record (stage C) keeping the words shown and the tick's version; records never change.
-- Recommended defaults chosen under the user's standing approval, 30 October 2026 (DECISION
-- OUT-09; docs/runbooks/sessions.md).

-- Return to training and Return to sport carry the three sections, Rehabilitation complete none;
-- clearances signed before OUT-09 have none (not validated).
ALTER TABLE public.clearance ADD CONSTRAINT clearance_texts CHECK (
  CASE WHEN status = 'rehabilitation_complete' THEN
    patient_plan IS NULL AND warning_signs IS NULL AND residual_risk IS NULL
  ELSE
    coalesce(length(trim(patient_plan)), 0) BETWEEN 1 AND 2000
    AND coalesce(length(trim(warning_signs)), 0) BETWEEN 1 AND 2000
    AND coalesce(length(trim(residual_risk)), 0) BETWEEN 1 AND 2000
  END
) NOT VALID;--> statement-breakpoint

-- What an episode's acknowledgements stand at: each signed Return to training or Return to sport
-- with its three sections, and when (and by whom) the patient acknowledged it, on the tick's
-- current version (1, as packages/schemas/src/clearance-acknowledgement.ts; a database test keeps
-- the two the same). Not granted: read through the patient's and the staff wrappers below.
CREATE FUNCTION internal.clearance_ack_core(of_episode uuid) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'episode_id', of_episode,
    'clearances', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
          'status', c.status,
          'signed_at', c.signed_at,
          'plan', c.patient_plan,
          'warning_signs', c.warning_signs,
          'residual_risk', c.residual_risk,
          'acknowledged', ack.at,
          'signer', ack.signer
        ) ORDER BY c.status)
      FROM public.clearance c
      LEFT JOIN LATERAL (
        SELECT max(r.created_at) AS at, max(r.signer) AS signer
        FROM public.consent_record r
        WHERE r.episode_id = of_episode AND r.stage = 'C' AND r.statement_version = 1
          AND r.accepted
          AND r.statement_key LIKE 'clearance.' || c.status || '.%'
        HAVING count(DISTINCT r.statement_key) = 3
      ) ack ON true
      WHERE c.episode_id = of_episode
        AND c.status IN ('return_to_training', 'return_to_sport')
        AND c.patient_plan IS NOT NULL
    ), '[]'::jsonb)
  )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.clearance_ack_core(uuid) FROM PUBLIC, anon, authenticated;--> statement-breakpoint

-- For the patient's own clearance link: their episode's acknowledgements.
CREATE FUNCTION internal.clearance_ack_for_link() RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT internal.clearance_ack_core(l.episode_id)
  FROM public.patient_link l
  WHERE l.id = internal.jwt_patient_link_id() AND l.purpose = 'clearance'
    AND l.episode_id IS NOT NULL
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.clearance_ack_for_link() FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.clearance_ack_for_link() TO clinic_patient;--> statement-breakpoint

-- For clinicians who see the episode's centre (the sections are clinical, as the clearance is).
CREATE FUNCTION internal.clearance_ack_for_episode(of_episode uuid) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT internal.clearance_ack_core(e.id)
  FROM public.episode e
  WHERE e.id = of_episode AND internal.jwt_clinical_reader()
    AND internal.jwt_sees_centre(e.centre_id)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.clearance_ack_for_episode(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.clearance_ack_for_episode(uuid) TO authenticated;--> statement-breakpoint

-- Whether `shown` is exactly the section `of_key` names of the episode's signed clearance.
CREATE FUNCTION internal.clearance_section_is(of_episode uuid, of_key text, shown text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clearance c
    WHERE c.episode_id = of_episode
      AND c.status IN ('return_to_training', 'return_to_sport')
      AND CASE of_key
        WHEN 'clearance.' || c.status || '.plan' THEN c.patient_plan
        WHEN 'clearance.' || c.status || '.warning_signs' THEN c.warning_signs
        WHEN 'clearance.' || c.status || '.residual_risk' THEN c.residual_risk
      END = shown
  )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.clearance_section_is(uuid, text, text) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.clearance_section_is(uuid, text, text) TO clinic_patient;--> statement-breakpoint

-- The patient acknowledges only through their open clearance link, for its episode: a section of
-- a signed clearance, ticked (never declined), on the tick's current version, with the words the
-- clearance holds, signed by them or their own guardian on file.
CREATE POLICY consent_record_patient_add_clearance ON public.consent_record FOR INSERT
  TO clinic_patient
  WITH CHECK (
    stage = 'C'
    AND accepted
    AND appointment_id IS NULL
    AND modality IS NULL
    AND statement_version = 1
    AND patient_link_id = (SELECT internal.jwt_patient_link_id())
    AND (guardian_id IS NULL OR guardian_id IN (SELECT g.id FROM public.guardian g))
    AND (SELECT internal.clearance_section_is(episode_id, statement_key, shown_text))
    AND EXISTS (
      SELECT 1 FROM public.patient_link l
      WHERE l.id = consent_record.patient_link_id
        AND l.purpose = 'clearance'
        AND l.patient_id = consent_record.patient_id
        AND l.episode_id = consent_record.episode_id
        AND l.completed_at IS NULL
        AND l.revoked_at IS NULL
        AND l.expires_at > now()
    )
  );--> statement-breakpoint

-- A consultant with the Treats patients tick at the episode's centre issues and reads its
-- clearance links; the patient marks theirs used once the acknowledgement is recorded through it.
CREATE POLICY patient_link_clearance_read ON public.patient_link FOR SELECT TO authenticated
  USING (
    (SELECT internal.jwt_consultant()) AND (SELECT internal.jwt_treats())
    AND purpose = 'clearance'
    AND EXISTS (SELECT 1 FROM public.episode e
      WHERE e.id = episode_id AND e.patient_id = patient_link.patient_id
        AND internal.jwt_sees_centre(e.centre_id))
  );--> statement-breakpoint
CREATE POLICY patient_link_clearance_issue ON public.patient_link FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT internal.jwt_consultant()) AND (SELECT internal.jwt_treats())
    AND purpose = 'clearance'
    AND appointment_id IS NULL
    AND EXISTS (SELECT 1 FROM public.episode e
      WHERE e.id = episode_id AND e.patient_id = patient_link.patient_id
        AND internal.jwt_sees_centre(e.centre_id))
  );--> statement-breakpoint
CREATE FUNCTION internal.clearance_recorded(of_link uuid) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.consent_record r WHERE r.patient_link_id = of_link AND r.stage = 'C'
  )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.clearance_recorded(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.clearance_recorded(uuid) TO clinic_patient;--> statement-breakpoint
CREATE POLICY patient_link_patient_complete_clearance ON public.patient_link FOR UPDATE
  TO clinic_patient
  USING (
    id = (SELECT internal.jwt_patient_link_id())
    AND purpose = 'clearance'
    AND completed_at IS NULL
    AND revoked_at IS NULL
    AND expires_at > now()
  )
  WITH CHECK (
    id = (SELECT internal.jwt_patient_link_id())
    AND completed_at = now()
    AND (SELECT internal.clearance_recorded(id))
  );--> statement-breakpoint

-- DECISION OUT-09: a clearance link stays valid a day, to read it at home.
SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint
INSERT INTO public.setting (key, value, updated_by) VALUES
  ('links.clearance_hours', '24', 'system:migration')
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint
SELECT set_config('audit.actor', '', false);

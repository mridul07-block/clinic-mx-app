-- BIL-03: Part B consent (PRD J4.4 and J4.5; Blueprint Module 3, Part B), after the consultation,
-- before the first session, on the patient's phone through the episode's consent link (the
-- desk's QR), or on the tablet. The general terms always; the package terms when the patient chose
-- a package; one card per modality in the signed plan of care. The patient's decisions are added
-- through their link and never changed; a change of mind is a new decision. Recommended defaults
-- chosen under the user's standing approval, 30 October 2026 (DECISION BIL-03;
-- docs/runbooks/consent.md).

-- What a Part B link asks about: the newest plan of care of a signed consultation, its modalities
-- in the plan's order, whether the patient's latest choice is a package, the signed diagnosis's
-- name (for the plan statement, only when asked for), and the latest Part B decision on each
-- statement. Not granted: read through the patient's and the staff wrappers below.
CREATE FUNCTION internal.part_b_core(of_episode uuid, with_diagnosis boolean) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH plan AS (
    SELECT p.id, c.kb_version_id
    FROM public.plan_of_care p
    JOIN public.consultation c ON c.id = p.consultation_id AND c.status = 'signed'
    WHERE p.episode_id = of_episode
    ORDER BY p.version DESC
    LIMIT 1
  )
  SELECT jsonb_build_object(
    'episode_id', of_episode,
    'planned', EXISTS (SELECT 1 FROM plan),
    'modalities', coalesce((
      SELECT jsonb_agg(jsonb_build_object('key', m.modality_key,
          'name', coalesce(k.name, m.modality_key)) ORDER BY coalesce(k.name, m.modality_key))
      FROM plan
      JOIN public.plan_modality m ON m.plan_of_care_id = plan.id
      LEFT JOIN public.kb_modality k
        ON k.key = m.modality_key AND k.kb_version_id = plan.kb_version_id
    ), '[]'::jsonb),
    'package', coalesce((
      SELECT ch.choice = 'package' FROM public.plan_choice ch
      WHERE ch.episode_id = of_episode
      ORDER BY ch.recorded_at DESC, ch.id DESC
      LIMIT 1
    ), false),
    'diagnosis', CASE WHEN with_diagnosis THEN (
      SELECT kc.name FROM public.diagnosis d
      JOIN public.consultation c ON c.id = d.consultation_id AND c.status = 'signed'
      JOIN public.kb_condition kc
        ON kc.kb_version_id = d.kb_version_id AND kc.condition_id = d.condition_id
      WHERE d.episode_id = of_episode
      ORDER BY c.signed_at DESC, c.id DESC
      LIMIT 1
    ) END,
    'latest', coalesce((
      SELECT jsonb_object_agg(x.statement_key, x.accepted)
      FROM (
        SELECT DISTINCT ON (r.statement_key) r.statement_key, r.accepted
        FROM public.consent_record r
        WHERE r.episode_id = of_episode AND r.stage = 'B'
        ORDER BY r.statement_key, r.created_at DESC, r.id DESC
      ) x
    ), '{}'::jsonb)
  )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.part_b_core(uuid, boolean) FROM PUBLIC, anon, authenticated;--> statement-breakpoint

-- For the patient's own consent link: their episode's Part B, with the diagnosis named.
CREATE FUNCTION internal.part_b_for_link() RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT internal.part_b_core(l.episode_id, true)
  FROM public.patient_link l
  WHERE l.id = internal.jwt_patient_link_id() AND l.purpose = 'consent'
    AND l.episode_id IS NOT NULL
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.part_b_for_link() FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.part_b_for_link() TO clinic_patient;--> statement-breakpoint

-- For staff who see the episode's centre (the desk, its physios, the manager; the Super Admin and
-- Finance everywhere): where its Part B stands. No diagnosis: the desk reads nothing clinical.
CREATE FUNCTION internal.part_b_for_episode(of_episode uuid) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT internal.part_b_core(e.id, false)
  FROM public.episode e
  WHERE e.id = of_episode AND internal.jwt_staff_id() IS NOT NULL
    AND internal.jwt_sees_centre(e.centre_id)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.part_b_for_episode(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.part_b_for_episode(uuid) TO authenticated;--> statement-breakpoint

-- The patient adds Part B decisions only through their open consent link, for its episode, never
-- for a visit.
CREATE POLICY consent_record_patient_add_part_b ON public.consent_record FOR INSERT
  TO clinic_patient
  WITH CHECK (
    stage = 'B'
    AND statement_key LIKE 'part_b.%'
    AND appointment_id IS NULL
    AND patient_link_id = (SELECT internal.jwt_patient_link_id())
    AND EXISTS (
      SELECT 1 FROM public.patient_link l
      WHERE l.id = consent_record.patient_link_id
        AND l.purpose = 'consent'
        AND l.patient_id = consent_record.patient_id
        AND l.episode_id = consent_record.episode_id
        AND l.completed_at IS NULL
        AND l.revoked_at IS NULL
        AND l.expires_at > now()
    )
  );--> statement-breakpoint

-- The desk issues and reads an episode's consent link at its centre (check_in.manage), and the
-- patient marks theirs done once Part B is recorded.
CREATE POLICY patient_link_consent_read ON public.patient_link FOR SELECT TO authenticated
  USING (
    (SELECT internal.jwt_checks_in())
    AND purpose = 'consent'
    AND EXISTS (SELECT 1 FROM public.episode e
      WHERE e.id = episode_id AND e.patient_id = patient_link.patient_id
        AND internal.jwt_sees_centre(e.centre_id))
  );--> statement-breakpoint
CREATE POLICY patient_link_consent_issue ON public.patient_link FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT internal.jwt_checks_in())
    AND purpose = 'consent'
    AND appointment_id IS NULL
    AND EXISTS (SELECT 1 FROM public.episode e
      WHERE e.id = episode_id AND e.patient_id = patient_link.patient_id
        AND internal.jwt_sees_centre(e.centre_id)
        AND e.status NOT IN ('discharged', 'lost_to_follow_up'))
  );--> statement-breakpoint
CREATE POLICY patient_link_patient_complete_consent ON public.patient_link FOR UPDATE
  TO clinic_patient
  USING (
    id = (SELECT internal.jwt_patient_link_id())
    AND purpose = 'consent'
    AND completed_at IS NULL
    AND revoked_at IS NULL
    AND expires_at > now()
  )
  WITH CHECK (
    id = (SELECT internal.jwt_patient_link_id())
    AND completed_at = now()
  );

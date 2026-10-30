-- BIL-03 review: Part B decisions count only on the statement's current version (new wording asks
-- again); a card whose wording is awaited (version 0, DECISION #21) is never asked or agreed, and its
-- treatment is not used until real wording is consented to; the patient's rows must name a real
-- statement, its version and modality, and their own guardian; a link is used only once something
-- is recorded through it; a decline gives the front desk a task (Blueprint Module 3: "declining a
-- mandatory statement blocks the related workflow and alerts reception"); the plan statement lists
-- the plan's interventions too, and treatments come in the knowledge base's order; the words shown
-- (with the diagnosis) stay out of non-clinicians' audit log. Recommended defaults chosen under the
-- user's standing approval, 30 October 2026 (DECISION BIL-03; docs/runbooks/consent.md).

-- The statements with their current version, as packages/schemas/src/part-b-consent.ts holds them
-- (a database test keeps the two the same). Version 0: wording awaited.
DROP FUNCTION internal.part_b_statements();--> statement-breakpoint
CREATE FUNCTION internal.part_b_statements()
RETURNS TABLE (statement_key text, statement_group text, modality text, version integer)
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  VALUES
    ('part_b.plan', 'general', NULL, 1),
    ('part_b.right_to_decline', 'general', NULL, 1),
    ('part_b.package_validity', 'package', NULL, 1),
    ('part_b.package_reschedule', 'package', NULL, 1),
    ('part_b.package_refund', 'package', NULL, 1),
    ('part_b.modality.electrotherapy', 'modality', 'electrotherapy', 1),
    ('part_b.modality.radial_shockwave', 'modality', 'radial_shockwave', 1),
    ('part_b.modality.focused_shockwave', 'modality', 'focused_shockwave', 1),
    ('part_b.modality.pemf', 'modality', 'pemf', 1),
    ('part_b.modality.spinal_traction', 'modality', 'spinal_traction', 1),
    ('part_b.modality.laser', 'modality', 'laser', 1),
    ('part_b.modality.dry_needling', 'modality', 'dry_needling', 0),
    ('part_b.modality.zero_gravity_treadmill', 'modality', 'zero_gravity_treadmill', 0)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.part_b_statements() FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.part_b_statements() TO authenticated, clinic_patient;--> statement-breakpoint

-- What a Part B link asks about: as before, with the plan's interventions, the modalities in the
-- knowledge base's order, and the latest decision only on each statement's current version.
CREATE OR REPLACE FUNCTION internal.part_b_core(of_episode uuid, with_diagnosis boolean) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH plan AS (
    SELECT p.id, p.interventions, c.kb_version_id
    FROM public.plan_of_care p
    JOIN public.consultation c ON c.id = p.consultation_id AND c.status = 'signed'
    WHERE p.episode_id = of_episode
    ORDER BY p.version DESC
    LIMIT 1
  )
  SELECT jsonb_build_object(
    'episode_id', of_episode,
    'planned', EXISTS (SELECT 1 FROM plan),
    'interventions', coalesce((SELECT to_jsonb(plan.interventions) FROM plan), '[]'::jsonb),
    'modalities', coalesce((
      SELECT jsonb_agg(jsonb_build_object('key', m.modality_key,
          'name', coalesce(k.name, m.modality_key))
        ORDER BY k.sort NULLS LAST, coalesce(k.name, m.modality_key))
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
        JOIN internal.part_b_statements() s
          ON s.statement_key = r.statement_key AND s.version = r.statement_version
          AND s.version > 0
        WHERE r.episode_id = of_episode AND r.stage = 'B'
        ORDER BY r.statement_key, r.created_at DESC, r.id DESC
      ) x
    ), '{}'::jsonb)
  )
$$;--> statement-breakpoint

-- The gate skips a card whose wording is awaited: its treatment is not used, nothing waits on it.
CREATE OR REPLACE FUNCTION internal.part_b_gate(of_episode uuid) RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  state jsonb := internal.part_b_core(of_episode, false);
  latest jsonb := state -> 'latest';
  asked record;
  missing boolean := false;
  package_declined boolean := false;
BEGIN
  IF NOT (state ->> 'planned')::boolean THEN
    IF EXISTS (SELECT 1 FROM public.opening_entry o WHERE o.episode_id = of_episode) THEN
      RETURN 'opening_entry';
    END IF;
    RETURN 'no_plan';
  END IF;
  FOR asked IN
    SELECT s.statement_key, s.statement_group
    FROM internal.part_b_statements() s
    WHERE s.version > 0
      AND (s.statement_group = 'general'
        OR (s.statement_group = 'package' AND (state ->> 'package')::boolean)
        OR (s.statement_group = 'modality' AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(state -> 'modalities') m
          WHERE m ->> 'key' = s.modality)))
  LOOP
    IF NOT (latest ? asked.statement_key) THEN
      missing := true;
    ELSIF NOT (latest ->> asked.statement_key)::boolean THEN
      IF asked.statement_group = 'general' THEN RETURN 'general_declined'; END IF;
      IF asked.statement_group = 'package' THEN package_declined := true; END IF;
    END IF;
  END LOOP;
  IF package_declined THEN RETURN 'package_declined'; END IF;
  IF missing THEN RETURN 'missing'; END IF;
  RETURN 'met';
END
$$;--> statement-breakpoint

-- The patient's rows name a real, current statement (never one awaiting wording) with its own
-- modality, the words shown only on the plan statement, and their own guardian on file.
DROP POLICY consent_record_patient_add_part_b ON public.consent_record;--> statement-breakpoint
CREATE POLICY consent_record_patient_add_part_b ON public.consent_record FOR INSERT
  TO clinic_patient
  WITH CHECK (
    stage = 'B'
    AND appointment_id IS NULL
    AND patient_link_id = (SELECT internal.jwt_patient_link_id())
    AND EXISTS (
      SELECT 1 FROM internal.part_b_statements() s
      WHERE s.statement_key = consent_record.statement_key
        AND s.version = consent_record.statement_version
        AND s.version > 0
        AND s.modality IS NOT DISTINCT FROM consent_record.modality
    )
    AND (shown_text IS NULL OR statement_key = 'part_b.plan')
    AND (guardian_id IS NULL OR guardian_id IN (SELECT g.id FROM public.guardian g))
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

-- A consent link is used once something is recorded through it.
CREATE FUNCTION internal.part_b_recorded(of_link uuid) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.consent_record r WHERE r.patient_link_id = of_link AND r.stage = 'B'
  )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.part_b_recorded(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.part_b_recorded(uuid) TO clinic_patient;--> statement-breakpoint
DROP POLICY patient_link_patient_complete_consent ON public.patient_link;--> statement-breakpoint
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
    AND (SELECT internal.part_b_recorded(id))
  );--> statement-breakpoint

-- A decline gives the front desk at the episode's centre a task to speak to the patient: one open
-- task per episode.
CREATE FUNCTION internal.part_b_declined_task() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  at_centre uuid;
BEGIN
  IF NEW.stage <> 'B' OR NEW.accepted OR NEW.episode_id IS NULL THEN RETURN NULL; END IF;
  IF EXISTS (
    SELECT 1 FROM public.task t
    WHERE t.kind = 'consent.part_b_declined' AND t.episode_id = NEW.episode_id
      AND t.status <> 'closed'
  ) THEN
    RETURN NULL;
  END IF;
  SELECT e.centre_id INTO at_centre FROM public.episode e WHERE e.id = NEW.episode_id;
  INSERT INTO public.task (kind, title, details, priority, assignee_role, centre_id, patient_id,
    episode_id)
  VALUES ('consent.part_b_declined', 'Part B consent declined: speak to the patient',
    jsonb_build_object('episodeId', NEW.episode_id), 'high', 'front_desk', at_centre,
    NEW.patient_id, NEW.episode_id);
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE TRIGGER part_b_declined_task AFTER INSERT ON public.consent_record
  FOR EACH ROW EXECUTE FUNCTION internal.part_b_declined_task();--> statement-breakpoint

-- The words shown on the plan statement name the diagnosis: hidden from managers without the
-- Treats patients tick, as the clinical record is (ADM-01).
CREATE OR REPLACE FUNCTION internal.audit_hidden_keys(entity text, clinician boolean) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT CASE
    WHEN entity = 'episode' AND NOT clinician THEN ARRAY['discharge_note', 'discharge_goals',
      'discharge_ongoing_needs', 'discharge_recommendations', 'discharge_return_plan',
      'discharge_flare_plan']
    WHEN entity = 'consent_record' AND NOT clinician THEN ARRAY['shown_text']
    WHEN entity = 'ai_run' THEN ARRAY['cost_micro_usd']
    ELSE ARRAY[]::text[]
  END
$$;

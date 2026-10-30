-- BIL-12: the consent and pricing gate (PRD J4.9; Blueprint section 9, "Consent and pricing
-- gate": "The software does not allow a treatment session to start until both are recorded").
-- Pricing is met once the chosen plan is paid (SES-01: the episode in treatment); Part B consent
-- (BIL-03) joins it here. Recommended defaults chosen under the user's standing approval, 30
-- October 2026 (DECISION BIL-12; docs/runbooks/sessions.md).

-- The Part B statements, as packages/schemas/src/part-b-consent.ts holds them (a database test
-- keeps the two the same): each key, its group, and a modality card's modality.
CREATE FUNCTION internal.part_b_statements()
RETURNS TABLE (statement_key text, statement_group text, modality text)
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  VALUES
    ('part_b.plan', 'general', NULL),
    ('part_b.right_to_decline', 'general', NULL),
    ('part_b.package_validity', 'package', NULL),
    ('part_b.package_reschedule', 'package', NULL),
    ('part_b.package_refund', 'package', NULL),
    ('part_b.modality.electrotherapy', 'modality', 'electrotherapy'),
    ('part_b.modality.radial_shockwave', 'modality', 'radial_shockwave'),
    ('part_b.modality.focused_shockwave', 'modality', 'focused_shockwave'),
    ('part_b.modality.pemf', 'modality', 'pemf'),
    ('part_b.modality.spinal_traction', 'modality', 'spinal_traction'),
    ('part_b.modality.laser', 'modality', 'laser'),
    ('part_b.modality.dry_needling', 'modality', 'dry_needling'),
    ('part_b.modality.zero_gravity_treadmill', 'modality', 'zero_gravity_treadmill')
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.part_b_statements() FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.part_b_statements() TO authenticated;--> statement-breakpoint

-- Whether an episode's Part B lets treatment start, as `partBGate` decides it (PRD J4.5):
-- 'met'; 'opening_entry' (a patient already in treatment before launch, entered with an opening
-- entry and no signed plan here: their consent is on paper); 'no_plan' (no signed plan yet);
-- 'general_declined'; 'package_declined' (only while the latest choice is a package); 'missing'
-- (a statement asked has no decision). Not granted: read through session_progress.
CREATE FUNCTION internal.part_b_gate(of_episode uuid) RETURNS text
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
    WHERE s.statement_group = 'general'
      OR (s.statement_group = 'package' AND (state ->> 'package')::boolean)
      OR (s.statement_group = 'modality' AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(state -> 'modalities') m
        WHERE m ->> 'key' = s.modality))
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
REVOKE ALL ON FUNCTION internal.part_b_gate(uuid) FROM PUBLIC, anon, authenticated;--> statement-breakpoint

-- Session check in's read (SES-01) gains the episode's Part B gate.
DROP FUNCTION internal.session_progress(uuid[]);--> statement-breakpoint
CREATE FUNCTION internal.session_progress(appointment_ids uuid[])
RETURNS TABLE (
  appointment_id uuid,
  session_number integer,
  planned integer,
  episode_status public.episode_status,
  part_b text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH kinds AS (
    SELECT coalesce((SELECT s.value FROM public.setting s
      WHERE s.key = 'packages.session_appointment_types'), '["session", "zero_gravity_treadmill"]')
      AS session_types
  ),
  asked AS (
    SELECT a.id, a.episode_id, a.status, a.arrived_at
    FROM public.appointment a
    JOIN public.appointment_type t ON t.id = a.appointment_type_id
    CROSS JOIN kinds
    WHERE a.id = ANY (session_progress.appointment_ids)
      AND kinds.session_types ? t.key
      AND internal.jwt_sees_centre(a.centre_id)
  )
  SELECT
    asked.id,
    CASE WHEN asked.episode_id IS NOT NULL
      AND asked.status IN ('checked_in', 'in_progress', 'completed') THEN (
      SELECT count(*)::int + 1
      FROM public.appointment o
      JOIN public.appointment_type ot ON ot.id = o.appointment_type_id
      CROSS JOIN kinds
      WHERE o.episode_id = asked.episode_id
        AND o.id <> asked.id
        AND kinds.session_types ? ot.key
        AND o.status IN ('checked_in', 'in_progress', 'completed')
        AND (o.arrived_at, o.id) < (asked.arrived_at, asked.id)
    ) END,
    (SELECT p.sessions_per_week * p.weeks FROM public.plan_of_care p
      WHERE p.episode_id = asked.episode_id ORDER BY p.version DESC LIMIT 1),
    (SELECT e.status FROM public.episode e WHERE e.id = asked.episode_id),
    CASE WHEN asked.episode_id IS NOT NULL THEN internal.part_b_gate(asked.episode_id) END
  FROM asked
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.session_progress(uuid[]) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.session_progress(uuid[]) TO authenticated;

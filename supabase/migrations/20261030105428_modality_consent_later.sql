-- BIL-04: a modality added to the plan later (Blueprint Module 3: "If a modality is added to the
-- plan later, the software requests that modality's consent before the session in which it is
-- first used"). Its card is then the one Part B statement without a decision: the gate holds the
-- session and says so ('missing_modality'), and the desk's consent QR asks that card alone.
-- Recommended defaults chosen under the user's standing approval, 30 October 2026 (DECISION
-- BIL-04; docs/runbooks/consent.md).
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
  missing_terms boolean := false;
  missing_modality boolean := false;
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
      IF asked.statement_group = 'modality' THEN
        missing_modality := true;
      ELSE
        missing_terms := true;
      END IF;
    ELSIF NOT (latest ->> asked.statement_key)::boolean THEN
      IF asked.statement_group = 'general' THEN RETURN 'general_declined'; END IF;
      IF asked.statement_group = 'package' THEN package_declined := true; END IF;
    END IF;
  END LOOP;
  IF package_declined THEN RETURN 'package_declined'; END IF;
  IF missing_terms THEN RETURN 'missing'; END IF;
  -- The terms are decided: only a treatment's consent is outstanding, as when it was added later.
  IF missing_modality THEN RETURN 'missing_modality'; END IF;
  RETURN 'met';
END
$$;

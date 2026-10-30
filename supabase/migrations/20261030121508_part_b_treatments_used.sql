-- BIL-04 review: a treatment is used through the session note, so Part B asks for every treatment
-- the plan's newest signed version plans or one of the episode's session notes ticks (a physio
-- ticking PEMF makes the desk's consent QR ask PEMF alone), and a session note is signed only with
-- treatments the patient agreed to on their card's current version: a declined one, one whose
-- wording is awaited (DECISION #21) or one never asked is refused (PRD J4.5; Blueprint Module 3:
-- "the software requests that modality's consent before the session in which it is first used").
-- An episode without a signed plan (an opening entry, consented on paper) is not checked. A
-- decline's task is added once however many declines arrive at once. Recommended defaults chosen
-- under the user's standing approval, 30 October 2026 (DECISION BIL-04; docs/runbooks/consent.md).

-- As before, with the treatments ticked in the episode's session notes among the modalities.
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
  ),
  used AS (
    SELECT m.modality_key AS key
    FROM plan
    JOIN public.plan_modality m ON m.plan_of_care_id = plan.id
    UNION
    SELECT ticked.key
    FROM public.session s
    CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(s.note -> 'treatment' -> 'modalities') = 'array'
        THEN s.note -> 'treatment' -> 'modalities' ELSE '[]'::jsonb END) AS ticked(key)
    WHERE s.episode_id = of_episode
  )
  SELECT jsonb_build_object(
    'episode_id', of_episode,
    'planned', EXISTS (SELECT 1 FROM plan),
    'interventions', coalesce((SELECT to_jsonb(plan.interventions) FROM plan), '[]'::jsonb),
    'modalities', coalesce((
      SELECT jsonb_agg(jsonb_build_object('key', used.key, 'name', coalesce(k.name, used.key))
        ORDER BY k.sort NULLS LAST, coalesce(k.name, used.key))
      FROM used
      LEFT JOIN plan ON true
      LEFT JOIN public.kb_modality k
        ON k.key = used.key AND k.kb_version_id = plan.kb_version_id
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

-- The treatments of `keys` the patient has not agreed to on their card's current version; none
-- for an episode without a signed plan.
CREATE FUNCTION internal.part_b_unconsented(of_episode uuid, keys text[]) RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH state AS (SELECT internal.part_b_core(of_episode, false) AS s)
  SELECT coalesce(array_agg(DISTINCT k ORDER BY k), '{}'::text[])
  FROM state, unnest(keys) AS k
  WHERE (state.s ->> 'planned')::boolean
    AND NOT EXISTS (
      SELECT 1 FROM internal.part_b_statements() st
      WHERE st.modality = k AND st.version > 0
        AND (state.s -> 'latest' ->> st.statement_key)::boolean IS TRUE
    )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.part_b_unconsented(uuid, text[]) FROM PUBLIC, anon;--> statement-breakpoint

-- A session note is signed only with treatments the patient agreed to.
CREATE FUNCTION internal.session_part_b() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  unconsented text[] := internal.part_b_unconsented(NEW.episode_id, ARRAY(
    SELECT jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(NEW.note -> 'treatment' -> 'modalities') = 'array'
        THEN NEW.note -> 'treatment' -> 'modalities' ELSE '[]'::jsonb END)));
BEGIN
  IF cardinality(unconsented) > 0 THEN
    RAISE EXCEPTION 'No Part B consent to: %', array_to_string(unconsented, ', ')
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.session_part_b() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER session_part_b BEFORE UPDATE ON public.session
  FOR EACH ROW WHEN (OLD.status = 'draft' AND NEW.status = 'signed')
  EXECUTE FUNCTION internal.session_part_b();--> statement-breakpoint

-- A decline's task, once per episode while one is not closed (task_open_part_b_declined_key).
CREATE OR REPLACE FUNCTION internal.part_b_declined_task() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.stage <> 'B' OR NEW.accepted OR NEW.episode_id IS NULL THEN RETURN NULL; END IF;
  INSERT INTO public.task (kind, title, details, priority, assignee_role, centre_id, patient_id,
    episode_id)
  SELECT 'consent.part_b_declined', 'Part B consent declined: speak to the patient',
    jsonb_build_object('episodeId', NEW.episode_id), 'high', 'front_desk', e.centre_id,
    NEW.patient_id, NEW.episode_id
  FROM public.episode e WHERE e.id = NEW.episode_id
  ON CONFLICT (episode_id) WHERE kind = 'consent.part_b_declined' AND status <> 'closed'
    DO NOTHING;
  RETURN NULL;
END
$$;

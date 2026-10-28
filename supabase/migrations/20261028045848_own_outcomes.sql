-- DSH-06: a treating clinician's own outcomes (PRD section 2: dashboards, physiotherapist "Own
-- patients"). The same figures and definitions as the Centre Manager's Outcomes tab (DSH-03),
-- counted over the episodes whose newest plan of care names the signed in person as treating
-- physio, at any centre. Counts only, never colleagues; for the Super Admin and physiotherapists
-- with the Treats patients tick, never Velyx support. Recommended defaults chosen under the user's
-- standing approval, 28 October 2026 (docs/runbooks/own-outcomes.md). The three readers copy
-- internal.kpi_daily's two outcome figures, internal.kpi_funnel and internal.kpi_diagnosis_outcomes;
-- a database test keeps them equal (a change to those definitions changes these too).

CREATE OR REPLACE FUNCTION internal.reads_own_outcomes() RETURNS boolean
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT coalesce(internal.jwt_staff_id() IS NOT NULL
    AND internal.jwt_staff_role() IN ('super_admin', 'physiotherapist')
    AND internal.jwt_treats()
    AND NOT internal.jwt_support(), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.reads_own_outcomes() FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.reads_own_outcomes() TO authenticated;--> statement-breakpoint

-- The caller's episodes: the newest plan version names them (as internal.episode_treating_physio).
-- Called only from the definer functions below; not granted to anyone signed in.
CREATE OR REPLACE FUNCTION internal.own_episodes() RETURNS TABLE (episode_id uuid)
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT p.episode_id FROM public.plan_of_care p
  WHERE p.treating_physio_id = internal.jwt_staff_id()
    AND NOT EXISTS (SELECT 1 FROM public.plan_of_care q
      WHERE q.episode_id = p.episode_id AND q.version > p.version)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.own_episodes() FROM PUBLIC, anon, authenticated;--> statement-breakpoint

-- Completion and conversion, as internal.kpi_daily counts them, for the caller's episodes.
CREATE OR REPLACE FUNCTION internal.own_kpi_daily(from_day date, to_day date)
RETURNS TABLE (centre_id uuid, day date, metric text, numerator bigint, denominator bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  longest int := coalesce((SELECT (s.value #>> '{}')::int FROM public.setting s
    WHERE s.key = 'kpi.max_range_days'), 366);
  range_start timestamptz := from_day::timestamp AT TIME ZONE 'Asia/Kolkata';
  range_end timestamptz := (to_day + 1)::timestamp AT TIME ZONE 'Asia/Kolkata';
BEGIN
  IF NOT internal.reads_own_outcomes() THEN
    RAISE EXCEPTION 'Own outcomes are for clinicians who treat patients'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF from_day IS NULL OR to_day IS NULL OR to_day < from_day OR to_day - from_day + 1 > longest THEN
    RAISE EXCEPTION 'The figures cover 1 to % days', longest
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN QUERY
  WITH mine AS (SELECT o.episode_id FROM internal.own_episodes() o),
  proposed AS (
    SELECT e.id, e.centre_id, e.activated_at,
      (e.plan_proposed_at AT TIME ZONE 'Asia/Kolkata')::date AS day
    FROM public.episode e
    WHERE e.id IN (SELECT m.episode_id FROM mine m)
      AND e.plan_proposed_at >= range_start AND e.plan_proposed_at < range_end
      AND NOT EXISTS (SELECT 1 FROM public.opening_entry o WHERE o.episode_id = e.id)
      AND NOT EXISTS (SELECT 1 FROM public.red_flag_alert r
        WHERE r.episode_id = e.id AND r.referred_at IS NOT NULL)
  ),
  figures AS (
    SELECT p.centre_id, p.day, 'consultation_conversion' AS metric,
      count(*) FILTER (WHERE p.activated_at IS NOT NULL) AS numerator, count(*) AS denominator
    FROM proposed p GROUP BY p.centre_id, p.day
    UNION ALL
    SELECT e.centre_id, (e.closed_at AT TIME ZONE 'Asia/Kolkata')::date, 'treatment_completion',
      count(*) FILTER (WHERE e.discharge_reason IN ('goals_achieved', 'independent_management')),
      count(*)
    FROM public.episode e
    WHERE e.id IN (SELECT m.episode_id FROM mine m)
      AND e.status = 'discharged' AND e.activated_at IS NOT NULL
      AND e.closed_at >= range_start AND e.closed_at < range_end
    GROUP BY 1, 2
  )
  SELECT f.centre_id, f.day, f.metric, f.numerator, f.denominator
  FROM figures f
  ORDER BY f.day, f.centre_id, f.metric;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.own_kpi_daily(date, date) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.own_kpi_daily(date, date) TO authenticated;--> statement-breakpoint

-- The funnel, as internal.kpi_funnel follows it, for the caller's episodes.
CREATE OR REPLACE FUNCTION internal.own_funnel(from_day date, to_day date)
RETURNS TABLE (centre_id uuid, stage text, episodes bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  longest int := coalesce((SELECT (s.value #>> '{}')::int FROM public.setting s
    WHERE s.key = 'kpi.max_range_days'), 366);
  range_start timestamptz := from_day::timestamp AT TIME ZONE 'Asia/Kolkata';
  range_end timestamptz := (to_day + 1)::timestamp AT TIME ZONE 'Asia/Kolkata';
BEGIN
  IF NOT internal.reads_own_outcomes() THEN
    RAISE EXCEPTION 'Own outcomes are for clinicians who treat patients'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF from_day IS NULL OR to_day IS NULL OR to_day < from_day OR to_day - from_day + 1 > longest THEN
    RAISE EXCEPTION 'The figures cover 1 to % days', longest
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN QUERY
  WITH first_visit AS (
    SELECT DISTINCT ON (a.episode_id) a.episode_id, a.centre_id, a.starts_at
    FROM public.appointment a
    JOIN public.appointment_type t ON t.id = a.appointment_type_id AND t.key = 'consultation'
    WHERE a.episode_id IN (SELECT o.episode_id FROM internal.own_episodes() o)
      AND a.starts_at < range_end
      AND a.status IN ('checked_in', 'in_progress', 'completed')
    ORDER BY a.episode_id, a.starts_at, a.id
  ),
  cohort AS (
    SELECT f.centre_id, e.plan_proposed_at, e.activated_at, e.status, e.discharge_reason
    FROM first_visit f
    JOIN public.episode e ON e.id = f.episode_id
    WHERE f.starts_at >= range_start
      AND NOT EXISTS (SELECT 1 FROM public.opening_entry o WHERE o.episode_id = e.id)
  )
  SELECT c.centre_id, s.stage, count(*) FILTER (WHERE s.reached)
  FROM cohort c
  CROSS JOIN LATERAL (VALUES
    (1, 'consultation_held', true),
    (2, 'plan_proposed', c.plan_proposed_at IS NOT NULL),
    (3, 'active', c.activated_at IS NOT NULL),
    (4, 'discharged', c.status = 'discharged' AND c.activated_at IS NOT NULL),
    (5, 'discharged_goals_met', c.status = 'discharged' AND c.activated_at IS NOT NULL
      AND c.discharge_reason IN ('goals_achieved', 'independent_management')),
    (6, 'in_treatment', c.status IN ('active', 'under_review'))
  ) AS s(ord, stage, reached)
  GROUP BY c.centre_id, s.ord, s.stage
  ORDER BY 1, s.ord;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.own_funnel(date, date) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.own_funnel(date, date) TO authenticated;--> statement-breakpoint

-- Diagnoses and pain, as internal.kpi_diagnosis_outcomes counts them, for the caller's episodes.
CREATE OR REPLACE FUNCTION internal.own_diagnosis_outcomes(from_day date, to_day date)
RETURNS TABLE (centre_id uuid, condition_id text, condition_name text, diagnosed bigint,
  discharged bigint, paired bigint, baseline_pain numeric, discharge_pain numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  longest int := coalesce((SELECT (s.value #>> '{}')::int FROM public.setting s
    WHERE s.key = 'kpi.max_range_days'), 366);
  range_start timestamptz := from_day::timestamp AT TIME ZONE 'Asia/Kolkata';
  range_end timestamptz := (to_day + 1)::timestamp AT TIME ZONE 'Asia/Kolkata';
BEGIN
  IF NOT internal.reads_own_outcomes() THEN
    RAISE EXCEPTION 'Own outcomes are for clinicians who treat patients'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF from_day IS NULL OR to_day IS NULL OR to_day < from_day OR to_day - from_day + 1 > longest THEN
    RAISE EXCEPTION 'The figures cover 1 to % days', longest
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN QUERY
  WITH episodes AS (
    SELECT e.id, e.centre_id, e.status, e.activated_at, e.closed_at
    FROM public.episode e
    WHERE e.id IN (SELECT o.episode_id FROM internal.own_episodes() o)
      AND e.opened_at < range_end AND (e.closed_at IS NULL OR e.closed_at >= range_start)
  ),
  signed AS (
    SELECT c.id, c.episode_id, c.appointment_id, c.sections, c.signed_at,
      row_number() OVER (PARTITION BY c.episode_id ORDER BY c.signed_at, c.id) AS first_n,
      row_number() OVER (PARTITION BY c.episode_id ORDER BY c.signed_at DESC, c.id DESC) AS last_n
    FROM public.consultation c
    WHERE c.status = 'signed' AND c.episode_id IN (SELECT ep.id FROM episodes ep)
  ),
  last_session AS (
    SELECT DISTINCT ON (s.episode_id) s.episode_id, s.pain_activity
    FROM public.session s
    WHERE s.status = 'signed' AND s.episode_id IN (SELECT ep.id FROM episodes ep)
    ORDER BY s.episode_id, s.number DESC
  ),
  ep AS (
    SELECT ep.centre_id, d.condition_id, k.name, f.signed_at AS diagnosed_at,
      ep.status = 'discharged' AND ep.activated_at IS NOT NULL
        AND ep.closed_at >= range_start AND ep.closed_at < range_end AS discharged_in_range,
      (SELECT CASE WHEN jsonb_typeof(x.v) = 'number' THEN (x.v #>> '{}')::numeric END
       FROM (SELECT CASE
           WHEN (f.sections #> '{subjective,confirmed}') ? 'pain_activity'
             THEN f.sections #> '{subjective,confirmed,pain_activity}'
           ELSE (SELECT r.answers -> 'pain_activity' FROM public.intake_response r
                 WHERE r.appointment_id = f.appointment_id)
         END AS v) x) AS pain_before,
      ls.pain_activity::numeric AS pain_after
    FROM episodes ep
    LEFT JOIN last_session ls ON ls.episode_id = ep.id
    JOIN signed f ON f.episode_id = ep.id AND f.first_n = 1
    JOIN signed l ON l.episode_id = ep.id AND l.last_n = 1
    JOIN public.diagnosis d ON d.consultation_id = l.id
    JOIN public.kb_condition k ON k.kb_version_id = d.kb_version_id
      AND k.condition_id = d.condition_id
  )
  SELECT ep.centre_id, ep.condition_id, max(ep.name),
    count(*) FILTER (WHERE ep.diagnosed_at >= range_start AND ep.diagnosed_at < range_end),
    count(*) FILTER (WHERE ep.discharged_in_range),
    count(*) FILTER (WHERE ep.discharged_in_range AND ep.pain_before IS NOT NULL
      AND ep.pain_after IS NOT NULL),
    avg(ep.pain_before) FILTER (WHERE ep.discharged_in_range AND ep.pain_after IS NOT NULL),
    avg(ep.pain_after) FILTER (WHERE ep.discharged_in_range AND ep.pain_before IS NOT NULL)
  FROM ep
  GROUP BY ep.centre_id, ep.condition_id
  HAVING count(*) FILTER (WHERE (ep.diagnosed_at >= range_start AND ep.diagnosed_at < range_end)
    OR ep.discharged_in_range) > 0
  ORDER BY 1, 2;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.own_diagnosis_outcomes(date, date) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.own_diagnosis_outcomes(date, date) TO authenticated;

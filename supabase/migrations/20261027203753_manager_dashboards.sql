-- DSH-03: the Centre Manager's dashboards (Frontend Specification sections 6 and 8). A Centre
-- Manager without the Treats patients tick reads no consultation, session, diagnosis or bill, so
-- every figure here is a count from a SECURITY DEFINER function: the Super Admin and Centre
-- Managers only, at the centres they see, never a patient or an amount. Recommended defaults
-- chosen under the user's standing approval, 28 October 2026 (docs/runbooks/manager-dashboards.md).

-- Who reads the dashboards: the Super Admin and Centre Managers (`dashboard.clinical_operations`).
CREATE OR REPLACE FUNCTION internal.reads_dashboards() RETURNS boolean
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT internal.jwt_staff_id() IS NOT NULL
    AND coalesce(internal.jwt_staff_role() IN ('super_admin', 'centre_manager'), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.reads_dashboards() FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.reads_dashboards() TO authenticated;--> statement-breakpoint

-- What needs the manager now, per centre: red flags not closed (by where they are), notes started
-- and not signed, reassessments waiting for the consultant's decision, new symptom and adverse
-- event reviews still open (counts of tasks held by consultants, never the tasks), and episodes On
-- hold or Lost to follow up.
CREATE OR REPLACE FUNCTION internal.manager_alert_counts()
RETURNS TABLE (centre_id uuid, item text, n bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
BEGIN
  IF NOT internal.reads_dashboards() THEN
    RAISE EXCEPTION 'The dashboards are for the Super Admin and Centre Managers'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
  WITH counts AS (
    SELECT e.centre_id,
      CASE
        WHEN r.status = 'raised' AND r.display = 'emergency' THEN 'red_flags_emergency'
        WHEN r.status = 'raised' THEN 'red_flags_raised'
        WHEN r.status = 'reviewed' THEN 'red_flags_reviewed'
        ELSE 'red_flags_referred'
      END AS item,
      count(*) AS n
    FROM public.red_flag_alert r
    JOIN public.episode e ON e.id = r.episode_id
    WHERE r.status <> 'closed'
    GROUP BY 1, 2
    UNION ALL
    SELECT a.centre_id, 'unsigned_notes', count(*)
    FROM (
      SELECT c.appointment_id FROM public.consultation c WHERE c.status = 'draft'
      UNION ALL
      SELECT s.appointment_id FROM public.session s WHERE s.status = 'draft'
    ) d
    JOIN public.appointment a ON a.id = d.appointment_id
    GROUP BY 1
    UNION ALL
    SELECT e.centre_id, 'reassessments_awaiting', count(*)
    FROM public.reassessment r
    JOIN public.episode e ON e.id = r.episode_id
    WHERE r.signed_at IS NULL
    GROUP BY 1
    UNION ALL
    SELECT t.centre_id, 'reviews_open', count(*)
    FROM public.task t
    WHERE t.kind IN ('review.new_symptoms', 'review.adverse_event', 'review.adverse_event_director')
      AND t.status <> 'closed' AND t.centre_id IS NOT NULL
    GROUP BY 1
    UNION ALL
    SELECT e.centre_id,
      CASE e.status WHEN 'on_hold' THEN 'episodes_on_hold' ELSE 'episodes_lost' END,
      count(*)
    FROM public.episode e
    WHERE e.status IN ('on_hold', 'lost_to_follow_up')
    GROUP BY 1, 2
  )
  SELECT c.centre_id, c.item, c.n
  FROM counts c
  WHERE internal.jwt_sees_centre(c.centre_id)
  ORDER BY 1, 2;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.manager_alert_counts() FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.manager_alert_counts() TO authenticated;--> statement-breakpoint

-- Payment pending without amounts (IAM-05's Centre Manager view, PRD section 4): unpaid bills per
-- centre, raised today (IST) and earlier.
CREATE OR REPLACE FUNCTION internal.payment_pending_counts()
RETURNS TABLE (centre_id uuid, since_today bigint, earlier bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  today_start timestamptz := ((now() AT TIME ZONE 'Asia/Kolkata')::date)::timestamp
    AT TIME ZONE 'Asia/Kolkata';
BEGIN
  IF NOT internal.reads_dashboards() THEN
    RAISE EXCEPTION 'The dashboards are for the Super Admin and Centre Managers'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
  SELECT b.centre_id,
    count(*) FILTER (WHERE b.created_at >= today_start),
    count(*) FILTER (WHERE b.created_at < today_start)
  FROM public.bill b
  WHERE b.status = 'unpaid' AND internal.jwt_sees_centre(b.centre_id)
  GROUP BY 1
  ORDER BY 1;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.payment_pending_counts() FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.payment_pending_counts() TO authenticated;--> statement-breakpoint

-- The team, per physio and IST day: notes signed the same day by the note's writer (a day counts
-- once it has ended, as kpi_daily), and visits the patient came to, credited to whoever started
-- the visit (the covering physio, SES-08) or else its physio.
CREATE OR REPLACE FUNCTION internal.team_daily(from_day date, to_day date)
RETURNS TABLE (centre_id uuid, physio_id uuid, day date, metric text, numerator bigint,
  denominator bigint)
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
  today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  IF NOT internal.reads_dashboards() THEN
    RAISE EXCEPTION 'The dashboards are for the Super Admin and Centre Managers'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF from_day IS NULL OR to_day IS NULL OR to_day < from_day OR to_day - from_day + 1 > longest THEN
    RAISE EXCEPTION 'The figures cover 1 to % days', longest
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN QUERY
  WITH visit AS (
    SELECT a.id, a.centre_id, a.physio_id, a.started_by, a.status,
      (a.starts_at AT TIME ZONE 'Asia/Kolkata')::date AS day
    FROM public.appointment a
    WHERE a.starts_at >= range_start AND a.starts_at < range_end
  ),
  figures AS (
    SELECT v.centre_id, n.physio_id, v.day, 'notes_signed_same_day' AS metric,
      count(*) FILTER (WHERE n.status = 'signed'
        AND (n.signed_at AT TIME ZONE 'Asia/Kolkata')::date = v.day) AS numerator,
      count(*) AS denominator
    FROM visit v
    JOIN (
      SELECT c.appointment_id, c.physio_id, c.status::text AS status, c.signed_at
      FROM public.consultation c
      UNION ALL
      SELECT s.appointment_id, s.physio_id, s.status::text, s.signed_at FROM public.session s
    ) n ON n.appointment_id = v.id
    WHERE v.day < today
    GROUP BY 1, 2, 3
    UNION ALL
    SELECT v.centre_id, coalesce(v.started_by, v.physio_id), v.day, 'visits_attended',
      count(*), NULL::bigint
    FROM visit v
    WHERE v.status IN ('checked_in', 'in_progress', 'completed')
    GROUP BY 1, 2, 3
  )
  SELECT f.centre_id, f.physio_id, f.day, f.metric, f.numerator, f.denominator
  FROM figures f
  WHERE internal.jwt_sees_centre(f.centre_id)
  ORDER BY 3, 1, 2, 4;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.team_daily(date, date) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.team_daily(date, date) TO authenticated;--> statement-breakpoint

-- From a consultation to a completed plan: the episodes whose first attended consultation is in
-- the window (opening entries had none), and how far each got; `in_treatment` counts those still
-- Active or Under review, so a recent cohort is not read as drop off.
CREATE OR REPLACE FUNCTION internal.kpi_funnel(from_day date, to_day date)
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
  IF NOT internal.reads_dashboards() THEN
    RAISE EXCEPTION 'The dashboards are for the Super Admin and Centre Managers'
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
    WHERE a.episode_id IS NOT NULL AND a.starts_at < range_end
      AND a.status IN ('checked_in', 'in_progress', 'completed')
    ORDER BY a.episode_id, a.starts_at, a.id
  ),
  cohort AS (
    SELECT f.centre_id, e.plan_proposed_at, e.activated_at, e.status, e.discharge_reason
    FROM first_visit f
    JOIN public.episode e ON e.id = f.episode_id
    WHERE f.starts_at >= range_start
      AND NOT EXISTS (SELECT 1 FROM public.opening_entry o WHERE o.episode_id = e.id)
      AND internal.jwt_sees_centre(f.centre_id)
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
REVOKE ALL ON FUNCTION internal.kpi_funnel(date, date) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.kpi_funnel(date, date) TO authenticated;--> statement-breakpoint

-- Diagnoses and their outcomes, per centre and condition: episodes first diagnosed in the window
-- (by the latest signed diagnosis of the episode), and of the episodes discharged in the window
-- after treatment, the mean pain during activity at the first signed consultation (as confirmed,
-- else as the health form gave it) and at the last signed session.
CREATE OR REPLACE FUNCTION internal.kpi_diagnosis_outcomes(from_day date, to_day date)
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
  IF NOT internal.reads_dashboards() THEN
    RAISE EXCEPTION 'The dashboards are for the Super Admin and Centre Managers'
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
    WHERE e.opened_at < range_end AND (e.closed_at IS NULL OR e.closed_at >= range_start)
      AND internal.jwt_sees_centre(e.centre_id)
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
REVOKE ALL ON FUNCTION internal.kpi_diagnosis_outcomes(date, date) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.kpi_diagnosis_outcomes(date, date) TO authenticated;--> statement-breakpoint

SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint
INSERT INTO public.setting (key, value, updated_by) VALUES
  ('dashboard.busy_hours_days', '28', 'system:migration'),
  ('dashboard.channel_days', '30', 'system:migration'),
  ('kpi.min_outcome_episodes', '3', 'system:migration')
ON CONFLICT (key) DO NOTHING;

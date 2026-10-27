-- DSH-01: the figures behind the dashboards (PRD section 9; user decisions 28 October 2026). They
-- are computed live from the records, by centre and IST day, by internal.kpi_daily, so a late
-- signature or an undone payment corrects its own day. Two moments of an episode are stamped for
-- them: the first time a consultation proposed a plan, and the first time it became Active (paid).

-- The episode's milestones: stamped once by the database, never set or changed by anyone.
CREATE OR REPLACE FUNCTION internal.episode_milestones() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.plan_proposed_at := NULL;
    NEW.activated_at := NULL;
    RETURN NEW;
  END IF;
  NEW.plan_proposed_at := coalesce(OLD.plan_proposed_at,
    CASE WHEN NEW.status = 'plan_proposed' THEN now() END);
  NEW.activated_at := coalesce(OLD.activated_at,
    CASE WHEN NEW.status = 'active' THEN now() END);
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.episode_milestones() FROM PUBLIC;--> statement-breakpoint

-- Episodes from before: their milestones from the status history (the audit trail). The status
-- guard is off for this one update, which changes no status, so discharged episodes take it too.
SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint
ALTER TABLE public.episode DISABLE TRIGGER episode_transition_guard;--> statement-breakpoint
UPDATE public.episode e SET
  plan_proposed_at = (SELECT min(a.at) FROM public.audit_event a
    WHERE a.entity = 'episode' AND a.entity_id = e.id::text
      AND a.after ->> 'status' = 'plan_proposed'),
  activated_at = (SELECT min(a.at) FROM public.audit_event a
    WHERE a.entity = 'episode' AND a.entity_id = e.id::text
      AND a.after ->> 'status' = 'active')
WHERE EXISTS (SELECT 1 FROM public.audit_event a
  WHERE a.entity = 'episode' AND a.entity_id = e.id::text
    AND a.after ->> 'status' IN ('plan_proposed', 'active'));--> statement-breakpoint
ALTER TABLE public.episode ENABLE TRIGGER episode_transition_guard;--> statement-breakpoint

CREATE TRIGGER episode_milestones BEFORE INSERT OR UPDATE ON public.episode
  FOR EACH ROW EXECUTE FUNCTION internal.episode_milestones();--> statement-breakpoint

-- The figures from `from_day` to `to_day` (IST), one row per centre, day and figure: the
-- numerator, and for a share its denominator; active patients also has a row with no centre, for
-- all the reader's centres together. Clinical figures for the Super Admin and Centre
-- Managers, revenue for the Super Admin and Finance, each at the centres they see; counts only,
-- never a patient. The definitions are the catalogue's (packages/schemas/src/kpis.ts).
CREATE OR REPLACE FUNCTION internal.kpi_daily(from_day date, to_day date)
RETURNS TABLE (centre_id uuid, day date, metric text, numerator bigint, denominator bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  caller_role text := internal.jwt_staff_role();
  clinical boolean := internal.jwt_staff_id() IS NOT NULL
    AND internal.jwt_staff_role() IN ('super_admin', 'centre_manager');
  finance boolean := internal.jwt_staff_id() IS NOT NULL
    AND internal.jwt_staff_role() IN ('super_admin', 'finance');
  longest int := coalesce((SELECT (s.value #>> '{}')::int FROM public.setting s
    WHERE s.key = 'kpi.max_range_days'), 366);
  range_start timestamptz := from_day::timestamp AT TIME ZONE 'Asia/Kolkata';
  range_end timestamptz := (to_day + 1)::timestamp AT TIME ZONE 'Asia/Kolkata';
  today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  IF NOT (clinical OR finance) THEN
    RAISE EXCEPTION 'The figures are for the Super Admin, Centre Managers and Finance (not %)',
      coalesce(caller_role, 'signed out') USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF from_day IS NULL OR to_day IS NULL OR to_day < from_day OR to_day - from_day + 1 > longest THEN
    RAISE EXCEPTION 'The figures cover 1 to % days', longest
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN QUERY
  WITH visit AS (
    SELECT a.id, a.centre_id, a.episode_id, a.status, a.starts_at, t.key AS type_key,
      (a.starts_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
      a.status IN ('checked_in', 'in_progress', 'completed') AS came
    FROM public.appointment a
    JOIN public.appointment_type t ON t.id = a.appointment_type_id
    WHERE clinical AND a.starts_at >= range_start AND a.starts_at < range_end
  ),
  proposed AS (
    SELECT e.id, e.centre_id, e.activated_at,
      (e.plan_proposed_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
      (SELECT c.choice FROM public.plan_choice c WHERE c.episode_id = e.id
        ORDER BY c.recorded_at DESC LIMIT 1) AS choice
    FROM public.episode e
    WHERE clinical AND e.plan_proposed_at >= range_start AND e.plan_proposed_at < range_end
      AND NOT EXISTS (SELECT 1 FROM public.opening_entry o WHERE o.episode_id = e.id)
      -- A red flag referral puts the episode On hold, before or after the plan was proposed.
      AND NOT EXISTS (SELECT 1 FROM public.red_flag_alert r
        WHERE r.episode_id = e.id AND r.referred_at IS NOT NULL)
  ),
  history AS (
    -- Each stretch of an episode's status, from the audit trail: from one change to the next.
    SELECT e.centre_id, e.patient_id, a.after ->> 'status' AS status, a.at AS since,
      lead(a.at) OVER (PARTITION BY a.entity_id ORDER BY a.at, a.id) AS until
    FROM public.episode e
    JOIN public.audit_event a ON a.entity = 'episode' AND a.entity_id = e.id::text
    WHERE clinical AND a.after IS NOT NULL AND e.opened_at < range_end
      AND (e.closed_at IS NULL OR e.closed_at >= range_start)
      AND internal.jwt_sees_centre(e.centre_id)
  ),
  day_end AS (
    SELECT d::date AS day,
      least(((d::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata'), now()) AS at
    FROM generate_series(from_day, least(to_day, today), interval '1 day') d
  ),
  figures AS (
    -- Red flag documentation: the first consultation of each episode the patient came to.
    SELECT v.centre_id, v.day, 'red_flag_documentation' AS metric,
      count(*) FILTER (WHERE c.status = 'signed') AS numerator, count(*) AS denominator
    FROM visit v
    LEFT JOIN public.consultation c ON c.appointment_id = v.id
    WHERE v.type_key = 'consultation' AND v.came AND v.episode_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.appointment p
        JOIN public.appointment_type pt ON pt.id = p.appointment_type_id AND pt.key = 'consultation'
        WHERE p.episode_id = v.episode_id
          AND p.status IN ('checked_in', 'in_progress', 'completed')
          AND (p.starts_at, p.id) < (v.starts_at, v.id)
      )
    GROUP BY v.centre_id, v.day
    UNION ALL
    SELECT p.centre_id, p.day, 'consultation_conversion',
      count(*) FILTER (WHERE p.activated_at IS NOT NULL), count(*)
    FROM proposed p GROUP BY p.centre_id, p.day
    UNION ALL
    SELECT p.centre_id, p.day, 'plan_acceptance',
      count(*) FILTER (WHERE p.choice IN ('package', 'per_session')), count(*)
    FROM proposed p GROUP BY p.centre_id, p.day
    UNION ALL
    -- Treatment completion: discharged after treatment began.
    SELECT e.centre_id, (e.closed_at AT TIME ZONE 'Asia/Kolkata')::date, 'treatment_completion',
      count(*) FILTER (WHERE e.discharge_reason IN ('goals_achieved', 'independent_management')),
      count(*)
    FROM public.episode e
    WHERE clinical AND e.status = 'discharged' AND e.activated_at IS NOT NULL
      AND e.closed_at >= range_start AND e.closed_at < range_end
    GROUP BY 1, 2
    UNION ALL
    -- Notes signed same day: a day counts once it has ended.
    SELECT v.centre_id, v.day, 'notes_signed_same_day',
      count(*) FILTER (WHERE n.status = 'signed'
        AND (n.signed_at AT TIME ZONE 'Asia/Kolkata')::date = v.day),
      count(*)
    FROM visit v
    JOIN (
      SELECT c.appointment_id, c.status::text AS status, c.signed_at FROM public.consultation c
      UNION ALL
      SELECT s.appointment_id, s.status::text, s.signed_at FROM public.session s
    ) n ON n.appointment_id = v.id
    WHERE v.day < today
    GROUP BY v.centre_id, v.day
    UNION ALL
    -- No show rate: of the visits resolved either way; past visits nobody marked are left out.
    SELECT v.centre_id, v.day, 'no_show_rate',
      count(*) FILTER (WHERE v.status = 'no_show'), count(*)
    FROM visit v
    WHERE v.came OR v.status = 'no_show'
    GROUP BY v.centre_id, v.day
    UNION ALL
    SELECT v.centre_id, v.day, 'health_form_before_consultation',
      count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM public.intake_response r
        WHERE r.appointment_id = v.id AND r.submitted_at <= v.starts_at)),
      count(*)
    FROM visit v
    WHERE v.type_key = 'consultation' AND v.came
    GROUP BY v.centre_id, v.day
    UNION ALL
    SELECT v.centre_id, v.day, 'consultations', count(*), NULL::bigint
    FROM visit v
    WHERE v.type_key = 'consultation' AND v.status = 'completed'
    GROUP BY v.centre_id, v.day
    UNION ALL
    -- Active patients: Active or Under review at the end of each day (now, for today), at each
    -- centre and, with no centre, across the centres the reader sees: a patient treated at two
    -- centres counts at each, and once in all.
    SELECT h.centre_id, d.day, 'active_patients', count(DISTINCT h.patient_id), NULL::bigint
    FROM day_end d
    JOIN history h ON h.since <= d.at AND (h.until IS NULL OR h.until > d.at)
      AND h.status IN ('active', 'under_review')
    GROUP BY GROUPING SETS ((h.centre_id, d.day), (d.day))
    UNION ALL
    SELECT b.centre_id, (p.recorded_at AT TIME ZONE 'Asia/Kolkata')::date, 'revenue',
      sum(p.amount_paise)::bigint, NULL::bigint
    FROM public.payment p
    JOIN public.bill b ON b.id = p.bill_id
    WHERE finance AND p.undone_at IS NULL
      AND p.recorded_at >= range_start AND p.recorded_at < range_end
    GROUP BY 1, 2
  )
  SELECT f.centre_id, f.day, f.metric, f.numerator, f.denominator
  FROM figures f
  WHERE f.centre_id IS NULL OR internal.jwt_sees_centre(f.centre_id)
  ORDER BY f.day, f.centre_id, f.metric;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.kpi_daily(date, date) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.kpi_daily(date, date) TO authenticated;--> statement-breakpoint

INSERT INTO public.setting (key, value, updated_by) VALUES
  ('kpi.target_red_flag_documentation_percent', '100', 'system:migration'),
  ('kpi.target_conversion_percent', '75', 'system:migration'),
  ('kpi.target_completion_percent', '80', 'system:migration'),
  ('kpi.target_meaningful_change_percent', '85', 'system:migration'),
  ('kpi.target_return_to_sport_percent', '85', 'system:migration'),
  ('kpi.target_reinjury_percent', '15', 'system:migration'),
  ('kpi.target_satisfaction_score', '4.5', 'system:migration'),
  ('kpi.target_nps', '60', 'system:migration'),
  ('kpi.target_notes_same_day_percent', '95', 'system:migration'),
  ('kpi.target_booking_flow_percent', '80', 'system:migration'),
  ('kpi.target_health_form_percent', '90', 'system:migration'),
  ('kpi.target_session_note_minutes', '3', 'system:migration'),
  ('kpi.max_range_days', '366', 'system:migration')
ON CONFLICT (key) DO NOTHING;

-- PAT-03: My plan's maintenance mode (PRD J6.7: '"My plan" switches to maintenance mode'; Frontend
-- Specification "maintenance mode after discharge"). Recommended defaults chosen under the user's
-- standing approval, 28 October 2026 (docs/runbooks/my-plan.md). After discharge the page shows
-- what the discharging consultant wrote for this patient: the return and flare plans, ongoing
-- needs and recommendations, as written. No clinical wording is supplied by the system.

-- My plan (PAT-01, PAT-02) gains the maintenance section. Otherwise as before.
CREATE OR REPLACE FUNCTION internal.my_plan() RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH link AS (
    SELECT l.patient_id, l.episode_id
    FROM public.patient_link l
    WHERE l.id = internal.jwt_patient_link_id()
      AND l.purpose = 'my_plan' AND l.episode_id IS NOT NULL
      AND l.revoked_at IS NULL AND l.expires_at > now()
      AND EXISTS (SELECT 1 FROM public.episode e
        WHERE e.id = l.episode_id AND e.patient_id = l.patient_id)
  ),
  plan AS (
    SELECT p.id, p.home_programme, p.weeks, p.sessions_per_week, p.created_at
    FROM public.plan_of_care p JOIN link ON p.episode_id = link.episode_id
    ORDER BY p.version DESC LIMIT 1
  ),
  today AS (SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS day),
  next_visit AS (
    SELECT a.starts_at, t.name AS type_name, c.name AS centre_name, c.map_link, c.phone,
      s.name AS physio_name
    FROM public.appointment a
    JOIN link ON a.episode_id = link.episode_id
    JOIN public.appointment_type t ON t.id = a.appointment_type_id
    JOIN public.centre c ON c.id = a.centre_id
    JOIN public.staff_user s ON s.id = a.physio_id
    WHERE a.status IN ('booked', 'confirmed', 'checked_in') AND a.ends_at > now()
    ORDER BY a.starts_at LIMIT 1
  ),
  -- The package signing takes sessions from (internal.session_sign: active, oldest payment first);
  -- with none active, the newest not cancelled, which the page words as used up or expired.
  held AS (
    SELECT k.name, k.sessions_total, k.sessions_used, k.valid_until, k.reschedules_left
    FROM public.package k JOIN link ON k.episode_id = link.episode_id
    WHERE k.cancelled_at IS NULL
    ORDER BY (k.sessions_used < k.sessions_total
        AND k.valid_until >= (now() AT TIME ZONE 'Asia/Kolkata')::date) DESC,
      CASE WHEN k.sessions_used < k.sessions_total
        AND k.valid_until >= (now() AT TIME ZONE 'Asia/Kolkata')::date
        THEN k.paid_at END ASC,
      k.paid_at DESC, k.id
    LIMIT 1
  ),
  pain AS (
    SELECT s.number, s.signed_at, s.pain_rest, s.pain_activity, s.pain_after
    FROM public.session s JOIN link ON s.episode_id = link.episode_id
    WHERE s.status = 'signed'
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM link) THEN NULL ELSE jsonb_build_object(
    'name', (SELECT pt.name FROM public.patient pt JOIN link ON pt.id = link.patient_id),
    'episodeStatus', (SELECT e.status FROM public.episode e JOIN link ON e.id = link.episode_id),
    'centrePhone', (SELECT c.phone FROM public.episode e JOIN link ON e.id = link.episode_id
      JOIN public.centre c ON c.id = e.centre_id),
    'plan', (SELECT jsonb_build_object('homeProgramme', plan.home_programme, 'weeks', plan.weeks,
      'sessionsPerWeek', plan.sessions_per_week, 'since', plan.created_at) FROM plan),
    'next', (SELECT jsonb_build_object('startsAt', n.starts_at, 'type', n.type_name,
      'centre', n.centre_name, 'mapLink', n.map_link, 'phone', n.phone, 'physio', n.physio_name)
      FROM next_visit n),
    'package', (SELECT jsonb_build_object('name', h.name, 'total', h.sessions_total,
      'used', h.sessions_used, 'validUntil', h.valid_until, 'reschedulesLeft', h.reschedules_left)
      FROM held h),
    'pain', coalesce((SELECT jsonb_agg(jsonb_build_object('number', p.number,
      'signedAt', p.signed_at, 'rest', p.pain_rest, 'activity', p.pain_activity,
      'after', p.pain_after) ORDER BY p.number) FROM pain p), '[]'::jsonb),
    'today', (SELECT day FROM today),
    'tickedToday', coalesce((SELECT jsonb_agg(t.exercise_index ORDER BY t.exercise_index)
      FROM public.exercise_tick t JOIN plan ON t.plan_of_care_id = plan.id
      WHERE t.day = (SELECT day FROM today)), '[]'::jsonb),
    'tickedDays', coalesce((SELECT jsonb_agg(d.day ORDER BY d.day) FROM (
      SELECT DISTINCT t.day FROM public.exercise_tick t JOIN link ON t.episode_id = link.episode_id
      WHERE t.day > (SELECT day FROM today) - 14) d), '[]'::jsonb),
    'trackedFrom', (SELECT internal.exercise_tracked_from(link.episode_id) FROM link),
    -- PAT-03: after discharge, what the discharging consultant wrote for the patient, as written;
    -- never the reason or the staff note.
    'maintenance', (SELECT CASE WHEN e.status = 'discharged' THEN jsonb_build_object(
        'dischargedAt', e.closed_at,
        'returnPlan', e.discharge_return_plan,
        'flarePlan', e.discharge_flare_plan,
        'ongoingNeeds', e.discharge_ongoing_needs,
        'recommendations', e.discharge_recommendations) END
      FROM public.episode e JOIN link ON e.id = link.episode_id)
  ) END
$$;--> statement-breakpoint

-- Whether no newer episode of the patient has a plan of care: a My plan link for an older episode
-- would stop the newer one's working link (only the newest My plan link works), so it is not
-- issued then. A newer episode still in intake, with no plan (and so no My plan), stops nothing.
CREATE OR REPLACE FUNCTION internal.episode_is_newest(p_episode_id uuid) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.episode e
    JOIN public.episode newer ON newer.patient_id = e.patient_id
      AND (newer.created_at, newer.id) > (e.created_at, e.id)
    WHERE e.id = p_episode_id
      AND EXISTS (SELECT 1 FROM public.plan_of_care p WHERE p.episode_id = newer.id)
  )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.episode_is_newest(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.episode_is_newest(uuid) TO authenticated;--> statement-breakpoint

DROP POLICY patient_link_my_plan_issue ON public.patient_link;--> statement-breakpoint
CREATE POLICY patient_link_my_plan_issue ON public.patient_link FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT internal.jwt_checks_in())
    AND purpose = 'my_plan'
    AND EXISTS (SELECT 1 FROM public.episode e
      WHERE e.id = episode_id AND e.patient_id = patient_link.patient_id
        AND internal.jwt_sees_centre(e.centre_id))
    AND (SELECT internal.episode_is_newest(episode_id))
  );

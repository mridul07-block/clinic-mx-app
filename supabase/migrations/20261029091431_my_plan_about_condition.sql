-- CLN-08 (PRD J3.8, M13: "diagnosis in plain words"): My plan shows the patient the approved
-- explanation of their condition (AI-07), for the episode's confirmed diagnosis or else its newest
-- signed one; nothing when none is approved. As before otherwise. Recommended defaults chosen under
-- the user's standing approval, 29 October 2026 (DECISION CLN-08; docs/runbooks/patient-content.md).

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
      FROM public.episode e JOIN link ON e.id = link.episode_id),
    -- CLN-08: the diagnosis in plain words, only as a consultant who treats patients approved it
    -- (AI-07), for the episode's confirmed diagnosis (AI-05) or else its newest signed one.
    'aboutCondition', (SELECT pc.explanation FROM public.kb_patient_content pc
      WHERE pc.status = 'approved' AND pc.condition_id = (
        SELECT coalesce(
          (SELECT cd.condition_id FROM public.confirmed_diagnosis cd JOIN link
            ON cd.episode_id = link.episode_id ORDER BY cd.confirmed_at DESC, cd.id DESC LIMIT 1),
          (SELECT d.condition_id FROM public.diagnosis d
            JOIN public.consultation c ON c.id = d.consultation_id AND c.status = 'signed'
            JOIN link ON d.episode_id = link.episode_id
            ORDER BY c.signed_at DESC, c.id DESC LIMIT 1)
        )
      ))
  ) END
$$;

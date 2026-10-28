-- PAT-02: home exercise ticks and adherence (PRD J5.7; Frontend Specification "Exercise row",
-- "Week strip"). Recommended defaults chosen under the user's standing approval, 28 October 2026
-- (DECISION PAT-02, docs/runbooks/my-plan.md). The patient ticks each exercise of their newest plan
-- on My plan, for today (IST) only, and may untick it the same day. A day counts as done when any
-- exercise was ticked. The next session note shows the days done since the session before.

CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.exercise_tick
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint

-- Velyx support stays read only here too (IAM-08); staff never tick, and read ticks only through
-- the functions below.
CREATE POLICY support_read_only_insert ON public.exercise_tick AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.exercise_tick AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.exercise_tick AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.exercise_tick FROM authenticated;--> statement-breakpoint

-- What the page's My plan link may tick: its episode's newest plan, today in IST. SECURITY
-- DEFINER: the patient reads no plan of care itself. Empty for any other link.
CREATE OR REPLACE FUNCTION internal.exercise_tick_subject()
RETURNS TABLE (
  patient_id uuid, episode_id uuid, plan_of_care_id uuid, home_programme jsonb, today date
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT l.patient_id, l.episode_id, p.id, p.home_programme,
    (now() AT TIME ZONE 'Asia/Kolkata')::date
  FROM public.patient_link l
  JOIN public.episode e ON e.id = l.episode_id AND e.patient_id = l.patient_id
  JOIN LATERAL (
    SELECT p.id, p.home_programme FROM public.plan_of_care p
    WHERE p.episode_id = e.id ORDER BY p.version DESC LIMIT 1
  ) p ON true
  WHERE l.id = internal.jwt_patient_link_id()
    AND l.purpose = 'my_plan'
    AND l.revoked_at IS NULL AND l.expires_at > now()
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.exercise_tick_subject() FROM PUBLIC, anon, authenticated;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.exercise_tick_subject() TO clinic_patient;--> statement-breakpoint

-- The patient ticks a row of that plan for today, as it reads now; sees their episode's ticks;
-- and unticks today's only. Nobody changes a tick.
GRANT SELECT, INSERT, DELETE ON public.exercise_tick TO clinic_patient;--> statement-breakpoint
CREATE POLICY exercise_tick_patient_read ON public.exercise_tick FOR SELECT TO clinic_patient
  USING (episode_id = (SELECT s.episode_id FROM internal.exercise_tick_subject() s));--> statement-breakpoint
CREATE POLICY exercise_tick_patient_tick ON public.exercise_tick FOR INSERT TO clinic_patient
  WITH CHECK (
    patient_link_id = (SELECT internal.jwt_patient_link_id())
    AND ticked_at = now()
    AND EXISTS (
      SELECT 1 FROM internal.exercise_tick_subject() s
      WHERE s.patient_id = exercise_tick.patient_id
        AND s.episode_id = exercise_tick.episode_id
        AND s.plan_of_care_id = exercise_tick.plan_of_care_id
        AND s.today = exercise_tick.day
        AND exercise_tick.exercise_index < jsonb_array_length(s.home_programme)
        AND s.home_programme -> exercise_tick.exercise_index ->> 'exercise' = exercise_tick.exercise
    )
  );--> statement-breakpoint
CREATE POLICY exercise_tick_patient_untick ON public.exercise_tick FOR DELETE TO clinic_patient
  USING (
    EXISTS (
      SELECT 1 FROM internal.exercise_tick_subject() s
      WHERE s.episode_id = exercise_tick.episode_id AND s.today = exercise_tick.day
    )
  );--> statement-breakpoint

-- The first IST day the patient could tick: once the episode had both a plan and a My plan link.
-- Days before it are not tracked, never missed. Null when it has not had both yet.
CREATE OR REPLACE FUNCTION internal.exercise_tracked_from(p_episode_id uuid) RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT greatest(
    (SELECT min((p.created_at AT TIME ZONE 'Asia/Kolkata')::date)
      FROM public.plan_of_care p WHERE p.episode_id = p_episode_id),
    (SELECT min((l.created_at AT TIME ZONE 'Asia/Kolkata')::date)
      FROM public.patient_link l WHERE l.episode_id = p_episode_id AND l.purpose = 'my_plan')
  )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.exercise_tracked_from(uuid) FROM PUBLIC, anon, authenticated;--> statement-breakpoint

-- My plan (PAT-01) gains the ticks: today's for the newest plan, the days done lately and the first
-- day the patient could tick, for the week strip. Otherwise as before.
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
    'trackedFrom', (SELECT internal.exercise_tracked_from(link.episode_id) FROM link)
  ) END
$$;--> statement-breakpoint

-- The adherence line on a session note (PAT-02): the IST days from the day after the visit of the
-- episode's signed session before this one (or the day its first plan was made) to the day before
-- this session, and the days among them with any exercise ticked; whether the episode had a My
-- plan link by then. For those who read clinical records; anyone else is refused.
CREATE OR REPLACE FUNCTION internal.session_adherence(p_session_id uuid) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  this record;
  previous date;
  from_day date;
  to_day date;
BEGIN
  IF NOT coalesce(internal.jwt_clinical_reader(), false) THEN
    RAISE EXCEPTION 'Adherence is for those who read clinical records'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT s.episode_id, s.number, (a.starts_at AT TIME ZONE 'Asia/Kolkata')::date AS day
    INTO this
    FROM public.session s JOIN public.appointment a ON a.id = s.appointment_id
    WHERE s.id = p_session_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  -- The previous visit's own day: a note signed later still covers the visit it records.
  SELECT (a.starts_at AT TIME ZONE 'Asia/Kolkata')::date INTO previous
    FROM public.session s JOIN public.appointment a ON a.id = s.appointment_id
    WHERE s.episode_id = this.episode_id AND s.status = 'signed' AND s.number < this.number
    ORDER BY s.number DESC
    LIMIT 1;
  IF previous IS NOT NULL THEN
    from_day := previous + 1;
  ELSE
    SELECT min((p.created_at AT TIME ZONE 'Asia/Kolkata')::date) INTO from_day
      FROM public.plan_of_care p WHERE p.episode_id = this.episode_id;
  END IF;
  to_day := this.day - 1;
  IF from_day IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object(
    'from', from_day,
    'to', to_day,
    'since', CASE WHEN previous IS NULL THEN 'plan' ELSE 'last_session' END,
    'days', greatest(to_day - from_day + 1, 0),
    'daysDone', (SELECT count(DISTINCT t.day) FROM public.exercise_tick t
      WHERE t.episode_id = this.episode_id AND t.day BETWEEN from_day AND to_day),
    'tracked', EXISTS (SELECT 1 FROM public.patient_link l
      WHERE l.episode_id = this.episode_id AND l.purpose = 'my_plan'
        AND (l.created_at AT TIME ZONE 'Asia/Kolkata')::date <= to_day)
  );
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.session_adherence(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.session_adherence(uuid) TO authenticated;--> statement-breakpoint

-- The days in a range with any exercise ticked, and the first day the patient could tick, for the
-- Progress tab's week strip; for those who read clinical records.
CREATE OR REPLACE FUNCTION internal.exercise_ticked_days(p_episode_id uuid, p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT coalesce(internal.jwt_clinical_reader(), false) THEN
    RAISE EXCEPTION 'Adherence is for those who read clinical records'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN jsonb_build_object(
    'days', coalesce((SELECT jsonb_agg(d.day ORDER BY d.day) FROM (
      SELECT DISTINCT t.day FROM public.exercise_tick t
      WHERE t.episode_id = p_episode_id AND t.day BETWEEN p_from AND p_to) d), '[]'::jsonb),
    'trackedFrom', internal.exercise_tracked_from(p_episode_id)
  );
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.exercise_ticked_days(uuid, date, date) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.exercise_ticked_days(uuid, date, date) TO authenticated;

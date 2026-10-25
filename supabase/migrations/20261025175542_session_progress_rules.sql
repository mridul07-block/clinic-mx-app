-- SES-01: session check in (PRD J5.1; user decisions, 25 October 2026). For appointments of a
-- type in packages.session_appointment_types (Session, Zero Gravity Treadmill): the session's
-- number in its episode once checked in (1 + the episode's earlier checked in, in progress or
-- completed session appointments, by arrival; no shows and cancellations never count, and an
-- undone check in gives its number back), the plan's planned sessions (sessions per week x weeks
-- of the newest plan) and the episode's status, from which the gate is worked out. A SECURITY
-- DEFINER read, so the front desk gets the planned total without reading the plan; it answers
-- only for appointments at centres the reader sees.
CREATE OR REPLACE FUNCTION internal.session_progress(appointment_ids uuid[])
RETURNS TABLE (
  appointment_id uuid,
  session_number integer,
  planned integer,
  episode_status public.episode_status
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
    (SELECT e.status FROM public.episode e WHERE e.id = asked.episode_id)
  FROM asked
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.session_progress(uuid[]) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.session_progress(uuid[]) TO authenticated;

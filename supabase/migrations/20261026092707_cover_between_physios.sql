-- Cover between physios (SES-08; user decisions 26 October 2026). Physios with the Treats
-- patients tick read the appointments at the centres they work at, and may start a colleague's
-- checked in Session or Zero Gravity Treadmill visit there: the note is then the covering
-- physio's own, written and signed by them, while the visit stays booked with its own physio.
-- Consultations are not covered. Once started, the starter owns the note.

-- Whether a staff member may cover this visit: active with the tick, working at its centre, a
-- session kind of visit, not their own.
CREATE OR REPLACE FUNCTION internal.covers_visit(appointment_id uuid, staff_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT internal.staff_treats(covers_visit.staff_id)
    AND EXISTS (
      SELECT 1 FROM public.appointment a
      JOIN public.appointment_type t ON t.id = a.appointment_type_id
      JOIN public.staff_user_centre c
        ON c.centre_id = a.centre_id AND c.staff_user_id = covers_visit.staff_id
      WHERE a.id = covers_visit.appointment_id
        AND a.physio_id <> covers_visit.staff_id
        AND coalesce(
          (SELECT s.value FROM public.setting s WHERE s.key = 'packages.session_appointment_types'),
          '["session", "zero_gravity_treadmill"]') ? t.key
    )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.covers_visit(uuid, uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.covers_visit(uuid, uuid) TO authenticated;--> statement-breakpoint

DROP POLICY appointment_read ON public.appointment;--> statement-breakpoint
CREATE POLICY appointment_read ON public.appointment FOR SELECT TO authenticated
  USING (
    ((SELECT internal.jwt_edits_patients()) AND internal.jwt_sees_centre(centre_id))
    OR physio_id = (SELECT internal.jwt_staff_id())
    OR ((SELECT internal.jwt_treats()) AND internal.jwt_sees_centre(centre_id))
  );--> statement-breakpoint

CREATE POLICY appointment_cover_start ON public.appointment FOR UPDATE TO authenticated
  USING (
    appointment.status = 'checked_in'
    AND internal.covers_visit(appointment.id, (SELECT internal.jwt_staff_id()))
  )
  WITH CHECK (
    appointment.started_by = (SELECT internal.jwt_staff_id())
    AND internal.covers_visit(appointment.id, (SELECT internal.jwt_staff_id()))
  );--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.appointment_status_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  on_its_day boolean := (now() AT TIME ZONE 'Asia/Kolkata')::date
    = (OLD.starts_at AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  IF OLD.status IN ('cancelled', 'rescheduled') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'A cancelled or rescheduled appointment never changes'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IN ('cancelled', 'rescheduled') AND NEW.status IS DISTINCT FROM OLD.status
     AND OLD.status NOT IN ('booked', 'confirmed') THEN
    RAISE EXCEPTION 'Only a booked or confirmed appointment is cancelled or rescheduled'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'no_show' AND OLD.status IS DISTINCT FROM 'no_show'
     AND (OLD.status NOT IN ('booked', 'confirmed') OR now() < OLD.starts_at) THEN
    RAISE EXCEPTION 'Only a booked or confirmed appointment whose start has passed is a no show'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'no_show' AND NEW.status IS DISTINCT FROM 'no_show'
     AND (NEW.status NOT IN ('booked', 'confirmed') OR NOT on_its_day) THEN
    RAISE EXCEPTION 'A no show goes back to booked or confirmed, on its own day only'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'checked_in' AND OLD.status IS DISTINCT FROM 'checked_in'
     AND (OLD.status NOT IN ('booked', 'confirmed') OR NOT on_its_day) THEN
    RAISE EXCEPTION 'Only a booked or confirmed appointment is checked in, on its own day'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'checked_in' AND NEW.status IN ('booked', 'confirmed') AND NOT on_its_day THEN
    RAISE EXCEPTION 'A check in is undone on the appointment''s own day only'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'in_progress' AND OLD.status IS DISTINCT FROM 'in_progress'
     AND (OLD.status <> 'checked_in' OR NOT on_its_day
          OR (NEW.started_by IS DISTINCT FROM NEW.physio_id
              AND NOT internal.covers_visit(NEW.id, NEW.started_by))) THEN
    RAISE EXCEPTION 'Only a checked in appointment is started, on its own day, by its own physio or a colleague covering a session'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'in_progress' AND NEW.status NOT IN ('in_progress', 'completed') THEN
    RAISE EXCEPTION 'A started appointment only goes on to completed'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.session_open() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  visit record;
  kinds jsonb := coalesce(
    (SELECT s.value FROM public.setting s WHERE s.key = 'packages.session_appointment_types'),
    '["session", "zero_gravity_treadmill"]');
BEGIN
  SELECT a.id, a.episode_id, a.patient_id, a.centre_id, a.physio_id, a.started_by, a.arrived_at,
      t.key AS type_key
    INTO visit
    FROM public.appointment a
    JOIN public.appointment_type t ON t.id = a.appointment_type_id
    WHERE a.id = NEW.appointment_id;
  IF NOT FOUND OR visit.episode_id IS NULL OR visit.arrived_at IS NULL THEN
    RAISE EXCEPTION 'A session opens on a checked in visit in an episode'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT kinds ? visit.type_key THEN
    RAISE EXCEPTION 'Only a session visit has a session note' USING ERRCODE = 'check_violation';
  END IF;
  NEW.episode_id := visit.episode_id;
  NEW.patient_id := visit.patient_id;
  NEW.centre_id := visit.centre_id;
  -- The writer: whoever started the visit, its own physio or a colleague covering (SES-08).
  NEW.physio_id := coalesce(visit.started_by, visit.physio_id);
  -- Session n of the episode, as SES-01 counts it: by arrival, no shows and cancellations aside.
  NEW.number := 1 + (
    SELECT count(*)
    FROM public.appointment o
    JOIN public.appointment_type ot ON ot.id = o.appointment_type_id
    WHERE o.episode_id = visit.episode_id
      AND o.id <> visit.id
      AND kinds ? ot.key
      AND o.status IN ('checked_in', 'in_progress', 'completed')
      AND (o.arrived_at, o.id) < (visit.arrived_at, visit.id)
  );
  NEW.plan_of_care_id := (
    SELECT p.id FROM public.plan_of_care p
    WHERE p.episode_id = visit.episode_id ORDER BY p.version DESC LIMIT 1
  );
  NEW.status := 'draft';
  NEW.signed_by := NULL;
  NEW.signed_at := NULL;
  NEW.package_id := NULL;
  NEW.pain_rest := NULL;
  NEW.pain_activity := NULL;
  NEW.pain_after := NULL;
  NEW.version := 1;
  RETURN NEW;
END;
$$;--> statement-breakpoint

DROP POLICY session_open ON public.session;--> statement-breakpoint
CREATE POLICY session_open ON public.session FOR INSERT TO authenticated
  WITH CHECK (
    session.physio_id = (SELECT internal.jwt_staff_id())
    AND (SELECT internal.jwt_treats())
    AND session.status = 'draft'
    AND EXISTS (
      SELECT 1 FROM public.appointment a
      WHERE a.id = session.appointment_id
        AND a.started_by = session.physio_id
        AND a.status = 'in_progress'
    )
  );

-- CLN-01: My patients today. A treating physio starts their own checked in appointment on its
-- day, and it becomes In progress ("With physio" on Today); nobody else starts it for them (user
-- decision 24 October 2026). The status guard keeps every earlier rule and adds: In progress only
-- from Checked in, on its own IST day, started by the appointment's physio; from In progress only
-- on to Completed. A physio who does not edit patients may make only that change to their own
-- appointment. They also read the health form link and consent of their own appointments, for the
-- form status on their list.
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
          OR NEW.started_by IS DISTINCT FROM NEW.physio_id) THEN
    RAISE EXCEPTION 'Only a checked in appointment is started, on its own day, by its own physio'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'in_progress' AND NEW.status NOT IN ('in_progress', 'completed') THEN
    RAISE EXCEPTION 'A started appointment only goes on to completed'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

-- A physio reaches their own appointments through appointment_start; this keeps that to the start.
CREATE OR REPLACE FUNCTION internal.appointment_physio_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  moving text[] := ARRAY['status', 'started_at', 'started_by', 'updated_at'];
BEGIN
  IF internal.jwt_staff_id() IS NULL OR internal.jwt_edits_patients() THEN
    RETURN NEW;
  END IF;
  IF NOT (OLD.status = 'checked_in' AND NEW.status = 'in_progress'
          AND (to_jsonb(NEW) - moving) = (to_jsonb(OLD) - moving)) THEN
    RAISE EXCEPTION 'A physio only starts their own checked in appointment'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.appointment_physio_change() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER appointment_physio_change BEFORE UPDATE ON public.appointment
  FOR EACH ROW EXECUTE FUNCTION internal.appointment_physio_change();--> statement-breakpoint

CREATE POLICY appointment_start ON public.appointment FOR UPDATE TO authenticated
  USING (
    appointment.physio_id = (SELECT internal.jwt_staff_id()) AND (SELECT internal.jwt_treats())
  )
  WITH CHECK (
    appointment.physio_id = (SELECT internal.jwt_staff_id()) AND (SELECT internal.jwt_treats())
  );--> statement-breakpoint

CREATE POLICY patient_link_physio_read ON public.patient_link FOR SELECT TO authenticated
  USING (
    (SELECT internal.jwt_treats())
    AND patient_link.purpose = 'health_form'
    AND EXISTS (
      SELECT 1 FROM public.appointment a
      WHERE a.id = patient_link.appointment_id AND a.physio_id = (SELECT internal.jwt_staff_id())
    )
  );--> statement-breakpoint
CREATE POLICY consent_record_physio_read ON public.consent_record FOR SELECT TO authenticated
  USING (
    (SELECT internal.jwt_treats())
    AND EXISTS (
      SELECT 1 FROM public.appointment a
      WHERE a.id = consent_record.appointment_id
        AND a.physio_id = (SELECT internal.jwt_staff_id())
    )
  );

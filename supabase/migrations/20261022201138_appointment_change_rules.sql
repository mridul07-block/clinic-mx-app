-- SCH-08: reschedule and cancel. Only a Booked or Confirmed appointment becomes Cancelled or
-- Rescheduled, and after that it never changes again; a reschedule books a new appointment that
-- points to the one it replaced, and that link never changes either. Who asked (patient or
-- clinic), who did it and when are on the row (appointment_change) and in the audit trail.
CREATE OR REPLACE FUNCTION internal.appointment_fixed() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF (NEW.number, NEW.patient_id, NEW.centre_id, NEW.physio_id, NEW.appointment_type_id,
      NEW.starts_at, NEW.ends_at, NEW.channel, NEW.booked_by, NEW.machine, NEW.machine_unit,
      NEW.rescheduled_from_id)
    IS DISTINCT FROM
     (OLD.number, OLD.patient_id, OLD.centre_id, OLD.physio_id, OLD.appointment_type_id,
      OLD.starts_at, OLD.ends_at, OLD.channel, OLD.booked_by, OLD.machine, OLD.machine_unit,
      OLD.rescheduled_from_id) THEN
    RAISE EXCEPTION 'An appointment''s number, patient, place, physio, type and time never change; a reschedule books a new one'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.appointment_status_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
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
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.appointment_status_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER appointment_status_guard BEFORE UPDATE ON public.appointment
  FOR EACH ROW EXECUTE FUNCTION internal.appointment_status_guard();

-- INT-11: no shows (PRD J2.9). Only a Booked or Confirmed appointment whose start has passed
-- becomes No show (the service also waits day.no_show_allowed_minutes); a no show marked by
-- mistake goes back to Booked or Confirmed on the appointment's own day in IST, and the count
-- goes back down with it (user decision 23 October 2026).
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
  IF NEW.status = 'no_show' AND OLD.status IS DISTINCT FROM 'no_show'
     AND (OLD.status NOT IN ('booked', 'confirmed') OR now() < OLD.starts_at) THEN
    RAISE EXCEPTION 'Only a booked or confirmed appointment whose start has passed is a no show'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'no_show' AND NEW.status IS DISTINCT FROM 'no_show'
     AND (NEW.status NOT IN ('booked', 'confirmed')
          OR (now() AT TIME ZONE 'Asia/Kolkata')::date
             <> (OLD.starts_at AT TIME ZONE 'Asia/Kolkata')::date) THEN
    RAISE EXCEPTION 'A no show goes back to booked or confirmed, on its own day only'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.count_booking_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'rescheduled' AND NEW.change_reason = 'patient' THEN
    INSERT INTO public.booking_counter (patient_id, reschedules) VALUES (NEW.patient_id, 1)
    ON CONFLICT (patient_id) DO UPDATE
      SET reschedules = public.booking_counter.reschedules + 1, updated_at = now();
  ELSIF NEW.status = 'no_show' THEN
    INSERT INTO public.booking_counter (patient_id, no_shows) VALUES (NEW.patient_id, 1)
    ON CONFLICT (patient_id) DO UPDATE
      SET no_shows = public.booking_counter.no_shows + 1, updated_at = now();
  ELSIF OLD.status = 'no_show' THEN
    -- An undone no show: never below zero, so a block lifted in between stays lifted.
    UPDATE public.booking_counter
      SET no_shows = greatest(no_shows - 1, 0), updated_at = now()
      WHERE patient_id = NEW.patient_id AND no_shows > 0;
  END IF;
  RETURN NULL;
END;
$$;

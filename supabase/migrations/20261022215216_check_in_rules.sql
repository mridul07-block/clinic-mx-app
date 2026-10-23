-- INT-01: checking in (PRD J2.1). Only a Booked or Confirmed appointment becomes Checked in, on
-- its own day in IST; a check in made by mistake goes back to Booked or Confirmed on that day too
-- (user decision 23 October 2026). The SCH-08 and INT-11 rules stay as they were.
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
  RETURN NEW;
END;
$$;

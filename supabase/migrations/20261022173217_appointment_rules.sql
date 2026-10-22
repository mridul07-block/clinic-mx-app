-- SCH-04: the slot engine. No overbooking (PRD J1.8 and section 7, fixed): a physio is never in
-- two appointments at once, at any centre, and a centre's machine unit never twice (decision G2);
-- exclusion constraints refuse it while an appointment holds its slot, whatever the code does.
-- Holds keep a picked slot for one holder for booking.slot_hold_minutes (TAD section 6); the
-- booking transaction rechecks holds and appointments together under a lock
-- (packages/db/src/slots.ts). The booking roles (Super Admin, Centre Managers, Front Desk) book
-- at centres they see; a physio reads their own appointments (calendar.view own). Nobody deletes
-- an appointment; every change is audited. Holds are transient and not audited (like rate_limit).

-- Every overlap is refused while the appointment or hold keeps its time (G2: no buffer, so
-- touching ends are allowed; tstzrange is [start, end)).
ALTER TABLE public.appointment ADD CONSTRAINT appointment_physio_no_overlap
  EXCLUDE USING gist (physio_id WITH =, tstzrange(starts_at, ends_at) WITH &&)
  WHERE (status NOT IN ('cancelled', 'rescheduled'));--> statement-breakpoint
ALTER TABLE public.appointment ADD CONSTRAINT appointment_machine_no_overlap
  EXCLUDE USING gist (
    centre_id WITH =, machine WITH =, machine_unit WITH =, tstzrange(starts_at, ends_at) WITH &&
  )
  WHERE (machine IS NOT NULL AND status NOT IN ('cancelled', 'rescheduled'));--> statement-breakpoint
ALTER TABLE public.slot_hold ADD CONSTRAINT slot_hold_physio_no_overlap
  EXCLUDE USING gist (physio_id WITH =, tstzrange(starts_at, ends_at) WITH &&);--> statement-breakpoint
ALTER TABLE public.slot_hold ADD CONSTRAINT slot_hold_machine_no_overlap
  EXCLUDE USING gist (
    centre_id WITH =, machine WITH =, machine_unit WITH =, tstzrange(starts_at, ends_at) WITH &&
  )
  WHERE (machine IS NOT NULL);--> statement-breakpoint

-- Every new appointment gets its centre's prefix and next number, for example MVK-00042
-- (decision G6). Whatever the caller gave is replaced.
CREATE OR REPLACE FUNCTION internal.appointment_number() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  prefix text;
BEGIN
  SELECT appointment_prefix INTO prefix FROM public.centre WHERE id = NEW.centre_id;
  IF prefix IS NULL THEN
    RAISE EXCEPTION 'No centre % to book the appointment at', NEW.centre_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  NEW.number := prefix || '-'
    || lpad(internal.next_centre_number(NEW.centre_id, 'appointment')::text, 5, '0');
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.appointment_number() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER appointment_number BEFORE INSERT ON public.appointment
  FOR EACH ROW EXECUTE FUNCTION internal.appointment_number();--> statement-breakpoint

-- What was booked stays as booked: a reschedule books a new appointment and marks this one
-- Rescheduled (SCH-08), so the history shows both.
CREATE OR REPLACE FUNCTION internal.appointment_fixed() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF (NEW.number, NEW.patient_id, NEW.centre_id, NEW.physio_id, NEW.appointment_type_id,
      NEW.starts_at, NEW.ends_at, NEW.channel, NEW.booked_by, NEW.machine, NEW.machine_unit)
    IS DISTINCT FROM
     (OLD.number, OLD.patient_id, OLD.centre_id, OLD.physio_id, OLD.appointment_type_id,
      OLD.starts_at, OLD.ends_at, OLD.channel, OLD.booked_by, OLD.machine, OLD.machine_unit) THEN
    RAISE EXCEPTION 'An appointment''s number, patient, place, physio, type and time never change; a reschedule books a new one'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.appointment_fixed() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER appointment_fixed BEFORE UPDATE ON public.appointment
  FOR EACH ROW EXECUTE FUNCTION internal.appointment_fixed();--> statement-breakpoint

-- A centre's code and appointment prefix never change (SCH-01, SCH-04).
CREATE OR REPLACE FUNCTION internal.centre_code_fixed() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF NEW.code IS DISTINCT FROM OLD.code THEN
    RAISE EXCEPTION 'A centre''s code never changes' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.appointment_prefix IS DISTINCT FROM OLD.appointment_prefix THEN
    RAISE EXCEPTION 'A centre''s appointment prefix never changes' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

-- Whether the caller may read busy times: the server's own connection (no claims), or a signed
-- in staff member. Anyone else is refused.
CREATE OR REPLACE FUNCTION internal.assert_staff_or_server() RETURNS void
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
BEGIN
  IF coalesce(current_setting('request.jwt.claims', true), '') <> ''
    AND internal.jwt_staff_id() IS NULL THEN
    RAISE EXCEPTION 'Only staff read busy times' USING ERRCODE = 'insufficient_privilege';
  END IF;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.assert_staff_or_server() FROM PUBLIC;--> statement-breakpoint

-- When physios are busy between two instants: appointments that hold their slot at any centre,
-- other holders' live holds, and approved leave, by kind. Times only, never who or why, so a
-- front desk sees a physio's day at another centre and their leave without reading those records.
CREATE OR REPLACE FUNCTION internal.busy_times(
  physio_ids uuid[],
  from_at timestamptz,
  to_at timestamptz,
  own_holder text
) RETURNS TABLE (physio_id uuid, kind text, starts_at timestamptz, ends_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  PERFORM internal.assert_staff_or_server();
  RETURN QUERY
    SELECT a.physio_id, 'appointment', a.starts_at, a.ends_at FROM public.appointment a
    WHERE a.physio_id = ANY (physio_ids) AND a.status NOT IN ('cancelled', 'rescheduled')
      AND a.starts_at < to_at AND a.ends_at > from_at
    UNION ALL
    SELECT h.physio_id, 'hold', h.starts_at, h.ends_at FROM public.slot_hold h
    WHERE h.physio_id = ANY (physio_ids) AND h.expires_at > now()
      AND h.holder IS DISTINCT FROM own_holder
      AND h.starts_at < to_at AND h.ends_at > from_at
    UNION ALL
    SELECT l.staff_user_id, 'leave', l.starts_at, l.ends_at FROM public.staff_leave l
    WHERE l.staff_user_id = ANY (physio_ids) AND l.status = 'approved'
      AND l.starts_at < to_at AND l.ends_at > from_at;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.busy_times(uuid[], timestamptz, timestamptz, text)
  FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.busy_times(uuid[], timestamptz, timestamptz, text)
  TO authenticated;--> statement-breakpoint

-- When each unit of a centre's machine is busy: appointments and other holders' live holds.
CREATE OR REPLACE FUNCTION internal.machine_busy(
  centre uuid,
  machine_key text,
  from_at timestamptz,
  to_at timestamptz,
  own_holder text
) RETURNS TABLE (machine_unit integer, starts_at timestamptz, ends_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  PERFORM internal.assert_staff_or_server();
  RETURN QUERY
    SELECT a.machine_unit, a.starts_at, a.ends_at FROM public.appointment a
    WHERE a.centre_id = centre AND a.machine = machine_key
      AND a.status NOT IN ('cancelled', 'rescheduled')
      AND a.starts_at < to_at AND a.ends_at > from_at
    UNION ALL
    SELECT h.machine_unit, h.starts_at, h.ends_at FROM public.slot_hold h
    WHERE h.centre_id = centre AND h.machine = machine_key AND h.expires_at > now()
      AND h.holder IS DISTINCT FROM own_holder
      AND h.starts_at < to_at AND h.ends_at > from_at;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.machine_busy(uuid, text, timestamptz, timestamptz, text)
  FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.machine_busy(uuid, text, timestamptz, timestamptz, text)
  TO authenticated;--> statement-breakpoint

-- Expired holds give their time back. The booking transaction calls this before it writes (the
-- exclusion constraints cannot look at the clock), and pg_cron every minute (TAD section 8).
CREATE OR REPLACE FUNCTION internal.release_expired_slot_holds() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  released integer;
BEGIN
  PERFORM internal.assert_staff_or_server();
  DELETE FROM public.slot_hold WHERE expires_at <= now();
  GET DIAGNOSTICS released = ROW_COUNT;
  RETURN released;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.release_expired_slot_holds() FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.release_expired_slot_holds() TO authenticated;--> statement-breakpoint
-- Every minute. cron.schedule replaces a job with the same name, so this is safe to re-run.
SELECT cron.schedule('slot-hold-release', '* * * * *', 'SELECT internal.release_expired_slot_holds()');--> statement-breakpoint

CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.appointment
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint

CREATE POLICY appointment_read ON public.appointment FOR SELECT TO authenticated
  USING (
    ((SELECT internal.jwt_edits_patients()) AND internal.jwt_sees_centre(centre_id))
    OR physio_id = (SELECT internal.jwt_staff_id())
  );--> statement-breakpoint
CREATE POLICY appointment_insert ON public.appointment FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT internal.jwt_edits_patients())
    AND internal.jwt_sees_centre(centre_id)
    AND booked_by = (SELECT internal.jwt_staff_id())
  );--> statement-breakpoint
CREATE POLICY appointment_update ON public.appointment FOR UPDATE TO authenticated
  USING ((SELECT internal.jwt_edits_patients()) AND internal.jwt_sees_centre(centre_id))
  WITH CHECK ((SELECT internal.jwt_edits_patients()) AND internal.jwt_sees_centre(centre_id));--> statement-breakpoint

-- A staff member's own hold, at a centre they book for.
CREATE POLICY slot_hold_own ON public.slot_hold FOR ALL TO authenticated
  USING (holder = 'staff:' || (SELECT internal.jwt_staff_id())::text)
  WITH CHECK (
    holder = 'staff:' || (SELECT internal.jwt_staff_id())::text
    AND (SELECT internal.jwt_edits_patients())
    AND internal.jwt_sees_centre(centre_id)
  );--> statement-breakpoint

-- Velyx support stays read only here too (IAM-08).
CREATE POLICY support_read_only_insert ON public.appointment AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.appointment AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.appointment AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_insert ON public.slot_hold AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.slot_hold AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.slot_hold AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint

SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint
-- User decision 22 October 2026: Consultation and Review are booked with a consultant; a Zero
-- Gravity Treadmill appointment also takes one of the centre's treadmills.
UPDATE public.appointment_type SET needs_consultant = true, updated_at = now()
  WHERE key IN ('consultation', 'review') AND NOT needs_consultant;--> statement-breakpoint
UPDATE public.appointment_type SET machine = 'zero_gravity_treadmill', updated_at = now()
  WHERE key = 'zero_gravity_treadmill' AND machine IS NULL;--> statement-breakpoint
-- TAD section 6: a picked slot is held for 5 minutes.
INSERT INTO public.setting (key, value, updated_by) VALUES
  ('booking.slot_hold_minutes', '5', 'system:migration')
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint
SELECT set_config('audit.actor', '', false);

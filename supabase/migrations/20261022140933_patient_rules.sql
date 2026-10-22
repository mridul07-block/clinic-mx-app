-- SCH-01: patients, keyed by person. Every signed in staff member reads every patient (records are
-- shared across centres, PRD J7.6); the Super Admin, Centre Managers and the Front Desk add them at
-- a centre they see and edit their details (patients.edit_contact). Nobody deletes a patient. The
-- OP number comes from the registering centre's sequence and, like that centre and the centre's
-- code, never changes. Every change is audited.

-- The next number in a centre's sequence. The upsert holds the sequence row's lock until the
-- transaction ends, so two bookings at once get different numbers, and a rolled back insert gives
-- its number back: no gaps, no repeats. Only the triggers below call it.
CREATE OR REPLACE FUNCTION internal.next_centre_number(
  centre uuid,
  sequence_kind public.centre_sequence_kind
) RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  INSERT INTO public.centre_sequence AS s (centre_id, kind, last_value)
  VALUES (centre, sequence_kind, 1)
  ON CONFLICT (centre_id, kind) DO UPDATE SET last_value = s.last_value + 1
  RETURNING last_value
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.next_centre_number(uuid, public.centre_sequence_kind)
  FROM PUBLIC, anon, authenticated;--> statement-breakpoint

-- Every new patient gets the registering centre's code and its next number, for example
-- HSR-00042 (user decision, 22 October 2026). Whatever the caller gave is replaced.
CREATE OR REPLACE FUNCTION internal.patient_op_number() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  centre_code text;
BEGIN
  SELECT code INTO centre_code FROM public.centre WHERE id = NEW.registered_centre_id;
  IF centre_code IS NULL THEN
    RAISE EXCEPTION 'No centre % to register the patient at', NEW.registered_centre_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  NEW.op_number := centre_code || '-'
    || lpad(internal.next_centre_number(NEW.registered_centre_id, 'op_number')::text, 5, '0');
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.patient_op_number() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER patient_op_number BEFORE INSERT ON public.patient
  FOR EACH ROW EXECUTE FUNCTION internal.patient_op_number();--> statement-breakpoint

-- The OP number and the registering centre stay as issued.
CREATE OR REPLACE FUNCTION internal.patient_number_fixed() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF NEW.op_number IS DISTINCT FROM OLD.op_number
    OR NEW.registered_centre_id IS DISTINCT FROM OLD.registered_centre_id THEN
    RAISE EXCEPTION 'A patient''s OP number and registering centre never change'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.patient_number_fixed() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER patient_number_fixed BEFORE UPDATE ON public.patient
  FOR EACH ROW EXECUTE FUNCTION internal.patient_number_fixed();--> statement-breakpoint

-- A centre's code is in every OP number it issued, so it stays as set.
CREATE OR REPLACE FUNCTION internal.centre_code_fixed() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF NEW.code IS DISTINCT FROM OLD.code THEN
    RAISE EXCEPTION 'A centre''s code never changes' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.centre_code_fixed() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER centre_code_fixed BEFORE UPDATE ON public.centre
  FOR EACH ROW EXECUTE FUNCTION internal.centre_code_fixed();--> statement-breakpoint

CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.patient
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint

-- Whether the signed in person adds and edits patients (patients.edit_contact).
CREATE OR REPLACE FUNCTION internal.jwt_edits_patients() RETURNS boolean
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT coalesce(
    internal.jwt_staff_role() IN ('super_admin', 'centre_manager', 'front_desk'),
    false
  )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.jwt_edits_patients() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.jwt_edits_patients() TO authenticated;--> statement-breakpoint

CREATE POLICY patient_read ON public.patient FOR SELECT TO authenticated
  USING ((SELECT internal.jwt_staff_id()) IS NOT NULL);--> statement-breakpoint
CREATE POLICY patient_insert ON public.patient FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT internal.jwt_edits_patients())
    AND internal.jwt_sees_centre(registered_centre_id)
  );--> statement-breakpoint
CREATE POLICY patient_update ON public.patient FOR UPDATE TO authenticated
  USING ((SELECT internal.jwt_edits_patients()))
  WITH CHECK ((SELECT internal.jwt_edits_patients()));--> statement-breakpoint

-- Velyx support stays read only here too (IAM-08).
CREATE POLICY support_read_only_insert ON public.patient AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.patient AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.patient AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));

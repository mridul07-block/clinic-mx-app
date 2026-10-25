-- BIL-05: bills at fixed prices (PRD J4.6, TAD section 9; user decisions, 25 October 2026). The
-- database makes every bill, at the price master's amounts, so nobody types a price: staff read
-- bills at their centre if they see amounts (the Super Admin, Finance, the front desk there) and
-- have no INSERT, UPDATE or DELETE on bills or their lines.
--  * The consultation fee: when a consultation visit reaches the moment billing.consultation_fee_timing
--    names (after_consultation: Completed; at_check_in: Checked in), at the consultant's own fee
--    price item (decision G4), once per visit. No fee set, no bill; the desk makes it later from
--    the sheet once the Super Admin sets one. Undoing a check in cancels its unpaid bill. Charged
--    when the patient is referred out too, until the client decides (decision 13).
--  * A package: when the patient chooses one (BIL-02), at the package type's price; any later
--    choice cancels the episode's unpaid package bills.
-- Numbers are the centre's code, "B" and its next bill number: HSR-B-00001.
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.bill
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.bill_line
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint

-- Whether the signed in person sees bill amounts at this centre.
CREATE OR REPLACE FUNCTION internal.prices_centre(centre_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT internal.jwt_staff_role() IN ('super_admin', 'finance')
    OR (internal.jwt_staff_role() = 'front_desk' AND internal.jwt_sees_centre(prices_centre.centre_id))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.prices_centre(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.prices_centre(uuid) TO authenticated;--> statement-breakpoint

CREATE POLICY bill_read ON public.bill FOR SELECT TO authenticated
  USING (internal.prices_centre(bill.centre_id));--> statement-breakpoint
CREATE POLICY bill_line_read ON public.bill_line FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.bill b WHERE b.id = bill_line.bill_id));--> statement-breakpoint

-- Velyx support stays read only here too (IAM-08).
CREATE POLICY support_read_only_insert ON public.bill AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.bill AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.bill AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_insert ON public.bill_line AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.bill_line AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.bill_line AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint

-- No prices typed at the desk: nobody signed in writes a bill or a line.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.bill FROM authenticated;--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.bill_line FROM authenticated;--> statement-breakpoint

-- The centre's next bill number, for example HSR-B-00001.
CREATE OR REPLACE FUNCTION internal.next_bill_number(centre_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  centre_code text;
BEGIN
  SELECT c.code INTO centre_code FROM public.centre c WHERE c.id = next_bill_number.centre_id;
  IF centre_code IS NULL THEN
    RAISE EXCEPTION 'No centre % to bill at', next_bill_number.centre_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN centre_code || '-B-'
    || lpad(internal.next_centre_number(next_bill_number.centre_id, 'bill')::text, 5, '0');
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.next_bill_number(uuid) FROM PUBLIC;--> statement-breakpoint

-- The consultation fee bill for a visit, when it is due and not made yet: the bill's id, or null
-- when it is not a consultation, not due by the timing setting, or the consultant has no fee.
CREATE OR REPLACE FUNCTION internal.make_consultation_bill(appointment_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  visit record;
  timing text;
  fee record;
  made uuid;
BEGIN
  SELECT a.id, a.status, a.patient_id, a.episode_id, a.centre_id, a.physio_id, t.key AS type_key
    INTO visit
    FROM public.appointment a
    JOIN public.appointment_type t ON t.id = a.appointment_type_id
    WHERE a.id = make_consultation_bill.appointment_id;
  IF NOT FOUND OR visit.type_key <> 'consultation' THEN
    RETURN NULL;
  END IF;
  timing := coalesce(
    (SELECT s.value #>> '{}' FROM public.setting s WHERE s.key = 'billing.consultation_fee_timing'),
    'after_consultation');
  IF NOT (
    (timing = 'after_consultation' AND visit.status = 'completed')
    OR (timing = 'at_check_in' AND visit.status IN ('checked_in', 'in_progress', 'completed'))
  ) THEN
    RETURN NULL;
  END IF;
  SELECT b.id INTO made FROM public.bill b
    WHERE b.appointment_id = visit.id AND b.kind = 'consultation' AND b.status <> 'cancelled';
  IF made IS NOT NULL THEN
    RETURN made;
  END IF;
  SELECT p.id, p.label, p.amount_paise INTO fee
    FROM public.staff_user s
    JOIN public.price_item p ON p.id = s.consultation_price_item_id AND p.active
    WHERE s.id = visit.physio_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.bill (number, kind, patient_id, episode_id, centre_id, appointment_id,
    total_paise, created_by)
  VALUES (internal.next_bill_number(visit.centre_id), 'consultation', visit.patient_id,
    visit.episode_id, visit.centre_id, visit.id, fee.amount_paise, internal.jwt_staff_id())
  RETURNING id INTO made;
  INSERT INTO public.bill_line (bill_id, price_item_id, description, quantity, unit_paise,
    amount_paise)
  VALUES (made, fee.id, fee.label, 1, fee.amount_paise, fee.amount_paise);
  RETURN made;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.make_consultation_bill(uuid) FROM PUBLIC;--> statement-breakpoint

-- "Make the consultation bill" from the sheet, once the fee is set: for those who see amounts at
-- the visit's centre; the same rules as the trigger.
CREATE OR REPLACE FUNCTION internal.consultation_bill_now(appointment_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  visit_centre uuid;
BEGIN
  SELECT a.centre_id INTO visit_centre FROM public.appointment a
    WHERE a.id = consultation_bill_now.appointment_id;
  IF visit_centre IS NULL OR NOT internal.prices_centre(visit_centre) THEN
    RAISE EXCEPTION 'Not a visit this person bills' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN internal.make_consultation_bill(consultation_bill_now.appointment_id);
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.consultation_bill_now(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.consultation_bill_now(uuid) TO authenticated;--> statement-breakpoint

-- A visit's status change makes the fee bill when it is due, or cancels it when its check in is
-- undone.
CREATE OR REPLACE FUNCTION internal.consultation_fee_bill() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'checked_in' AND NEW.status IN ('booked', 'confirmed') THEN
    UPDATE public.bill b
      SET status = 'cancelled', cancelled_at = now(), cancel_reason = 'Check in was undone.'
      WHERE b.appointment_id = NEW.id AND b.kind = 'consultation' AND b.status = 'unpaid';
  ELSE
    PERFORM internal.make_consultation_bill(NEW.id);
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.consultation_fee_bill() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER consultation_fee_bill AFTER INSERT ON public.appointment
  FOR EACH ROW EXECUTE FUNCTION internal.consultation_fee_bill();--> statement-breakpoint
CREATE TRIGGER consultation_fee_bill_on_status AFTER UPDATE OF status ON public.appointment
  FOR EACH ROW WHEN (NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION internal.consultation_fee_bill();--> statement-breakpoint

-- The patient's choice: a package is billed at its price; any later choice cancels the episode's
-- unpaid package bills.
CREATE OR REPLACE FUNCTION internal.package_bill() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  chosen record;
  ep record;
  made uuid;
BEGIN
  UPDATE public.bill b
    SET status = 'cancelled', cancelled_at = now(), cancel_reason = 'The patient chose differently.'
    WHERE b.episode_id = NEW.episode_id AND b.kind = 'package' AND b.status = 'unpaid';
  IF NEW.choice = 'package' THEN
    SELECT p.id, p.name, p.price_paise INTO chosen
      FROM public.package_type p WHERE p.id = NEW.package_type_id;
    SELECT e.patient_id, e.centre_id INTO ep FROM public.episode e WHERE e.id = NEW.episode_id;
    INSERT INTO public.bill (number, kind, patient_id, episode_id, centre_id, plan_choice_id,
      total_paise, created_by)
    VALUES (internal.next_bill_number(ep.centre_id), 'package', ep.patient_id, NEW.episode_id,
      ep.centre_id, NEW.id, chosen.price_paise, NEW.recorded_by)
    RETURNING id INTO made;
    INSERT INTO public.bill_line (bill_id, package_type_id, description, quantity, unit_paise,
      amount_paise)
    VALUES (made, chosen.id, chosen.name, 1, chosen.price_paise, chosen.price_paise);
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.package_bill() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER package_bill AFTER INSERT ON public.plan_choice
  FOR EACH ROW EXECUTE FUNCTION internal.package_bill();

-- BIL-06: counter payment recording (PRD J4.6, J4.7; TAD sections 4 and 9; user decisions, 25
-- October 2026). The front desk at the bill's centre, Finance or the Super Admin marks a bill paid
-- by UPI QR, card or cash, with an optional reference: the database records the bill's whole total
-- (nobody types an amount; partial payments wait for the client, decision 10) as the person
-- signed in, and marks the bill paid. Paying for the chosen plan moves the episode from Plan
-- proposed to Active: the package's bill when a package is the newest choice, or the consultation
-- fee when pay per session is. A payment recorded by mistake is undone on its IST day with a
-- reason by the same people; the bill goes back to Unpaid and the episode stays as it is. Staff
-- write no payment rows directly.
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.payment
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint

CREATE POLICY payment_read ON public.payment FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.bill b WHERE b.id = payment.bill_id));--> statement-breakpoint

-- Velyx support stays read only here too (IAM-08).
CREATE POLICY support_read_only_insert ON public.payment AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.payment AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.payment AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.payment FROM authenticated;--> statement-breakpoint

-- Whether the signed in person takes payments at this centre: those who see amounts there, never
-- a Velyx support login.
CREATE OR REPLACE FUNCTION internal.collects_at(centre_id uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT internal.jwt_staff_id() IS NOT NULL
    AND NOT coalesce(internal.jwt_support(), false)
    AND internal.prices_centre(collects_at.centre_id)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.collects_at(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.collects_at(uuid) TO authenticated;--> statement-breakpoint

-- Plan proposed to Active once the chosen plan is paid for: the newest choice is a package whose
-- bill is paid, or pay per session with the episode's consultation fee paid.
CREATE OR REPLACE FUNCTION internal.activate_if_paid(episode_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  newest record;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.episode e
    WHERE e.id = activate_if_paid.episode_id AND e.status = 'plan_proposed'
  ) THEN
    RETURN;
  END IF;
  SELECT c.id, c.choice INTO newest FROM public.plan_choice c
    WHERE c.episode_id = activate_if_paid.episode_id
    ORDER BY c.recorded_at DESC
    LIMIT 1;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF (newest.choice = 'package' AND EXISTS (
        SELECT 1 FROM public.bill b WHERE b.plan_choice_id = newest.id AND b.status = 'paid'))
    OR (newest.choice = 'per_session' AND EXISTS (
        SELECT 1 FROM public.bill b
        WHERE b.episode_id = activate_if_paid.episode_id AND b.kind = 'consultation'
          AND b.status = 'paid'))
  THEN
    UPDATE public.episode e SET status = 'active', updated_at = now()
      WHERE e.id = activate_if_paid.episode_id;
  END IF;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.activate_if_paid(uuid) FROM PUBLIC;--> statement-breakpoint

-- "Mark paid": the bill's whole total, as the person signed in; the payment's id.
CREATE OR REPLACE FUNCTION internal.record_payment(
  bill_id uuid,
  method public.payment_method,
  reference text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  billed record;
  made uuid;
BEGIN
  SELECT b.id, b.status, b.centre_id, b.episode_id, b.total_paise INTO billed
    FROM public.bill b WHERE b.id = record_payment.bill_id FOR UPDATE;
  IF NOT FOUND OR NOT internal.collects_at(billed.centre_id) THEN
    RAISE EXCEPTION 'Not a bill this person takes payment for'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF billed.status <> 'unpaid' THEN
    RAISE EXCEPTION 'Only an unpaid bill is paid' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO public.payment (bill_id, method, amount_paise, reference, recorded_by)
  VALUES (billed.id, record_payment.method, billed.total_paise,
    nullif(trim(record_payment.reference), ''), internal.jwt_staff_id())
  RETURNING id INTO made;
  UPDATE public.bill b SET status = 'paid' WHERE b.id = billed.id;
  IF billed.episode_id IS NOT NULL THEN
    PERFORM internal.activate_if_paid(billed.episode_id);
  END IF;
  RETURN made;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.record_payment(uuid, public.payment_method, text)
  FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.record_payment(uuid, public.payment_method, text)
  TO authenticated;--> statement-breakpoint

-- Undoing a payment recorded by mistake, on its IST day, with the reason; the bill is unpaid again.
CREATE OR REPLACE FUNCTION internal.undo_payment(payment_id uuid, reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  paid record;
BEGIN
  SELECT p.id, p.bill_id, p.recorded_at, p.undone_at, b.centre_id INTO paid
    FROM public.payment p JOIN public.bill b ON b.id = p.bill_id
    WHERE p.id = undo_payment.payment_id FOR UPDATE OF p;
  IF NOT FOUND OR NOT internal.collects_at(paid.centre_id) THEN
    RAISE EXCEPTION 'Not a payment this person undoes' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF paid.undone_at IS NOT NULL THEN
    RAISE EXCEPTION 'The payment is already undone' USING ERRCODE = 'check_violation';
  END IF;
  IF (paid.recorded_at AT TIME ZONE 'Asia/Kolkata')::date
    <> (now() AT TIME ZONE 'Asia/Kolkata')::date THEN
    RAISE EXCEPTION 'A payment is undone only on the day it was recorded'
      USING ERRCODE = 'check_violation';
  END IF;
  IF length(trim(coalesce(undo_payment.reason, ''))) NOT BETWEEN 1 AND 300 THEN
    RAISE EXCEPTION 'An undone payment needs its reason' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.payment p
    SET undone_at = now(), undone_by = internal.jwt_staff_id(), undo_reason = trim(undo_payment.reason)
    WHERE p.id = paid.id;
  UPDATE public.bill b SET status = 'unpaid' WHERE b.id = paid.bill_id;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.undo_payment(uuid, text) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.undo_payment(uuid, text) TO authenticated;--> statement-breakpoint

-- BIL-05's package bill trigger, now also activating when the fee was paid before pay per session
-- was chosen.
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
  PERFORM internal.activate_if_paid(NEW.episode_id);
  RETURN NULL;
END;
$$;

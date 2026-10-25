-- BIL-09: invoices and receipts (Frontend Specification section 11, TAD section 9, PRD J4.7; user
-- decisions, 25 October 2026). Recording a payment now gives it the centre's next invoice number
-- (HSR-INV-00001: its own series, so invoices run without gaps whatever bills were cancelled) and
-- queues its invoice PDF and its WhatsApp receipt (sent once WhatsApp exists; never for a payment
-- since undone). Undoing a payment queues the invoice again, which then prints as cancelled; the
-- number is never given to another payment, and paying again gets a fresh one.

-- "Mark paid" (BIL-06), now numbering the invoice and queueing it with the receipt.
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
  SELECT b.id, b.status, b.centre_id, b.episode_id, b.total_paise, c.code AS centre_code
    INTO billed
    FROM public.bill b JOIN public.centre c ON c.id = b.centre_id
    WHERE b.id = record_payment.bill_id FOR UPDATE OF b;
  IF NOT FOUND OR NOT internal.collects_at(billed.centre_id) THEN
    RAISE EXCEPTION 'Not a bill this person takes payment for'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF billed.status <> 'unpaid' THEN
    RAISE EXCEPTION 'Only an unpaid bill is paid' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO public.payment (bill_id, method, amount_paise, reference, recorded_by, invoice_number)
  VALUES (billed.id, record_payment.method, billed.total_paise,
    nullif(trim(record_payment.reference), ''), internal.jwt_staff_id(),
    billed.centre_code || '-INV-'
      || lpad(internal.next_centre_number(billed.centre_id, 'invoice')::text, 5, '0'))
  RETURNING id INTO made;
  UPDATE public.bill b SET status = 'paid' WHERE b.id = billed.id;
  INSERT INTO public.job (kind, payload, idempotency_key) VALUES
    ('documents.invoice', jsonb_build_object('paymentId', made), 'invoice:' || made),
    ('whatsapp.receipt', jsonb_build_object('paymentId', made), 'receipt:' || made)
  ON CONFLICT (idempotency_key) DO NOTHING;
  IF billed.episode_id IS NOT NULL THEN
    PERFORM internal.activate_if_paid(billed.episode_id);
  END IF;
  RETURN made;
END;
$$;--> statement-breakpoint

-- Undoing a payment (BIL-06), now also queueing its invoice's cancelled version.
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
  INSERT INTO public.job (kind, payload, idempotency_key)
  VALUES ('documents.invoice', jsonb_build_object('paymentId', paid.id), 'invoice:undo:' || paid.id)
  ON CONFLICT (idempotency_key) DO NOTHING;
END;
$$;

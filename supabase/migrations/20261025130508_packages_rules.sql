-- BIL-08: packages (PRD J4.7 and section 7, TAD section 4; user decisions, 25 October 2026).
-- Paying a package's bill makes the patient's package: the type's sessions, valid until
-- packages.validity_months after the IST payment date (the month's last day when it has no such
-- day, as packageValidUntil), and floor(sessions / 10) x packages.reschedules_per_10_sessions
-- reschedules; it queues the WhatsApp expiry reminder packages.expiry_reminder_days before, at
-- packages.expiry_reminder_time IST. Undoing the payment cancels the package while no session
-- has been used; after that it is Finance's refund (BIL-11). Closing a treatment session uses one
-- (internal.use_package_session, called by SES-07) only while it is active: not cancelled, not
-- used up, and not past its valid until day. Expired packages keep their sessions left on record
-- (DECISION 12). The package holds no amounts, so physios read it for the sessions left.
SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint
INSERT INTO public.setting (key, value, updated_by) VALUES
  ('packages.expiry_reminder_time', '"10:00"', 'system:migration')
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint
SELECT set_config('audit.actor', '', false);--> statement-breakpoint

CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.package
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint

-- Those who see amounts at its centre (the Super Admin, Finance, the front desk there), and
-- physios at centres they work in; never Centre Managers (packages.view_sessions_left).
CREATE POLICY package_read ON public.package FOR SELECT TO authenticated
  USING (
    internal.prices_centre(package.centre_id)
    OR (internal.jwt_staff_role() = 'physiotherapist' AND internal.jwt_sees_centre(package.centre_id))
  );--> statement-breakpoint

-- Velyx support stays read only here too (IAM-08).
CREATE POLICY support_read_only_insert ON public.package AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.package AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.package AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint

-- The database writes packages; nobody signed in does.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.package FROM authenticated;--> statement-breakpoint

-- The package a paid package bill buys, with its expiry reminder; once per payment.
CREATE OR REPLACE FUNCTION internal.activate_package(payment_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  bought record;
  months int;
  per_ten int;
  reminder_days int;
  reminder_time time;
  valid_until date;
  made uuid;
BEGIN
  SELECT p.id, p.bill_id, p.recorded_at, b.patient_id, b.episode_id, b.centre_id,
      t.id AS package_type_id, t.name, t.sessions
    INTO bought
    FROM public.payment p
    JOIN public.bill b ON b.id = p.bill_id AND b.kind = 'package'
    JOIN public.bill_line l ON l.bill_id = b.id AND l.package_type_id IS NOT NULL
    JOIN public.package_type t ON t.id = l.package_type_id
    WHERE p.id = activate_package.payment_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  months := coalesce((SELECT (s.value #>> '{}')::int FROM public.setting s
    WHERE s.key = 'packages.validity_months'), 3);
  per_ten := coalesce((SELECT (s.value #>> '{}')::int FROM public.setting s
    WHERE s.key = 'packages.reschedules_per_10_sessions'), 1);
  reminder_days := coalesce((SELECT (s.value #>> '{}')::int FROM public.setting s
    WHERE s.key = 'packages.expiry_reminder_days'), 14);
  reminder_time := coalesce((SELECT (s.value #>> '{}')::time FROM public.setting s
    WHERE s.key = 'packages.expiry_reminder_time'), '10:00');
  -- Adding months keeps the day, or the month's last day when it has no such day.
  valid_until := ((bought.recorded_at AT TIME ZONE 'Asia/Kolkata')::date
    + make_interval(months => months))::date;
  INSERT INTO public.package (patient_id, episode_id, centre_id, package_type_id, bill_id,
    payment_id, name, sessions_total, reschedules_left, paid_at, valid_until)
  VALUES (bought.patient_id, bought.episode_id, bought.centre_id, bought.package_type_id,
    bought.bill_id, bought.id, bought.name, bought.sessions, (bought.sessions / 10) * per_ten,
    bought.recorded_at, valid_until)
  ON CONFLICT ON CONSTRAINT package_payment_id_unique DO NOTHING
  RETURNING id INTO made;
  IF made IS NOT NULL THEN
    INSERT INTO public.job (kind, payload, run_at, idempotency_key)
    VALUES ('whatsapp.package_expiry_reminder', jsonb_build_object('packageId', made),
      greatest(now(), ((valid_until - reminder_days) + reminder_time) AT TIME ZONE 'Asia/Kolkata'),
      'package_expiry:' || made)
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;
  RETURN made;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.activate_package(uuid) FROM PUBLIC;--> statement-breakpoint

-- "Mark paid" (BIL-06, BIL-09), now activating the package a package bill buys.
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
  SELECT b.id, b.kind, b.status, b.centre_id, b.episode_id, b.total_paise, c.code AS centre_code
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
  IF billed.kind = 'package' THEN
    PERFORM internal.activate_package(made);
  END IF;
  IF billed.episode_id IS NOT NULL THEN
    PERFORM internal.activate_if_paid(billed.episode_id);
  END IF;
  RETURN made;
END;
$$;--> statement-breakpoint

-- Undoing a payment (BIL-06, BIL-09), now cancelling its package, and refused once a session
-- from it has been used (Finance refunds it then).
CREATE OR REPLACE FUNCTION internal.undo_payment(payment_id uuid, reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  paid record;
  bought record;
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
  SELECT k.id, k.sessions_used INTO bought
    FROM public.package k
    WHERE k.payment_id = paid.id AND k.cancelled_at IS NULL FOR UPDATE;
  IF FOUND THEN
    IF bought.sessions_used > 0 THEN
      RAISE EXCEPTION 'Sessions from this package have been used; Finance refunds it'
        USING ERRCODE = 'check_violation';
    END IF;
    UPDATE public.package k
      SET cancelled_at = now(), cancel_reason = 'The payment was undone.'
      WHERE k.id = bought.id;
  END IF;
  UPDATE public.payment p
    SET undone_at = now(), undone_by = internal.jwt_staff_id(), undo_reason = trim(undo_payment.reason)
    WHERE p.id = paid.id;
  UPDATE public.bill b SET status = 'unpaid' WHERE b.id = paid.bill_id;
  INSERT INTO public.job (kind, payload, idempotency_key)
  VALUES ('documents.invoice', jsonb_build_object('paymentId', paid.id), 'invoice:undo:' || paid.id)
  ON CONFLICT (idempotency_key) DO NOTHING;
END;
$$;--> statement-breakpoint

-- Uses one session of an active package and returns the sessions left; SES-07's closing of a
-- treatment session calls it. Not for staff to call directly.
CREATE OR REPLACE FUNCTION internal.use_package_session(package_id uuid) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  held record;
BEGIN
  SELECT k.id, k.sessions_total, k.sessions_used, k.valid_until, k.cancelled_at INTO held
    FROM public.package k WHERE k.id = use_package_session.package_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such package' USING ERRCODE = 'no_data_found';
  END IF;
  IF held.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'The package is cancelled' USING ERRCODE = 'check_violation';
  END IF;
  IF held.sessions_used >= held.sessions_total THEN
    RAISE EXCEPTION 'Every session of the package is used' USING ERRCODE = 'check_violation';
  END IF;
  IF (now() AT TIME ZONE 'Asia/Kolkata')::date > held.valid_until THEN
    RAISE EXCEPTION 'The package has expired' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.package k SET sessions_used = k.sessions_used + 1 WHERE k.id = held.id;
  RETURN held.sessions_total - held.sessions_used - 1;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.use_package_session(uuid) FROM PUBLIC;

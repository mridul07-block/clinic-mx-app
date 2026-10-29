-- BIL-10: pay as you go balances (PRD M8, section 7 "Unpaid balance flag: above 3 unpaid sessions",
-- Frontend Specification section 8 Finance Unpaid; decision 10). Payments stay whole (user
-- decision, 25 October 2026), so a patient's balance is their unpaid bills. Pay per session had no
-- bill for its sessions until now: signing a session in an episode whose newest plan choice is pay
-- per session, with no package used for it, makes one session bill at the chosen session price (the
-- price master's amount when signed; nobody types it), once per visit. Recommended defaults chosen
-- under the user's standing approval, 29 October 2026 (DECISION BIL-10; docs/runbooks/bills.md):
--  * DECISION 10: more than `billing.unpaid_sessions_flag_above` unpaid sessions flags the patient;
--    nothing blocks booking or check in until the client decides.
--  * DECISION 8/16: no per use modality lines; a session bill is the session price alone.
--  * DECISION BIL-10: a package episode whose package is used up, expired or unpaid bills nothing
--    for its sessions. A treadmill visit (in `packages.session_appointment_types`) is billed at the
--    chosen session price, as it uses a package session. A session bill is never cancelled by a
--    later choice: sessions taken are owed; a bill made in error waits for a cancel action.
--  * The chosen price item is billed even once retired (unlike a consultant's fee): the patient
--    chose it, and a retired item must not make sessions free.

-- The session bill for a signed session, when its episode is paid per session and no package
-- was used: the bill's id, or null.
CREATE OR REPLACE FUNCTION internal.make_session_bill(session_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  visit record;
  price record;
  made uuid;
BEGIN
  SELECT s.id, s.appointment_id, s.episode_id, s.patient_id, s.centre_id, s.number, s.status,
      s.package_id, s.signed_by
    INTO visit
    FROM public.session s WHERE s.id = make_session_bill.session_id;
  IF NOT FOUND OR visit.status <> 'signed' OR visit.package_id IS NOT NULL THEN
    RETURN NULL;
  END IF;
  SELECT b.id INTO made FROM public.bill b
    WHERE b.appointment_id = visit.appointment_id AND b.kind = 'session'
      AND b.status <> 'cancelled';
  IF made IS NOT NULL THEN
    RETURN made;
  END IF;
  SELECT p.id, p.label, p.amount_paise INTO price
    FROM (
      SELECT c.choice, c.session_price_item_id FROM public.plan_choice c
      WHERE c.episode_id = visit.episode_id
      ORDER BY c.recorded_at DESC
      LIMIT 1
    ) newest
    JOIN public.price_item p ON p.id = newest.session_price_item_id
    WHERE newest.choice = 'per_session';
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.bill (number, kind, patient_id, episode_id, centre_id, appointment_id,
    total_paise, created_by)
  VALUES (internal.next_bill_number(visit.centre_id), 'session', visit.patient_id,
    visit.episode_id, visit.centre_id, visit.appointment_id, price.amount_paise, visit.signed_by)
  RETURNING id INTO made;
  INSERT INTO public.bill_line (bill_id, price_item_id, description, quantity, unit_paise,
    amount_paise)
  VALUES (made, price.id, price.label || ', session ' || visit.number, 1, price.amount_paise,
    price.amount_paise);
  RETURN made;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.make_session_bill(uuid) FROM PUBLIC;--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.session_bill() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  PERFORM internal.make_session_bill(NEW.id);
  RETURN NULL;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.session_bill() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER session_bill AFTER UPDATE ON public.session
  FOR EACH ROW WHEN (OLD.status = 'draft' AND NEW.status = 'signed')
  EXECUTE FUNCTION internal.session_bill();

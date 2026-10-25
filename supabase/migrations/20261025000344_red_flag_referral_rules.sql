-- CLN-11 and ALT-07 (user decisions, 25 October 2026). A consultant records a red flag found in
-- the consultation as an alert, in one of the framework's five categories, then takes it through
-- the ALT-01 moves at once: reviewed, and referred for every category but Monitor with caution. A
-- referral, from the consultation or from the Alerts page, now also records the reason and the
-- question for the specialist, and queues the referral letter and the WhatsApp safety advice (sent
-- once WhatsApp exists). Monitor with caution from the consultation queues the safety advice only.

-- Referring needs the letter's reason and question, by the signed in clinician; any other move
-- keeps them as they were. Otherwise the moves are ALT-01's.
CREATE OR REPLACE FUNCTION internal.red_flag_alert_lifecycle() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  actor uuid := internal.jwt_staff_id();
BEGIN
  IF OLD.status = 'closed' THEN
    RAISE EXCEPTION 'A closed alert does not change' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT (OLD.status::text, NEW.status::text) IN (
    ('raised', 'reviewed'), ('reviewed', 'referred'), ('reviewed', 'closed'), ('referred', 'closed')
  ) THEN
    RAISE EXCEPTION 'An alert cannot go from % to %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF actor IS NULL THEN
    RAISE EXCEPTION 'Only a signed in clinician changes an alert' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'reviewed' THEN
    IF NEW.reviewed_by IS DISTINCT FROM actor THEN
      RAISE EXCEPTION 'The reviewer is the signed in clinician' USING ERRCODE = 'check_violation';
    END IF;
    NEW.reviewed_at := now();
  ELSE
    NEW.reviewed_by := OLD.reviewed_by;
    NEW.reviewed_at := OLD.reviewed_at;
  END IF;
  IF NEW.status = 'referred' THEN
    IF NEW.referred_by IS DISTINCT FROM actor OR coalesce(btrim(NEW.referred_to), '') = '' THEN
      RAISE EXCEPTION 'A referral says where, by the signed in clinician' USING ERRCODE = 'check_violation';
    END IF;
    IF coalesce(btrim(NEW.referral_reason), '') = '' OR coalesce(btrim(NEW.referral_question), '') = '' THEN
      RAISE EXCEPTION 'A referral needs the reason and the question for the specialist'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.referred_at := now();
  ELSE
    NEW.referred_to := OLD.referred_to;
    NEW.referred_by := OLD.referred_by;
    NEW.referred_at := OLD.referred_at;
    NEW.referral_reason := OLD.referral_reason;
    NEW.referral_question := OLD.referral_question;
  END IF;
  IF NEW.status = 'closed' THEN
    IF NEW.closed_by IS DISTINCT FROM actor OR coalesce(btrim(NEW.decision), '') = '' THEN
      RAISE EXCEPTION 'Closing needs a written decision, by the signed in clinician' USING ERRCODE = 'check_violation';
    END IF;
    NEW.closed_at := now();
  ELSE
    NEW.decision := OLD.decision;
    NEW.closed_by := OLD.closed_by;
    NEW.closed_at := OLD.closed_at;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

GRANT UPDATE (referral_reason, referral_question) ON public.red_flag_alert TO authenticated;--> statement-breakpoint

-- A consultant raises a red flag from their own draft consultation, at a centre they see: a rule
-- key of its own (`consultation.<id>`), raised, nothing of the lifecycle set (a column grant cannot
-- say this: an insert names every column, set or not). The moves come after, through
-- red_flag_alert_act and the trigger.
CREATE POLICY red_flag_alert_consultation_insert ON public.red_flag_alert FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT internal.jwt_treats())
    AND rule_key LIKE 'consultation.%'
    AND status = 'raised'
    AND reviewed_by IS NULL AND reviewed_at IS NULL
    AND referred_to IS NULL AND referred_by IS NULL AND referred_at IS NULL
    AND referral_reason IS NULL AND referral_question IS NULL
    AND decision IS NULL AND closed_by IS NULL AND closed_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.consultation c
      JOIN public.episode e ON e.id = c.episode_id
      WHERE c.appointment_id = red_flag_alert.appointment_id
        AND c.episode_id = red_flag_alert.episode_id
        AND c.physio_id = (SELECT internal.jwt_staff_id())
        AND c.status = 'draft'
        AND internal.jwt_sees_centre(e.centre_id)
    )
  );--> statement-breakpoint

-- What follows a referral, queued in the same transaction (staff cannot add jobs themselves): the
-- referral letter and the safety advice, each once per alert; and for Monitor with caution found
-- in the consultation, the safety advice when the consultant reviews it.
CREATE OR REPLACE FUNCTION internal.red_flag_follow_up() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'referred' AND OLD.status IS DISTINCT FROM 'referred' THEN
    INSERT INTO public.job (kind, payload, idempotency_key)
    VALUES ('documents.referral_letter', jsonb_build_object('alertId', NEW.id),
      'referral_letter:' || NEW.id)
    ON CONFLICT (idempotency_key) DO NOTHING;
    INSERT INTO public.job (kind, payload, idempotency_key)
    VALUES ('whatsapp.red_flag_safety_advice', jsonb_build_object('alertId', NEW.id),
      'whatsapp.red_flag_safety_advice:' || NEW.id)
    ON CONFLICT (idempotency_key) DO NOTHING;
  ELSIF NEW.status = 'reviewed' AND OLD.status = 'raised'
    AND NEW.triage = 'monitor_with_caution' AND NEW.rule_key LIKE 'consultation.%' THEN
    INSERT INTO public.job (kind, payload, idempotency_key)
    VALUES ('whatsapp.red_flag_safety_advice', jsonb_build_object('alertId', NEW.id),
      'whatsapp.red_flag_safety_advice:' || NEW.id)
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.red_flag_follow_up() FROM PUBLIC, anon, authenticated;--> statement-breakpoint
CREATE TRIGGER red_flag_follow_up AFTER UPDATE OF status ON public.red_flag_alert
  FOR EACH ROW EXECUTE FUNCTION internal.red_flag_follow_up();

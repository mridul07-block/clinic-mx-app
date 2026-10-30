-- WA-07: the booking confirmation (PRD J1.4, J1.5). Every appointment booked, on WhatsApp, at the
-- desk, as a walk in, as a move or automatically, queues one WhatsApp confirmation for itself; an
-- appointment of a plan series does not, as its series sends the plan sessions list (SCH-11). The
-- job's sender decides what is still due and which template goes. An appointment's plan series is
-- set only when it is inserted (`appointment_fixed`), so no UPDATE trigger is needed.
CREATE OR REPLACE FUNCTION internal.booking_confirmation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.job (kind, payload, idempotency_key)
  VALUES ('whatsapp.booking_confirmation', jsonb_build_object('appointmentId', NEW.id),
    'whatsapp.booking_confirmation:' || NEW.id)
  ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN NULL;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.booking_confirmation() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER booking_confirmation AFTER INSERT ON public.appointment
  FOR EACH ROW WHEN (NEW.plan_booking_id IS NULL)
  EXECUTE FUNCTION internal.booking_confirmation();

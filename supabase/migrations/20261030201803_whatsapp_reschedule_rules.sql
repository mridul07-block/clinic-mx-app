-- WA-05: a patient's own move on the WhatsApp reschedule Flow is recorded with
-- change_channel = 'whatsapp' and no staff member. Only the server (no claims) records that; a
-- signed in staff member's change always names them (SCH-08), so none sets or alters the channel.
CREATE OR REPLACE FUNCTION internal.appointment_change_channel_server() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF (current_user IN ('authenticated', 'anon', 'service_role')
      OR coalesce(current_setting('request.jwt.claims', true), '') <> '')
    AND NEW.change_channel IS DISTINCT FROM
      (CASE WHEN TG_OP = 'UPDATE' THEN OLD.change_channel ELSE NULL END) THEN
    RAISE EXCEPTION 'Only the WhatsApp Flow records a change made on WhatsApp'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.appointment_change_channel_server() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER appointment_change_channel_server BEFORE INSERT OR UPDATE ON public.appointment
  FOR EACH ROW EXECUTE FUNCTION internal.appointment_change_channel_server();

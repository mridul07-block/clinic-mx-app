-- WA-01: WhatsApp messages (TAD sections 4 and 6). A message is a row first, Queued; inserting it
-- queues the `whatsapp.send` job in the same transaction, and the job sends it through the Cloud
-- API (retried by the queue) and records Sent, Failed or Not sent as `system:whatsapp`. The Super
-- Admin reads the messages and queues a test send (user decision, 30 October 2026); nobody signed
-- in changes or deletes one. While `whatsapp.test_recipients_only` is on, only the numbers on
-- `whatsapp.test_recipients` receive anything (staging, on the Meta test number).

CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.message
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint

-- Every queued outbound message gets its send job, once.
CREATE OR REPLACE FUNCTION internal.message_queue_send() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.job (kind, payload, idempotency_key)
  VALUES ('whatsapp.send', jsonb_build_object('messageId', NEW.id), 'whatsapp.send:' || NEW.id)
  ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.message_queue_send() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER message_queue_send AFTER INSERT ON public.message
  FOR EACH ROW WHEN (NEW.status = 'queued' AND NEW.direction = 'outbound')
  EXECUTE FUNCTION internal.message_queue_send();--> statement-breakpoint

CREATE POLICY message_read ON public.message FOR SELECT TO authenticated
  USING (
    (SELECT internal.jwt_staff_role()) = 'super_admin' AND NOT (SELECT internal.jwt_support())
  );--> statement-breakpoint
CREATE POLICY message_test_send ON public.message FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT internal.jwt_staff_role()) = 'super_admin'
    AND NOT (SELECT internal.jwt_support())
    AND message.kind = 'test'
    AND message.patient_id IS NULL
    AND message.status = 'queued'
    AND message.direction = 'outbound'
    AND message.wa_message_id IS NULL
    AND message.attempts = 0
    AND message.created_by = 'staff:' || (SELECT internal.jwt_staff_id())::text
  );--> statement-breakpoint
CREATE POLICY support_read_only_insert ON public.message AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.message AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.message AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON public.message FROM authenticated;--> statement-breakpoint

SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint
INSERT INTO public.setting (key, value, updated_by) VALUES
  ('whatsapp.test_recipients_only', 'true', 'system:migration'),
  -- No phone number in the repository: the Super Admin adds the verified ones on Settings.
  ('whatsapp.test_recipients', '[]', 'system:migration')
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint
SELECT set_config('audit.actor', '', false);

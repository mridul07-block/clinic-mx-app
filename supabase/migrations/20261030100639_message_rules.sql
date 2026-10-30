-- WA-01: WhatsApp messages (TAD sections 4 and 6). A message is a row first, Queued; inserting it
-- queues the `whatsapp.send` job in the same transaction, and the job sends it through the Cloud
-- API (retried by the queue) and records Sent, Failed or Not sent as `system:whatsapp`. The Super
-- Admin reads the messages and queues a test send (user decision, 30 October 2026); nobody signed
-- in changes or deletes one. While `whatsapp.test_recipients_only` is on, only the numbers on
-- `whatsapp.test_recipients` receive anything (staging, on the Meta test number).

-- A message is about a patient (their number, its details): the clinical part of the audit log,
-- as packages/schemas/src/audit-log.ts places it (ADM-01).
CREATE OR REPLACE FUNCTION internal.audit_category(entity text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT CASE
    WHEN entity IN ('consultation', 'session', 'measure', 'baseline_measure', 'special_test_result',
      'reassessment', 'final_test', 'clearance', 'phase_mark', 'phase_move', 'readiness_mark',
      'readiness_recording', 'diagnosis', 'plan_of_care', 'plan_modality', 'addendum',
      'confirmed_diagnosis', 'precaution', 'intake_response', 'document', 'patient_report',
      'exercise_tick', 'questionnaire_result', 'ai_run', 'ai_preparation_sheet', 'ai_suggestion')
      THEN 'clinical_record'
    WHEN entity IN ('patient', 'guardian', 'episode', 'appointment', 'plan_booking',
      'booking_counter', 'consent_record', 'red_flag_alert', 'task', 'patient_link', 'feedback',
      'follow_up_schedule', 'message')
      THEN 'clinical'
    WHEN entity IN ('bill', 'bill_line', 'payment', 'refund_credit', 'package', 'opening_entry',
      'price_item', 'package_type', 'package_type_item', 'discount_preset', 'plan_choice')
      THEN 'finance'
    ELSE 'admin'
  END
$$;--> statement-breakpoint

-- The WhatsApp messages sent to a patient are part of their data: in their copy, nothing hidden
-- (ADM-03, docs/runbooks/data-requests.md).
CREATE OR REPLACE FUNCTION internal.patient_export_tables() RETURNS TABLE (name text, hidden text[])
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  VALUES
    ('addendum', ARRAY[]::text[]),
    ('ai_preparation_sheet', ARRAY['similar']),
    ('ai_run', ARRAY['input', 'input_hash', 'cost_micro_usd', 'tokens_in', 'tokens_out']),
    ('ai_suggestion', ARRAY[]::text[]),
    ('appointment', ARRAY[]::text[]),
    ('baseline_measure', ARRAY[]::text[]),
    ('bill', ARRAY[]::text[]),
    ('bill_line', ARRAY[]::text[]),
    ('booking_counter', ARRAY[]::text[]),
    ('clearance', ARRAY[]::text[]),
    ('confirmed_diagnosis', ARRAY[]::text[]),
    ('consent_record', ARRAY[]::text[]),
    ('consultation', ARRAY[]::text[]),
    ('data_request', ARRAY[]::text[]),
    ('diagnosis', ARRAY[]::text[]),
    ('document', ARRAY[]::text[]),
    ('episode', ARRAY[]::text[]),
    ('exercise_tick', ARRAY[]::text[]),
    ('feedback', ARRAY[]::text[]),
    ('final_test', ARRAY[]::text[]),
    ('follow_up_schedule', ARRAY[]::text[]),
    ('guardian', ARRAY[]::text[]),
    ('intake_response', ARRAY[]::text[]),
    ('measure', ARRAY[]::text[]),
    ('message', ARRAY[]::text[]),
    ('opening_entry', ARRAY[]::text[]),
    ('package', ARRAY[]::text[]),
    ('patient_link', ARRAY[]::text[]),
    ('patient_report', ARRAY[]::text[]),
    ('payment', ARRAY[]::text[]),
    ('phase_mark', ARRAY[]::text[]),
    ('phase_move', ARRAY[]::text[]),
    ('plan_booking', ARRAY[]::text[]),
    ('plan_choice', ARRAY[]::text[]),
    ('plan_modality', ARRAY[]::text[]),
    ('plan_of_care', ARRAY[]::text[]),
    ('precaution', ARRAY[]::text[]),
    ('questionnaire_result', ARRAY[]::text[]),
    ('readiness_mark', ARRAY[]::text[]),
    ('readiness_recording', ARRAY[]::text[]),
    ('reassessment', ARRAY[]::text[]),
    ('red_flag_alert', ARRAY[]::text[]),
    ('refund_credit', ARRAY[]::text[]),
    ('session', ARRAY[]::text[]),
    ('special_test_result', ARRAY[]::text[])
$$;--> statement-breakpoint

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

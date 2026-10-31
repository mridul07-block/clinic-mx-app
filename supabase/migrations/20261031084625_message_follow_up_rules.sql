-- WA-13: "Not delivered" on the front desk's Today (user decisions, 31 October 2026). A message Meta
-- could not deliver (Failed) to a known patient is listed for the centre it concerns, its
-- appointment's or else the patient's own, for `whatsapp.undelivered_days`, until someone marks it
-- Done. Only the Super Admin reads messages, so the list and Done are functions that check the
-- person may run Today at that centre (`check_in.manage`: Super Admin, Centre Manager, Front Desk),
-- never for a Velyx support login, as `message_read`.
SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint
INSERT INTO public.setting (key, value, updated_by) VALUES
  ('whatsapp.undelivered_days', '7', 'system:migration')
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint
SELECT set_config('audit.actor', '', false);--> statement-breakpoint

-- Done is kept as written: written only by the function below, never changed.
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.message_follow_up
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint
REVOKE ALL ON public.message_follow_up FROM anon, authenticated;--> statement-breakpoint

-- The audit log's parts (ADM-01): a follow up belongs with the message, in the patient's care.
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
      'follow_up_schedule', 'message', 'message_follow_up')
      THEN 'clinical'
    WHEN entity IN ('bill', 'bill_line', 'payment', 'refund_credit', 'package', 'opening_entry',
      'price_item', 'package_type', 'package_type_item', 'discount_preset', 'plan_choice')
      THEN 'finance'
    ELSE 'admin'
  END
$$;--> statement-breakpoint

-- Whether the signed in person may follow up the front desk's messages at a centre.
CREATE OR REPLACE FUNCTION internal.jwt_follows_up_messages(centre_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT coalesce(
    internal.jwt_staff_role() IN ('super_admin', 'centre_manager', 'front_desk')
      AND NOT internal.jwt_support()
      AND internal.jwt_sees_centre(centre_id),
    false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.jwt_follows_up_messages(uuid) FROM PUBLIC, anon, authenticated;--> statement-breakpoint

-- The centre's failed messages not followed up, newest first.
CREATE OR REPLACE FUNCTION internal.undelivered_messages(centre uuid)
RETURNS TABLE (
  id uuid, patient_id uuid, template_key text, kind public.message_kind,
  status_at timestamptz, error_code text, error_title text, appointment_id uuid
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT m.id, m.patient_id, m.template_key, m.kind, m.status_at, m.error_code, m.error_title,
    m.appointment_id
  FROM public.message m
  JOIN public.patient p ON p.id = m.patient_id
  LEFT JOIN public.appointment a ON a.id = m.appointment_id
  WHERE internal.jwt_follows_up_messages(centre)
    AND m.status = 'failed'
    AND m.direction = 'outbound'
    AND m.patient_id IS NOT NULL
    AND m.status_at >= now() - make_interval(days => coalesce(
      (SELECT (s.value #>> '{}')::int FROM public.setting s
        WHERE s.key = 'whatsapp.undelivered_days'), 7))
    AND coalesce(a.centre_id, p.registered_centre_id) = centre
    AND NOT EXISTS (SELECT 1 FROM public.message_follow_up f WHERE f.id = m.id)
  ORDER BY m.status_at DESC, m.id
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.undelivered_messages(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.undelivered_messages(uuid) TO authenticated;--> statement-breakpoint

-- Done on one of them: recorded as the signed in person, once; true when it was this call's.
CREATE OR REPLACE FUNCTION internal.follow_up_undelivered(message_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  recorded integer;
BEGIN
  INSERT INTO public.message_follow_up (id, followed_up_by)
  SELECT m.id, internal.jwt_staff_id()
  FROM public.message m
  JOIN public.patient p ON p.id = m.patient_id
  LEFT JOIN public.appointment a ON a.id = m.appointment_id
  WHERE m.id = message_id
    AND m.status = 'failed'
    AND m.direction = 'outbound'
    AND internal.jwt_staff_id() IS NOT NULL
    AND internal.jwt_follows_up_messages(coalesce(a.centre_id, p.registered_centre_id))
  ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS recorded = ROW_COUNT;
  RETURN recorded > 0;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.follow_up_undelivered(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.follow_up_undelivered(uuid) TO authenticated;

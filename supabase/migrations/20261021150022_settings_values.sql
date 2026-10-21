-- FND-14: the business rule values of PRD section 7 (rule 6). Keys and value shapes are defined
-- in packages/schemas/src/settings.ts; a CI test checks every key there has a valid row here.
-- From now on the Super Admin changes these values; a new setting adds its row in a new
-- migration the same way. Existing rows are never overwritten.

CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.setting
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint

-- Names the actor for the audit trail, for this session only; cleared below.
SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint

INSERT INTO public.setting (key, value, updated_by) VALUES
  -- DECISION #2: 45 minutes until the client confirms the consultation length.
  ('scheduling.consultation_minutes', '45', 'system:migration'),
  ('scheduling.session_minutes', '{"shortest": 45, "longest": 60}', 'system:migration'),
  ('booking.self_booking_block_reschedules', '2', 'system:migration'),
  ('booking.self_booking_block_no_shows', '2', 'system:migration'),
  ('packages.reschedules_per_10_sessions', '1', 'system:migration'),
  ('packages.never_reschedulable_items', '["zero_gravity_treadmill"]', 'system:migration'),
  ('day.running_late_minutes', '15', 'system:migration'),
  ('day.no_show_allowed_minutes', '25', 'system:migration'),
  ('billing.consultation_fee_timing', '"after_consultation"', 'system:migration'),
  ('packages.validity_months', '3', 'system:migration'),
  ('packages.expiry_reminder_days', '14', 'system:migration'),
  ('clinical.baseline_reuse_days', '7', 'system:migration'),
  ('clinical.reassessment_session', '4', 'system:migration'),
  ('clinical.review_weeks', '6', 'system:migration'),
  ('billing.unpaid_sessions_flag_above', '3', 'system:migration'),
  ('engagement.follow_ups_after_discharge',
    '[{"count": 2, "unit": "week"}, {"count": 6, "unit": "week"}, {"count": 3, "unit": "month"}, {"count": 12, "unit": "month"}]',
    'system:migration'),
  ('security.desktop_idle_logout_minutes', '15', 'system:migration'),
  ('security.phone_session_days', '30', 'system:migration'),
  ('reminders.day_before_time', '"18:00"', 'system:migration')
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint

SELECT set_config('audit.actor', '', false);

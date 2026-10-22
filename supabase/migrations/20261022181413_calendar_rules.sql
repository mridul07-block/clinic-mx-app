-- SCH-05: the calendar day view. A consultant's consultation fee is a price item on their staff
-- record (decision G4; PRD section 7: by the consulting physio's level), shown in their calendar
-- column. Live screens check for changes every few seconds until the realtime relay (FND-09).
SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint
-- User decision 22 October 2026: every 3 seconds; PRD section 7: Consultation and Senior
-- consultation are the consultation fees.
INSERT INTO public.setting (key, value, updated_by) VALUES
  ('live.refresh_seconds', '3', 'system:migration'),
  ('billing.consultation_price_items', '["consultation", "senior_consultation"]', 'system:migration')
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint
SELECT set_config('audit.actor', '', false);

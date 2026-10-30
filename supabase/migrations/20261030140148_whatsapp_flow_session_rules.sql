-- WA-04: WhatsApp Flow sessions (TAD section 6). Server only like whatsapp_event: RLS on with no
-- policy, no rights for signed in staff, no audit trigger (the patient and appointment a Flow
-- makes are audited). Deleted hourly once older than `whatsapp.event_retention_days`.

REVOKE ALL ON public.whatsapp_flow_session FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint

-- Sessions older than the setting go; without the setting, or with less than a day, nothing goes.
CREATE OR REPLACE FUNCTION internal.prune_whatsapp_flow_sessions() RETURNS integer
LANGUAGE sql
SET search_path = ''
AS $$
  WITH kept AS (
    SELECT (value #>> '{}')::integer AS days FROM public.setting
    WHERE key = 'whatsapp.event_retention_days' AND jsonb_typeof(value) = 'number'
  ), gone AS (
    DELETE FROM public.whatsapp_flow_session s USING kept
    WHERE kept.days >= 1 AND s.created_at < now() - make_interval(days => kept.days)
    RETURNING 1
  )
  SELECT count(*)::integer FROM gone
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.prune_whatsapp_flow_sessions() FROM PUBLIC;--> statement-breakpoint

-- Every hour. cron.schedule replaces a job with the same name, so this is safe to re-run.
SELECT cron.schedule('whatsapp-flow-session-prune', '27 * * * *', 'SELECT internal.prune_whatsapp_flow_sessions()');--> statement-breakpoint

SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint
-- User decision, 30 October 2026: patients book themselves up to 14 days ahead.
INSERT INTO public.setting (key, value, updated_by) VALUES
  ('booking.whatsapp_days_ahead', '14', 'system:migration')
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint
SELECT set_config('audit.actor', '', false);

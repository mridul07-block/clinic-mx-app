-- WA-02: the WhatsApp webhook (TAD section 6). The route checks Meta's signature and stores the
-- body in `whatsapp_event`; inserting one queues its `whatsapp.event` job, which records the
-- delivery statuses and inbound messages on `message` as `system:whatsapp` (audited there).
-- `whatsapp_event` is server only: RLS on with no policy, no rights for signed in staff, and no
-- audit trigger (a copy of the raw body in the audit log would outlive the deletion below).

REVOKE ALL ON public.whatsapp_event FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint

-- Every stored webhook body gets its job, once.
CREATE OR REPLACE FUNCTION internal.whatsapp_event_queue() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.job (kind, payload, idempotency_key)
  VALUES ('whatsapp.event', jsonb_build_object('eventId', NEW.id), 'whatsapp.event:' || NEW.id)
  ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.whatsapp_event_queue() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER whatsapp_event_queue AFTER INSERT ON public.whatsapp_event
  FOR EACH ROW EXECUTE FUNCTION internal.whatsapp_event_queue();--> statement-breakpoint

-- Bodies go once handled longer ago than the setting (user decision, 30 October 2026: 7 days).
-- One never handled goes the same time after it came: its job gave up within minutes and left the
-- Super Admin a task, so the raw copy (numbers, message text) is never kept for good. Without the
-- setting, or with less than a day, nothing goes. Returns how many rows went.
CREATE OR REPLACE FUNCTION internal.prune_whatsapp_events() RETURNS integer
LANGUAGE sql
SET search_path = ''
AS $$
  WITH kept AS (
    SELECT (value #>> '{}')::integer AS days FROM public.setting
    WHERE key = 'whatsapp.event_retention_days' AND jsonb_typeof(value) = 'number'
  ), gone AS (
    DELETE FROM public.whatsapp_event e USING kept
    WHERE kept.days >= 1
      AND coalesce(e.processed_at, e.received_at) < now() - make_interval(days => kept.days)
    RETURNING 1
  )
  SELECT count(*)::integer FROM gone
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.prune_whatsapp_events() FROM PUBLIC;--> statement-breakpoint

-- Every hour. cron.schedule replaces a job with the same name, so this is safe to re-run.
SELECT cron.schedule('whatsapp-event-prune', '23 * * * *', 'SELECT internal.prune_whatsapp_events()');--> statement-breakpoint

SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint
INSERT INTO public.setting (key, value, updated_by) VALUES
  ('whatsapp.event_retention_days', '7', 'system:migration')
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint
SELECT set_config('audit.actor', '', false);

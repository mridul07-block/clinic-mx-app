-- WA-03: the conversation router (TAD section 6; PRD J1.2, J1.9). Every message sent to the
-- clinic's number queues its `whatsapp.route` job in the same transaction; the job (and the webhook
-- straight after storing it) gives it a route and queues the reply, as `system:whatsapp`.

-- Every inbound message gets its route job, once.
CREATE OR REPLACE FUNCTION internal.message_queue_route() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.job (kind, payload, idempotency_key)
  VALUES ('whatsapp.route', jsonb_build_object('messageId', NEW.id), 'whatsapp.route:' || NEW.id)
  ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.message_queue_route() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER message_queue_route AFTER INSERT ON public.message
  FOR EACH ROW WHEN (NEW.direction = 'inbound')
  EXECUTE FUNCTION internal.message_queue_route();--> statement-breakpoint

SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint
-- DECISION WA-03: a draft for the clinical director to confirm (user decision, 30 October 2026);
-- the Super Admin edits it on Settings. No front desk email in the repository: set on Settings.
INSERT INTO public.setting (key, value, updated_by) VALUES
  ('whatsapp.emergency_phrases', '["emergency", "ambulance", "chest pain", "chest tightness", "heart attack", "cant breathe", "cannot breathe", "difficulty breathing", "short of breath", "fainted", "passed out", "unconscious", "collapsed", "severe bleeding", "heavy bleeding", "stroke", "face drooping", "slurred speech", "sudden weakness", "seizure", "numb groin", "numbness in groin", "saddle numbness", "cant control bladder", "lost bladder control", "cant control bowel", "lost bowel control", "cannot pass urine", "suicide", "kill myself", "end my life"]', 'system:migration'),
  ('whatsapp.front_desk_email', '""', 'system:migration')
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint
SELECT set_config('audit.actor', '', false);

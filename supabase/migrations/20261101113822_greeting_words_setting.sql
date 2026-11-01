-- WA-03 reply speed: a WhatsApp message that is only a greeting, or asks for the menu, gets the menu
-- at once without the assistant (user decision, 1 November 2026); its setting first, ahead of the
-- code that reads it (docs/runbooks/local-gate.md). Emergency phrases are still checked first.
-- DECISION WA-03: the clinic edits the words on Settings.
SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint
INSERT INTO public.setting (key, value, updated_by) VALUES
  ('whatsapp.greeting_words',
    '["hi", "hii", "hello", "hey", "menu", "start", "good morning", "good afternoon", "good evening"]',
    'system:migration')
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint
SELECT set_config('audit.actor', '', false);

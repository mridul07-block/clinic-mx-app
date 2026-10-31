-- WA-11: the WhatsApp assistant for typed messages (PRD M3 and section 6; TAD sections 6 and 7),
-- its settings first, ahead of the code that reads them (docs/runbooks/local-gate.md). The model
-- only chooses: one of the clinic's approved answers below, or the menu's book, reschedule or
-- talk to our team, or emergency; it never writes what a patient reads (user decision, 31 October
-- 2026). Haiku 5.5 through OpenRouter, the TAD's small tier, on from now (user decision); clearing
-- the model turns the assistant off and typed text gets the menu again.
SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint
INSERT INTO public.setting (key, value, updated_by) VALUES
  ('ai.task_assistant_reply',
    '{"model": "anthropic/claude-haiku-5.5", "providers": [], "promptVersion": "assistant_reply.v1", "reasoningEffort": "none", "timeoutMs": 8000, "maxTokens": 100}',
    'system:migration'),
  -- DECISION WA-11: the clinic's own FAQs are the client's to add. Until then only facts already
  -- approved: where the centres are ({{centres}}: each centre's address and directions, filled in
  -- when sent) and the booking confirmation's "arrive 10 minutes early and bring any reports".
  ('whatsapp.assistant_faqs',
    '[{"id": "directions", "question": "Where are your clinics and how do I get there?", "answer": "Our clinics:\n\n{{centres}}"}, {"id": "what_to_bring", "question": "What should I bring to my appointment, and when should I arrive?", "answer": "Please arrive 10 minutes early and bring any reports you have."}]',
    'system:migration')
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint
SELECT set_config('audit.actor', '', false);

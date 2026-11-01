-- WA-11: no AI on WhatsApp (user decision, 1 November 2026): the clinic's WhatsApp is for booking,
-- not a general chatbot, so a typed message gets the menu, as every button does. Clearing the
-- assistant's model sends nothing to any model (the AI gateway stops at "not configured") and the
-- assistant answers with the menu; emergency phrases are still caught first by their word list.
-- Setting a model on Settings turns it back on. Staging was switched the same way that day.
SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint
UPDATE public.setting
SET value = jsonb_set(value, '{model}', 'null'::jsonb), updated_by = 'system:migration', updated_at = now()
WHERE key = 'ai.task_assistant_reply' AND value->'model' <> 'null'::jsonb;--> statement-breakpoint
SELECT set_config('audit.actor', '', false);

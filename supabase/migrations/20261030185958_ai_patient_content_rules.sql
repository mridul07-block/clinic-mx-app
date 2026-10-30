-- AI-07: patient content written by AI, once. The task's prompt, reasoning, timeout and token
-- limit are a setting; the model and its hosts are named by the operator for each run. Its spend
-- has its own one-time budget, never the daily cap. Recommended defaults chosen under the user's
-- standing approval, 30 October 2026 (docs/runbooks/patient-content.md).
SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint
INSERT INTO public.setting (key, value, updated_by) VALUES
  ('ai.task_write_patient_content',
    '{"model": null, "providers": [], "promptVersion": "write_patient_content.v1", "reasoningEffort": "none", "timeoutMs": 60000, "maxTokens": 2500}',
    'system:migration'),
  -- DECISION AI-07: the one-time patient content budget is the client's; 3,500 rupees is a placeholder.
  ('ai.patient_content_budget_paise', '350000', 'system:migration'),
  -- A timed out call is billed without its cost coming back: stop after 3 failed calls in a row.
  ('ai.patient_content_stop_after_failures', '3', 'system:migration')
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint
SELECT set_config('audit.actor', '', false);

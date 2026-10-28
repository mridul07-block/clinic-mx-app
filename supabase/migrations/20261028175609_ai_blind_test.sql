ALTER TABLE "ai_run" ADD COLUMN "blind_test_run" uuid;--> statement-breakpoint
CREATE INDEX "ai_run_blind_test_idx" ON "ai_run" USING btree ("blind_test_run") WHERE "ai_run"."blind_test_run" is not null;--> statement-breakpoint
ALTER TABLE "ai_run" ADD CONSTRAINT "ai_run_blind_test" CHECK ("ai_run"."blind_test_run" is null or ("ai_run"."episode_id" is null and "ai_run"."kind" = 'rank_diagnoses'));--> statement-breakpoint
-- AI-06: the blind test. Its runs are tagged and counted against their own budget, not the daily
-- cap; no clinical call is ever routed to a blocked provider (PRD section 6: DeepSeek's own API is
-- never used for patient data). Recommended defaults chosen under the user's standing approval,
-- 28 October 2026 (docs/runbooks/ai-blind-test.md).
SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint
INSERT INTO public.setting (key, value, updated_by) VALUES
  ('ai.blocked_providers', '["deepseek"]', 'system:migration'),
  -- DECISION AI-06: the blind test's budget is the client's; 2,000 rupees is a placeholder.
  ('ai.blind_test_budget_paise', '200000', 'system:migration'),
  ('ai.blind_test_cases_min', '30', 'system:migration'),
  ('ai.blind_test_cases_max', '50', 'system:migration')
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint
SELECT set_config('audit.actor', '', false);

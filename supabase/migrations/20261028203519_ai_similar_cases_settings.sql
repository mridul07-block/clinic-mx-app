-- AI-05: similar confirmed cases (PRD section 6: "From month one, 3 to 5 similar confirmed past cases
-- (no identifiers) are shown to the model and the physio"; TAD section 7 step 4). Recommended
-- defaults chosen under the user's standing approval, 29 October 2026 (DECISION AI-05;
-- docs/runbooks/ai-similar-cases.md): at least 3, at most 5, none when fewer. The two clinical
-- tasks move to their v2 prompts, which are told about the cases, unless the Super Admin already
-- chose another; the blind test runs again on v2 before the AI gate is switched on (TAD section 7).
SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint
INSERT INTO public.setting (key, value, updated_by) VALUES
  ('ai.similar_cases_min', '3', 'system:migration'),
  ('ai.similar_cases_max', '5', 'system:migration')
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint
UPDATE public.setting
  SET value = jsonb_set(value, '{promptVersion}', '"rank_diagnoses.v2"'),
    updated_by = 'system:migration', updated_at = now()
  WHERE key = 'ai.task_rank_diagnoses' AND value ->> 'promptVersion' = 'rank_diagnoses.v1';--> statement-breakpoint
UPDATE public.setting
  SET value = jsonb_set(value, '{promptVersion}', '"recheck_with_findings.v2"'),
    updated_by = 'system:migration', updated_at = now()
  WHERE key = 'ai.task_recheck_with_findings'
    AND value ->> 'promptVersion' = 'recheck_with_findings.v1';--> statement-breakpoint
SELECT set_config('audit.actor', '', false);

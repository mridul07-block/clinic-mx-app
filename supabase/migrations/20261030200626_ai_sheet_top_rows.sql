-- AI-03 live (31 October 2026): the sheet's tasks ask for only the rows the sheet shows (prompts v3)
-- with reasoning off. Ranking every row of a 25 row shortlist ran out of tokens and took about 10
-- seconds; the top 5 took about 2 (docs/runbooks/ai-preparation-sheet.md). Only tasks with no model
-- yet are moved: a model adopted after a blind test keeps the settings it was tested with.
-- Recommended defaults chosen under the user's standing approval (DECISION AI-03).
SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint
UPDATE public.setting
SET value = value
    || jsonb_build_object(
      'promptVersion',
      CASE key
        WHEN 'ai.task_rank_diagnoses' THEN 'rank_diagnoses.v3'
        ELSE 'recheck_with_findings.v3'
      END,
      'reasoningEffort', 'none'),
  updated_by = 'system:migration'
WHERE key IN ('ai.task_rank_diagnoses', 'ai.task_recheck_with_findings')
  AND value ->> 'model' IS NULL;--> statement-breakpoint
SELECT set_config('audit.actor', '', false);

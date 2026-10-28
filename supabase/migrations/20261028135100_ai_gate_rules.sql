-- AI-09: the AI on and off gate (PRD decision 23; PRD section 3 phase 5: the AI preparation sheet
-- and recheck are "switched on only after the blind test passes"; TAD: "legal check before the AI
-- gate"). Recommended defaults chosen under the user's standing approval, 28 October 2026
-- (docs/runbooks/ai-gate.md). The sheet starts off. The Super Admin switches it on through the
-- settings row like any setting (row level security: Super Admin only; audited), and the
-- database refuses "on" unless the blind test pass and the legal clearance are both recorded,
-- with the knowledge base version they were for.
SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint
-- DECISION #23
INSERT INTO public.setting (key, value, updated_by) VALUES
  ('ai.preparation_sheet', '{"on": false}', 'system:migration')
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint
SELECT set_config('audit.actor', '', false);--> statement-breakpoint

ALTER TABLE public.setting ADD CONSTRAINT setting_ai_sheet_evidence CHECK (
  key <> 'ai.preparation_sheet'
  OR value = '{"on": false}'::jsonb
  OR coalesce(
    value ->> 'on' = 'true'
    AND btrim(value -> 'blindTest' ->> 'date') <> ''
    AND btrim(value -> 'blindTest' ->> 'reference') <> ''
    AND btrim(value -> 'legalCheck' ->> 'date') <> ''
    AND btrim(value -> 'legalCheck' ->> 'reference') <> ''
    AND (value ->> 'kbVersionId') IS NOT NULL,
    false
  )
);

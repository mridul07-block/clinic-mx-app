-- AI-02: the preparation sheet's candidate filter (PRD section 6 "How the preparation sheet
-- works" steps 1 and 2; TAD section 6 steps 2 and 3). The filter keeps about 15 to 25 knowledge
-- base rows of the patient's region for the model to rank, and always adds the matching high risk
-- rows to Must rule out. Recommended defaults chosen under the user's standing approval,
-- 28 October 2026 (docs/runbooks/ai-candidates.md).
SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint
INSERT INTO public.setting (key, value, updated_by) VALUES
  ('ai.candidates_min', '15', 'system:migration'),
  ('ai.candidates_max', '25', 'system:migration'),
  -- DECISION AI-02: which rows are "high risk" is the client's; the Red flag tier is a placeholder.
  ('ai.must_rule_out_tiers', '["red_flag"]', 'system:migration')
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint
SELECT set_config('audit.actor', '', false);

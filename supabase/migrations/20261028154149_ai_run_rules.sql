-- AI-01: the AI gateway's run log (TAD section 7: "Logs every run to `ai_run`"; TAD section 5:
-- "`ai_run` only with `consultant`"). Recommended defaults chosen under the user's standing
-- approval, 28 October 2026 (docs/runbooks/ai-gateway.md). The server writes each run as
-- `system:ai`; nobody signed in writes, and no run is ever changed or deleted. Consultants read
-- the runs of episodes at centres they see; runs outside an episode are read by nobody signed in.

CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.ai_run
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.ai_run_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'An AI run is never changed or deleted' USING ERRCODE = 'check_violation';
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.ai_run_append_only() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER ai_run_append_only BEFORE UPDATE OR DELETE ON public.ai_run
  FOR EACH ROW EXECUTE FUNCTION internal.ai_run_append_only();--> statement-breakpoint

CREATE POLICY ai_run_read ON public.ai_run FOR SELECT TO authenticated
  USING (
    (SELECT internal.jwt_consultant())
    AND episode_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.episode e
      WHERE e.id = ai_run.episode_id AND internal.jwt_sees_centre(e.centre_id)
    )
  );--> statement-breakpoint
CREATE POLICY support_read_only_insert ON public.ai_run AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.ai_run AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.ai_run AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.ai_run FROM authenticated;--> statement-breakpoint

SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint
INSERT INTO public.setting (key, value, updated_by) VALUES
  -- DECISION AI-01: the daily cap is the client's; 200 rupees is a placeholder.
  ('ai.daily_spend_cap_paise', '20000', 'system:migration'),
  ('ai.usd_rate_paise', '9650', 'system:migration'),
  -- DECISION AI-01: no model or provider until the blind test chooses them (AI-06).
  ('ai.task_rank_diagnoses', '{"model": null, "providers": [], "promptVersion": "rank_diagnoses.v1", "reasoningEffort": "low", "timeoutMs": 6000, "maxTokens": 800}', 'system:migration'),
  ('ai.task_recheck_with_findings', '{"model": null, "providers": [], "promptVersion": "recheck_with_findings.v1", "reasoningEffort": "low", "timeoutMs": 6000, "maxTokens": 800}', 'system:migration')
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint
SELECT set_config('audit.actor', '', false);

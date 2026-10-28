-- AI-08: the monthly knowledge base report (PRD section 6: "Monthly report to the Super Admin:
-- suggestions often dismissed, diagnoses the AI missed, diagnoses changed at review"; TAD: "1st of
-- each month"). Recommended defaults chosen under the user's standing approval, 29 October 2026
-- (DECISION AI-08; docs/runbooks/ai-kb-report.md). The server builds one report per month as
-- `system:ai`; nobody signed in writes one, and none is ever changed or deleted. The Super Admin
-- reads them (Velyx support does not). The thresholds of "often dismissed" are placeholders for the
-- client; the first run is queued for the current month, built on the 1st of the next at 01:00 IST.

CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.kb_report
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.kb_report_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'A knowledge base report is kept as built' USING ERRCODE = 'check_violation';
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.kb_report_append_only() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER kb_report_append_only BEFORE UPDATE OR DELETE ON public.kb_report
  FOR EACH ROW EXECUTE FUNCTION internal.kb_report_append_only();--> statement-breakpoint

CREATE POLICY kb_report_read ON public.kb_report FOR SELECT TO authenticated
  USING ((SELECT internal.jwt_staff_role()) = 'super_admin' AND NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_insert ON public.kb_report AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.kb_report AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.kb_report AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.kb_report FROM authenticated;--> statement-breakpoint

SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint
INSERT INTO public.setting (key, value, updated_by) VALUES
  -- DECISION AI-08: what "often dismissed" means is the client's; these are placeholders.
  ('ai.kb_report_dismissed_min_marked', '5', 'system:migration'),
  ('ai.kb_report_dismissed_share_percent', '50', 'system:migration')
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint
-- The first report: this IST month's, built on the 1st of the next at 01:00 IST. Each run queues
-- the next month's itself; queuing it again adds nothing.
INSERT INTO public.job (kind, payload, run_at, idempotency_key)
SELECT 'ai.kb_report', jsonb_build_object('month', to_char(this_month, 'YYYY-MM')),
  ((this_month + interval '1 month')::date + time '01:00') AT TIME ZONE 'Asia/Kolkata',
  'ai.kb_report:' || to_char(this_month, 'YYYY-MM')
FROM (SELECT date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata')::date AS this_month) m
ON CONFLICT (idempotency_key) DO NOTHING;--> statement-breakpoint
SELECT set_config('audit.actor', '', false);

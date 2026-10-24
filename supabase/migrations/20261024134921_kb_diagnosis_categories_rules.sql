-- CLN-06: the client's diagnosis categories, part of each knowledge base version. Read by those
-- who view the knowledge base (the Super Admin, Centre Managers and physiotherapists); nobody
-- signed in writes them (the import writes as the owner). Every change is audited.
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.kb_diagnosis_category
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint
CREATE POLICY kb_diagnosis_category_read ON public.kb_diagnosis_category FOR SELECT TO authenticated
  USING ((SELECT internal.jwt_views_knowledge()));--> statement-breakpoint
CREATE POLICY support_read_only_insert ON public.kb_diagnosis_category AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.kb_diagnosis_category AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.kb_diagnosis_category AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint

-- Names the actor for the audit trail, for this session only; cleared below.
SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint

-- Suggestion thresholds from the client's Consultation SOP v2 until the client confirms them.
INSERT INTO public.setting (key, value, updated_by) VALUES
  ('assessment.irritability_high_above', '5', 'system:migration'), -- DECISION CLN-06 (SOP §10.2)
  ('assessment.irritability_low_below', '3', 'system:migration'), -- DECISION CLN-06 (SOP §10.2)
  ('assessment.acute_weeks_below', '3', 'system:migration'), -- DECISION CLN-06 (SOP §10.1)
  ('assessment.chronic_weeks_above', '12', 'system:migration') -- DECISION CLN-06 (SOP §10.1)
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint
SELECT set_config('audit.actor', '', false);

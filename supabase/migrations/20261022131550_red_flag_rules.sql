-- SET-10: red flag rules and each region's red flag presentations, in knowledge base versions.
-- Read like the rest of the knowledge base (knowledge_base.view: the Super Admin, Centre Managers
-- and physiotherapists); written only by the import (owner, audited system:kb-import). The
-- weight loss and morning stiffness thresholds are settings (decisions #5 and #6).

CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.kb_red_flag_rule
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.kb_red_flag_presentation
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint

CREATE POLICY kb_red_flag_rule_read ON public.kb_red_flag_rule FOR SELECT TO authenticated
  USING ((SELECT internal.jwt_views_knowledge()));--> statement-breakpoint
CREATE POLICY kb_red_flag_presentation_read ON public.kb_red_flag_presentation FOR SELECT TO authenticated
  USING ((SELECT internal.jwt_views_knowledge()));--> statement-breakpoint

-- Velyx support stays read only here too (IAM-08).
CREATE POLICY support_read_only_insert ON public.kb_red_flag_rule AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.kb_red_flag_rule AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.kb_red_flag_rule AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_insert ON public.kb_red_flag_presentation AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.kb_red_flag_presentation AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.kb_red_flag_presentation AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint

-- Names the actor for the audit trail, for this session only; cleared below.
SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint

-- Placeholders from the client's Red Flag Screening Framework until the client confirms them.
INSERT INTO public.setting (key, value, updated_by) VALUES
  ('screening.weight_loss_kg', '5', 'system:migration'), -- DECISION #5 (framework §13)
  ('screening.weight_loss_months', '6', 'system:migration'), -- DECISION #5 (framework §13)
  ('screening.morning_stiffness_minutes', '60', 'system:migration') -- DECISION #6 (framework §12)
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint
SELECT set_config('audit.actor', '', false);

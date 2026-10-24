-- CLN-07: the plan catalog's modalities and questionnaires, part of each knowledge base version.
-- Read by those who view the knowledge base (the Super Admin, Centre Managers and
-- physiotherapists); nobody signed in writes them (the import writes as the owner). Every change
-- is audited.
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.kb_modality
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.kb_questionnaire
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint
CREATE POLICY kb_modality_read ON public.kb_modality FOR SELECT TO authenticated
  USING ((SELECT internal.jwt_views_knowledge()));--> statement-breakpoint
CREATE POLICY support_read_only_insert ON public.kb_modality AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.kb_modality AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.kb_modality AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY kb_questionnaire_read ON public.kb_questionnaire FOR SELECT TO authenticated
  USING ((SELECT internal.jwt_views_knowledge()));--> statement-breakpoint
CREATE POLICY support_read_only_insert ON public.kb_questionnaire AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.kb_questionnaire AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.kb_questionnaire AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));

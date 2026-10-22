-- SET-05: the knowledge base. Read by the people who use it clinically (knowledge_base.view:
-- the Super Admin, Centre Managers and physiotherapists); nobody signed in writes it. Versions are
-- imported by the owner (`pnpm kb:import --apply`, audited as system:kb-import); the Super Admin's
-- approval arrives with SET-06. Every change is audited.

CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.kb_version
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.kb_condition
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.kb_condition_listing
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint

-- Whether the signed in person may read the knowledge base (knowledge_base.view).
CREATE OR REPLACE FUNCTION internal.jwt_views_knowledge() RETURNS boolean
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT coalesce(
    internal.jwt_staff_role() IN ('super_admin', 'centre_manager', 'physiotherapist'),
    false
  )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.jwt_views_knowledge() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.jwt_views_knowledge() TO authenticated;--> statement-breakpoint

CREATE POLICY kb_version_read ON public.kb_version FOR SELECT TO authenticated
  USING ((SELECT internal.jwt_views_knowledge()));--> statement-breakpoint
CREATE POLICY kb_condition_read ON public.kb_condition FOR SELECT TO authenticated
  USING ((SELECT internal.jwt_views_knowledge()));--> statement-breakpoint
CREATE POLICY kb_condition_listing_read ON public.kb_condition_listing FOR SELECT TO authenticated
  USING ((SELECT internal.jwt_views_knowledge()));--> statement-breakpoint

-- Velyx support stays read only here too (IAM-08).
CREATE POLICY support_read_only_insert ON public.kb_version AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.kb_version AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.kb_version AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_insert ON public.kb_condition AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.kb_condition AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.kb_condition AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_insert ON public.kb_condition_listing AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.kb_condition_listing AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.kb_condition_listing AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));

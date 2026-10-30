-- WA-06: what Meta decided about each WhatsApp template version on this environment's number
-- (TAD section 6 template registry). The text is in code; the submit script records each version
-- it submits (`system:whatsapp-templates`) and Meta's template webhook moves it on
-- (`system:whatsapp`). Only an Approved version is sent. The Super Admin reads it on WhatsApp
-- templates; nobody signed in writes it (user decision, 30 October 2026).

CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.whatsapp_template
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint

-- A version is the template Meta knows by its id and name: those never change, only Meta's verdict,
-- its category and reason; every change is stamped.
CREATE FUNCTION internal.whatsapp_template_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.key IS DISTINCT FROM OLD.key OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.language IS DISTINCT FROM OLD.language OR NEW.meta_name IS DISTINCT FROM OLD.meta_name
    OR NEW.meta_id IS DISTINCT FROM OLD.meta_id OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
  ) THEN
    RAISE EXCEPTION 'A submitted template version keeps its key, version, language and Meta id'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.submitted_at := now();
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER whatsapp_template_guard BEFORE INSERT OR UPDATE ON public.whatsapp_template
  FOR EACH ROW EXECUTE FUNCTION internal.whatsapp_template_guard();--> statement-breakpoint

CREATE POLICY whatsapp_template_read ON public.whatsapp_template FOR SELECT TO authenticated
  USING (
    (SELECT internal.jwt_staff_role()) = 'super_admin' AND NOT (SELECT internal.jwt_support())
  );--> statement-breakpoint
CREATE POLICY support_read_only_insert ON public.whatsapp_template AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.whatsapp_template AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.whatsapp_template AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.whatsapp_template FROM authenticated, anon;

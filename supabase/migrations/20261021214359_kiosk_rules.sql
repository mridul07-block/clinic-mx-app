-- IAM-10: clinic tablets in kiosk mode. Staff with check in rights (Super Admin, Centre Manager,
-- Front Desk; PRD section 2 and user decision 22 October 2026) set tablets up, send forms to them
-- and stop them, in the centres they see. The tablet itself is never a database user: the
-- server finds it by its token's hash and acts for it in audited transactions.

-- Tablets are audited like every table: set up is an insert; send, reset and stop are updates.
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.kiosk_device
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint

-- Whether the signed in person has check in rights (check_in.manage in the permission map).
CREATE OR REPLACE FUNCTION internal.jwt_checks_in() RETURNS boolean
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT coalesce(internal.jwt_staff_role() IN ('super_admin', 'centre_manager', 'front_desk'), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.jwt_checks_in() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.jwt_checks_in() TO authenticated;--> statement-breakpoint

CREATE POLICY kiosk_device_read ON public.kiosk_device FOR SELECT TO authenticated
  USING ((SELECT internal.jwt_checks_in()) AND internal.jwt_sees_centre(centre_id));--> statement-breakpoint
CREATE POLICY kiosk_device_insert ON public.kiosk_device FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT internal.jwt_checks_in())
    AND internal.jwt_sees_centre(centre_id)
    AND created_by = (SELECT internal.jwt_staff_id())
  );--> statement-breakpoint
CREATE POLICY kiosk_device_update ON public.kiosk_device FOR UPDATE TO authenticated
  USING ((SELECT internal.jwt_checks_in()) AND internal.jwt_sees_centre(centre_id))
  WITH CHECK ((SELECT internal.jwt_checks_in()) AND internal.jwt_sees_centre(centre_id));--> statement-breakpoint

-- Velyx support stays read only here too (IAM-08).
CREATE POLICY support_read_only_insert ON public.kiosk_device AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.kiosk_device AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.kiosk_device AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint

-- Sending a form to a tablet needs to know whether the link still works, but staff have no
-- policy on patient_link (IAM-09). This says only the link's purpose and state, to someone with
-- check in rights; never who it is for.
CREATE OR REPLACE FUNCTION internal.patient_link_state(link_id uuid)
RETURNS TABLE (purpose text, state text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT l.purpose::text,
         CASE
           WHEN l.revoked_at IS NOT NULL THEN 'stopped'
           WHEN l.completed_at IS NOT NULL THEN 'used'
           WHEN l.expires_at <= now() THEN 'expired'
           ELSE 'active'
         END
  FROM public.patient_link l
  WHERE l.id = link_id AND internal.jwt_checks_in()
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.patient_link_state(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.patient_link_state(uuid) TO authenticated;--> statement-breakpoint

-- How long the tablet waits without a touch, and how long the thank you screen stays (rule 6;
-- Frontend Specification section 7 and user decision 22 October 2026).
SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint
INSERT INTO public.setting (key, value, updated_by) VALUES
  ('kiosk.idle_seconds', '120', 'system:migration'),
  ('kiosk.thank_you_seconds', '10', 'system:migration')
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint
SELECT set_config('audit.actor', '', false);

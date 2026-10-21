-- IAM-05: row level security policies for every table (rule 10, TAD section 5). Staff requests
-- run as `authenticated` with the person's claims (withStaffAccess in packages/db), so these
-- policies are the second check after the permission map (IAM-04). They read the claims through
-- the IAM-03 readers. `anon` has no policy anywhere, so the Supabase API key alone sees nothing.
-- No table has a delete policy except centre assignments: staff are deactivated, never deleted.
-- See docs/runbooks/row-level-security.md.

-- Whether a staff member is assigned to a centre the signed in person sees. SECURITY DEFINER so
-- the staff_user policy does not run the staff_user_centre policies again.
CREATE OR REPLACE FUNCTION internal.staff_in_seen_centre(staff_id uuid) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.staff_user_centre c
    WHERE c.staff_user_id = staff_in_seen_centre.staff_id
      AND internal.jwt_sees_centre(c.centre_id)
  )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.staff_in_seen_centre(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.staff_in_seen_centre(uuid) TO authenticated;--> statement-breakpoint

-- The signed in person's staff id, or null.
CREATE OR REPLACE FUNCTION internal.jwt_staff_id() RETURNS uuid
LANGUAGE sql STABLE SET search_path = ''
AS $$ SELECT (internal.jwt_clinic() ->> 'staff_id')::uuid $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.jwt_staff_id() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.jwt_staff_id() TO authenticated;--> statement-breakpoint

-- Centres: each person sees the centres they work in (Super Admin and Finance: all). Only the
-- Super Admin sets them up (centres.manage).
CREATE POLICY centre_read ON public.centre FOR SELECT TO authenticated
  USING (internal.jwt_sees_centre(id));--> statement-breakpoint
CREATE POLICY centre_insert ON public.centre FOR INSERT TO authenticated
  WITH CHECK ((SELECT internal.jwt_staff_role()) = 'super_admin');--> statement-breakpoint
CREATE POLICY centre_update ON public.centre FOR UPDATE TO authenticated
  USING ((SELECT internal.jwt_staff_role()) = 'super_admin')
  WITH CHECK ((SELECT internal.jwt_staff_role()) = 'super_admin');--> statement-breakpoint

-- Staff: themselves, colleagues assigned to a centre they see (names for calendars and rosters),
-- and everyone for the Super Admin. Only the Super Admin changes staff (staff.manage).
CREATE POLICY staff_user_read ON public.staff_user FOR SELECT TO authenticated
  USING (
    id = (SELECT internal.jwt_staff_id())
    OR (SELECT internal.jwt_staff_role()) = 'super_admin'
    OR internal.staff_in_seen_centre(id)
  );--> statement-breakpoint
CREATE POLICY staff_user_insert ON public.staff_user FOR INSERT TO authenticated
  WITH CHECK ((SELECT internal.jwt_staff_role()) = 'super_admin');--> statement-breakpoint
CREATE POLICY staff_user_update ON public.staff_user FOR UPDATE TO authenticated
  USING ((SELECT internal.jwt_staff_role()) = 'super_admin')
  WITH CHECK ((SELECT internal.jwt_staff_role()) = 'super_admin');--> statement-breakpoint

-- Centre assignments: their own, and those in centres they see. The Super Admin assigns.
CREATE POLICY staff_user_centre_read ON public.staff_user_centre FOR SELECT TO authenticated
  USING (
    staff_user_id = (SELECT internal.jwt_staff_id())
    OR internal.jwt_sees_centre(centre_id)
  );--> statement-breakpoint
CREATE POLICY staff_user_centre_insert ON public.staff_user_centre FOR INSERT TO authenticated
  WITH CHECK ((SELECT internal.jwt_staff_role()) = 'super_admin');--> statement-breakpoint
CREATE POLICY staff_user_centre_delete ON public.staff_user_centre FOR DELETE TO authenticated
  USING ((SELECT internal.jwt_staff_role()) = 'super_admin');--> statement-breakpoint

-- The audit trail: read by the Super Admin (audit.view_all). Only the SECURITY DEFINER audit
-- trigger writes it. The Centre Manager's clinical audit and Finance's audit follow once events
-- carry a category.
CREATE POLICY audit_event_read ON public.audit_event FOR SELECT TO authenticated
  USING ((SELECT internal.jwt_staff_role()) = 'super_admin');--> statement-breakpoint

-- Settings: the Super Admin reads and changes them (settings.manage). The app reads values for
-- business rules through the server's settings reader, not as the person.
CREATE POLICY setting_read ON public.setting FOR SELECT TO authenticated
  USING ((SELECT internal.jwt_staff_role()) = 'super_admin');--> statement-breakpoint
CREATE POLICY setting_update ON public.setting FOR UPDATE TO authenticated
  USING ((SELECT internal.jwt_staff_role()) = 'super_admin')
  WITH CHECK ((SELECT internal.jwt_staff_role()) = 'super_admin');--> statement-breakpoint

-- Tasks: those assigned to the person or to their role, and all for the Super Admin. The same
-- people close them with a decision. Jobs create tasks on the server.
CREATE POLICY task_read ON public.task FOR SELECT TO authenticated
  USING (
    assignee_staff_user_id = (SELECT internal.jwt_staff_id())
    OR assignee_role::text = (SELECT internal.jwt_staff_role())
    OR (SELECT internal.jwt_staff_role()) = 'super_admin'
  );--> statement-breakpoint
CREATE POLICY task_update ON public.task FOR UPDATE TO authenticated
  USING (
    assignee_staff_user_id = (SELECT internal.jwt_staff_id())
    OR assignee_role::text = (SELECT internal.jwt_staff_role())
    OR (SELECT internal.jwt_staff_role()) = 'super_admin'
  )
  WITH CHECK (
    assignee_staff_user_id = (SELECT internal.jwt_staff_id())
    OR assignee_role::text = (SELECT internal.jwt_staff_role())
    OR (SELECT internal.jwt_staff_role()) = 'super_admin'
  );

-- job: no policy. The queue is server work only (see the catalog test's server only list).

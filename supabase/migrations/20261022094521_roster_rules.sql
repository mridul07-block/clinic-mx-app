-- SET-04: rosters and leave. Centre Managers and the Super Admin set rosters in the centres they
-- see (rosters.manage) and decide leave for the people they see; anyone who treats patients
-- requests their own leave (leave.manage own). Nobody decides their own leave. Rosters are read by
-- everyone who sees the centre (booking needs them); leave by the person and their managers.
-- Every change is audited; nothing is deleted.

-- G2: overlaps are refused by exclusion constraints; btree_gist lets them compare ids with =.
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;--> statement-breakpoint

-- Requested and approved leave never overlap for one person.
ALTER TABLE public.staff_leave ADD CONSTRAINT staff_leave_no_overlap
  EXCLUDE USING gist (staff_user_id WITH =, tstzrange(starts_at, ends_at) WITH &&)
  WHERE (status IN ('requested', 'approved'));--> statement-breakpoint

CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.roster
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.staff_leave
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint

-- Whether the signed in person manages a team (rosters.manage, and leave.manage for others).
CREATE OR REPLACE FUNCTION internal.jwt_manages_team() RETURNS boolean
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT coalesce(internal.jwt_staff_role() IN ('super_admin', 'centre_manager'), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.jwt_manages_team() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.jwt_manages_team() TO authenticated;--> statement-breakpoint

-- Whether the signed in person manages this staff member: the Super Admin manages everyone; a
-- Centre Manager, the people assigned to a centre they see.
CREATE OR REPLACE FUNCTION internal.jwt_manages_staff(staff_id uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT coalesce(
    internal.jwt_staff_role() = 'super_admin'
      OR (internal.jwt_staff_role() = 'centre_manager' AND internal.staff_in_seen_centre(staff_id)),
    false
  )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.jwt_manages_staff(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.jwt_manages_staff(uuid) TO authenticated;--> statement-breakpoint

-- Managers also see every centre's hours of the people they manage, so a change never clashes
-- with the person's hours elsewhere.
CREATE POLICY roster_read ON public.roster FOR SELECT TO authenticated
  USING (
    staff_user_id = (SELECT internal.jwt_staff_id())
    OR internal.jwt_sees_centre(centre_id)
    OR internal.jwt_manages_staff(staff_user_id)
  );--> statement-breakpoint
CREATE POLICY roster_insert ON public.roster FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT internal.jwt_manages_team())
    AND internal.jwt_sees_centre(centre_id)
    AND created_by = (SELECT internal.jwt_staff_id())
  );--> statement-breakpoint
CREATE POLICY roster_update ON public.roster FOR UPDATE TO authenticated
  USING ((SELECT internal.jwt_manages_team()) AND internal.jwt_sees_centre(centre_id))
  WITH CHECK (
    (SELECT internal.jwt_manages_team())
    AND internal.jwt_sees_centre(centre_id)
    AND created_by = (SELECT internal.jwt_staff_id())
  );--> statement-breakpoint

CREATE POLICY staff_leave_read ON public.staff_leave FOR SELECT TO authenticated
  USING (
    staff_user_id = (SELECT internal.jwt_staff_id())
    OR internal.jwt_manages_staff(staff_user_id)
  );--> statement-breakpoint
-- Their own request, or a manager recording someone else's leave.
CREATE POLICY staff_leave_insert ON public.staff_leave FOR INSERT TO authenticated
  WITH CHECK (
    requested_by = (SELECT internal.jwt_staff_id())
    AND (
      (staff_user_id = (SELECT internal.jwt_staff_id()) AND status = 'requested')
      OR (
        staff_user_id <> (SELECT internal.jwt_staff_id())
        AND internal.jwt_manages_staff(staff_user_id)
      )
    )
  );--> statement-breakpoint
-- A person cancels their own request; nothing else of their own changes.
CREATE POLICY staff_leave_update_own ON public.staff_leave FOR UPDATE TO authenticated
  USING (staff_user_id = (SELECT internal.jwt_staff_id()) AND status = 'requested')
  WITH CHECK (
    staff_user_id = (SELECT internal.jwt_staff_id())
    AND status IN ('requested', 'cancelled')
    AND decided_by IS NULL
  );--> statement-breakpoint
-- A manager decides or cancels the leave of the people they manage, never their own.
CREATE POLICY staff_leave_update_manager ON public.staff_leave FOR UPDATE TO authenticated
  USING (
    staff_user_id <> (SELECT internal.jwt_staff_id())
    AND internal.jwt_manages_staff(staff_user_id)
  )
  WITH CHECK (
    staff_user_id <> (SELECT internal.jwt_staff_id())
    AND internal.jwt_manages_staff(staff_user_id)
    AND (decided_by IS NULL OR decided_by = (SELECT internal.jwt_staff_id()))
  );--> statement-breakpoint

-- Velyx support stays read only here too (IAM-08).
CREATE POLICY support_read_only_insert ON public.roster AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.roster AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.roster AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_insert ON public.staff_leave AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.staff_leave AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.staff_leave AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));

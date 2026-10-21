-- IAM-08: Velyx support access (PRD section 2, TAD section 5). Off by default; the Super Admin
-- grants it for a time (support_grant). A support login (staff_user.velyx_support) has a token
-- claim only while a grant is active, and is read only: the app refuses its writes, its
-- transactions are read only (withStaffAccess), and the restrictive policies below refuse any
-- insert, update or delete under its claim. Every request it makes is audited (support_request).

-- Grants are audited like every table: who granted, who ended one early, and when.
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.support_grant
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint

-- The longest grant, in hours (rule 6; user decision, 22 October 2026).
SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint
INSERT INTO public.setting (key, value, updated_by) VALUES
  ('security.support_grant_max_hours', '24', 'system:migration')
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint
SELECT set_config('audit.actor', '', false);--> statement-breakpoint

-- Whether support access is granted at this moment.
CREATE OR REPLACE FUNCTION internal.support_access_active() RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.support_grant g WHERE g.starts_at <= now() AND g.ends_at > now()
  )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.support_access_active() FROM PUBLIC, anon, authenticated;--> statement-breakpoint

-- The claims now say whether the login is Velyx support, and a support login has none (so no
-- session) while no grant is active.
CREATE OR REPLACE FUNCTION internal.staff_claims(auth_user_id uuid) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'staff_id', s.id,
    'role', s.role,
    'treats_patients', s.treats_patients,
    'consultant', s.consultant,
    'all_centres', s.role IN ('super_admin', 'finance'),
    'centres', coalesce(
      (SELECT jsonb_agg(c.centre_id ORDER BY c.centre_id)
         FROM public.staff_user_centre c
        WHERE c.staff_user_id = s.id),
      '[]'::jsonb),
    'support', s.velyx_support
  )
  FROM public.staff_user s
  WHERE s.auth_user_id = staff_claims.auth_user_id
    AND s.active
    AND (s.access_ends_at IS NULL OR s.access_ends_at > now())
    AND (NOT s.velyx_support OR internal.support_access_active())
$$;--> statement-breakpoint

-- Whether the signed in person is a Velyx support login.
CREATE OR REPLACE FUNCTION internal.jwt_support() RETURNS boolean
LANGUAGE sql STABLE SET search_path = ''
AS $$ SELECT coalesce((internal.jwt_clinic() ->> 'support')::boolean, false) $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.jwt_support() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.jwt_support() TO authenticated;--> statement-breakpoint

-- Grants: the Super Admin reads them (a support login too, read only) and grants or ends them.
-- Nobody deletes one.
CREATE POLICY support_grant_read ON public.support_grant FOR SELECT TO authenticated
  USING ((SELECT internal.jwt_staff_role()) = 'super_admin');--> statement-breakpoint
CREATE POLICY support_grant_insert ON public.support_grant FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT internal.jwt_staff_role()) = 'super_admin'
    AND granted_by = (SELECT internal.jwt_staff_id())
  );--> statement-breakpoint
CREATE POLICY support_grant_update ON public.support_grant FOR UPDATE TO authenticated
  USING ((SELECT internal.jwt_staff_role()) = 'super_admin')
  WITH CHECK ((SELECT internal.jwt_staff_role()) = 'super_admin');--> statement-breakpoint

-- Read only for Velyx support, on every table people reach (job is server only). Restrictive
-- policies apply on top of every other policy, so no permissive policy can let a support login
-- write. A CI test checks every table with policies has these three.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['centre', 'staff_user', 'staff_user_centre', 'task', 'audit_event',
                           'setting', 'support_grant'] LOOP
    EXECUTE format(
      'CREATE POLICY support_read_only_insert ON public.%I AS RESTRICTIVE FOR INSERT '
      'TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()))', t);
    EXECUTE format(
      'CREATE POLICY support_read_only_update ON public.%I AS RESTRICTIVE FOR UPDATE '
      'TO authenticated USING (NOT (SELECT internal.jwt_support())) '
      'WITH CHECK (NOT (SELECT internal.jwt_support()))', t);
    EXECUTE format(
      'CREATE POLICY support_read_only_delete ON public.%I AS RESTRICTIVE FOR DELETE '
      'TO authenticated USING (NOT (SELECT internal.jwt_support()))', t);
  END LOOP;
END;
$$;--> statement-breakpoint

-- The SECURITY DEFINER writers people can call refuse a support login too.
CREATE OR REPLACE FUNCTION internal.record_access_event(action text, staff_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor text := nullif(current_setting('audit.actor', true), '');
BEGIN
  IF actor IS NULL THEN
    RAISE EXCEPTION 'An access event must name its actor'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF internal.jwt_support() THEN
    RAISE EXCEPTION 'Velyx support access is read only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF action NOT IN ('password_change', 'two_step_on', 'two_step_reset', 'staff_invited',
                    'invite_link_created') THEN
    RAISE EXCEPTION 'Not an access event: %', action USING ERRCODE = 'invalid_parameter_value';
  END IF;
  INSERT INTO public.audit_event (actor, action, entity, entity_id, ip)
  VALUES (
    actor,
    action::public.audit_action,
    'staff_user',
    staff_user_id::text,
    nullif(current_setting('audit.ip', true), '')
  );
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.end_staff_sessions(staff_user_id uuid) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  ended integer;
BEGIN
  IF internal.jwt_staff_role() IS DISTINCT FROM 'super_admin' OR internal.jwt_support() THEN
    RAISE EXCEPTION 'Only the Super Admin ends staff sessions'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  DELETE FROM auth.sessions s
  USING public.staff_user u
  WHERE u.id = end_staff_sessions.staff_user_id
    AND s.user_id = u.auth_user_id;
  GET DIAGNOSTICS ended = ROW_COUNT;
  RETURN ended;
END;
$$;--> statement-breakpoint

-- Ending support access early ends every support login's sessions at once, so no device can
-- refresh a token under it. Only the Super Admin (not a support login); returns how many ended.
CREATE OR REPLACE FUNCTION internal.end_support_sessions() RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  ended integer;
BEGIN
  IF internal.jwt_staff_role() IS DISTINCT FROM 'super_admin' OR internal.jwt_support() THEN
    RAISE EXCEPTION 'Only the Super Admin ends support access'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  DELETE FROM auth.sessions s
  USING public.staff_user u
  WHERE u.velyx_support
    AND s.user_id = u.auth_user_id;
  GET DIAGNOSTICS ended = ROW_COUNT;
  RETURN ended;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.end_support_sessions() FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.end_support_sessions() TO authenticated;

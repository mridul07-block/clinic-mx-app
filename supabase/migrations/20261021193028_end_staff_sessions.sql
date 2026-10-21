-- IAM-07: deactivating a staff member ends their Supabase sessions at once, so no device can refresh
-- a token for them again, inside or outside our app. Called from the Super Admin's staff service,
-- which runs as `authenticated` under row level security; this SECURITY DEFINER function reaches
-- auth.sessions for that one login, and only when the caller's own claim is the Super Admin's.
-- Their refresh tokens go with the sessions (ON DELETE CASCADE). Returns how many ended.
CREATE OR REPLACE FUNCTION internal.end_staff_sessions(staff_user_id uuid) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  ended integer;
BEGIN
  IF internal.jwt_staff_role() IS DISTINCT FROM 'super_admin' THEN
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
REVOKE ALL ON FUNCTION internal.end_staff_sessions(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.end_staff_sessions(uuid) TO authenticated;

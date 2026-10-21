-- IAM-06: access events (an invite sent, an invite link made, two step verification reset) recorded
-- from inside a staff transaction under row level security. audit_event has no insert policy, so
-- this SECURITY DEFINER function writes the row with the transaction's own audit actor
-- (audit.actor, set by withStaffAccess): a caller cannot name anyone else. Only access actions are
-- accepted; row changes are recorded by the audit trigger.
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
REVOKE ALL ON FUNCTION internal.record_access_event(text, uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.record_access_event(text, uuid) TO authenticated;

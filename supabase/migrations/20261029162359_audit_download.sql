-- ADM-04: the audit log download (PRD section 2: "Audit log and data export | Full | Clinical
-- audit, own centres | No | No | Finance audit"). Its readers download the events they may read
-- (internal.audit_log decides which, as on the screen), for a span of days; each download is itself
-- audited, in the Super Admin's part of the trail. Recommended defaults chosen under the user's
-- standing approval, 29 October 2026 (DECISION ADM-04; docs/runbooks/audit.md).

-- Records a download of the audit log by the signed in staff member, with its filters and the
-- number of events. Only the audit log's readers, never Velyx support.
CREATE FUNCTION internal.log_audit_download(filters jsonb, events integer) RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF internal.jwt_support()
    OR internal.jwt_staff_role() IS NULL
    OR internal.jwt_staff_role() NOT IN ('super_admin', 'centre_manager', 'finance')
  THEN
    RAISE EXCEPTION 'Only the audit log''s readers download it'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO public.audit_event (actor, action, entity, entity_id, after, ip)
  VALUES ('staff:' || internal.jwt_staff_id()::text, 'export', 'audit_event', NULL,
    jsonb_build_object('filters', filters, 'events', events),
    nullif(current_setting('audit.ip', true), ''));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.log_audit_download(jsonb, integer) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.log_audit_download(jsonb, integer) TO authenticated;--> statement-breakpoint

SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint
INSERT INTO public.setting (key, value, updated_by) VALUES
  -- DECISION ADM-04: a download covers at most 31 days and 5,000 events; more is refused, with
  -- the advice to narrow it, never cut short.
  ('audit.download_max_days', '31', 'system:migration'),
  ('audit.download_max_events', '5000', 'system:migration')
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint
SELECT set_config('audit.actor', '', false);

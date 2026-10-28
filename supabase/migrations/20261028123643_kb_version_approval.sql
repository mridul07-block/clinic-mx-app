-- SET-06: knowledge base versions, viewer and approval (PRD M16; PRD section 3, "Knowledge base:
-- Edit and approve versions" for the Super Admin; PRD 278: "Knowledge base edits go live only as a
-- new version he approves"). Recommended defaults chosen under the user's standing approval,
-- 28 October 2026 (docs/runbooks/knowledge-base.md). Versions are still made only by the import
-- (`pnpm kb:import --apply`, audited `system:kb-import`), as drafts. The Super Admin approves a
-- draft through `internal.approve_kb_version`, the only write a signed in person makes; nobody
-- writes kb_version directly. An approved version never changes, and nobody deletes one.

-- A version changes only from draft to approved, with its notes, and only once.
CREATE OR REPLACE FUNCTION internal.kb_version_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  approval text[] := ARRAY['status', 'approved_by', 'approved_at', 'notes', 'updated_at'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A knowledge base version is never deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'approved' THEN
    RAISE EXCEPTION 'An approved knowledge base version never changes'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (to_jsonb(NEW) - approval) IS DISTINCT FROM (to_jsonb(OLD) - approval)
    OR NEW.status <> 'approved' THEN
    RAISE EXCEPTION 'A draft knowledge base version changes only by its approval'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.kb_version_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER kb_version_guard BEFORE UPDATE OR DELETE ON public.kb_version
  FOR EACH ROW EXECUTE FUNCTION internal.kb_version_guard();--> statement-breakpoint

-- The Super Admin (not Velyx support) approves a draft newer than the live version, with an
-- optional note; the approver is who is signed in, never named by the caller. Audited by
-- kb_version's audit_change as the transaction's actor. Returns the version's number.
CREATE OR REPLACE FUNCTION internal.approve_kb_version(p_version_id uuid, p_notes text)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target public.kb_version;
  live integer;
BEGIN
  IF coalesce(current_setting('audit.actor', true), '') = ''
    OR coalesce(internal.jwt_staff_role() <> 'super_admin', true)
    OR coalesce(internal.jwt_support(), false) THEN
    RAISE EXCEPTION 'Only the Super Admin approves a knowledge base version'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO target FROM public.kb_version WHERE id = p_version_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That version was not found.' USING ERRCODE = 'no_data_found';
  END IF;
  IF target.status = 'approved' THEN
    RAISE EXCEPTION 'Version % is already approved.', target.number
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT max(v.number) INTO live FROM public.kb_version v WHERE v.status = 'approved';
  IF live IS NOT NULL AND target.number <= live THEN
    RAISE EXCEPTION 'Version % is older than the live version %.', target.number, live
      USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.kb_version
    SET status = 'approved', approved_by = internal.jwt_staff_id(), approved_at = now(),
      notes = nullif(btrim(coalesce(p_notes, '')), ''), updated_at = now()
    WHERE id = p_version_id;
  RETURN target.number;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.approve_kb_version(uuid, text) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.approve_kb_version(uuid, text) TO authenticated;--> statement-breakpoint

-- How many consultations and session notes stored a version, for the Super Admin deciding on a
-- newer one: every record, drafts included, whatever their own access; counts only, no rows.
CREATE OR REPLACE FUNCTION internal.kb_version_usage(p_version_id uuid)
RETURNS TABLE (consultations integer, sessions integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF coalesce(internal.jwt_staff_role() <> 'super_admin', true)
    OR coalesce(internal.jwt_support(), false) THEN
    RAISE EXCEPTION 'Only the Super Admin reads how many records used a version'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY SELECT
    (SELECT count(*)::integer FROM public.consultation c WHERE c.kb_version_id = p_version_id),
    (SELECT count(*)::integer FROM public.session s WHERE s.kb_version_id = p_version_id);
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.kb_version_usage(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.kb_version_usage(uuid) TO authenticated;

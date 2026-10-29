-- AI-07: patient content per condition (TAD `kb_patient_content`; PRD J3.8: "clinician approved
-- content for the diagnosis"; ticket: "clinician approves before patients see it"). Everyone who
-- reads the knowledge base reads it. A consultant who treats patients writes a condition's one
-- draft against the live knowledge base version, edits or discards it, and approves it through
-- internal.approve_patient_content, which supersedes the condition's approved text. An approved
-- (or superseded) text never changes and is never removed. AI drafts (once the gateway has its
-- key) are written by the system. Recommended defaults chosen under the user's standing approval,
-- 29 October 2026 (DECISION AI-07; docs/runbooks/patient-content.md).

CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.kb_patient_content
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint

-- Whether the signed in person writes and approves patient content: an active consultant who
-- treats patients, never a Velyx support login.
CREATE FUNCTION internal.writes_patient_content() RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT NOT coalesce(internal.jwt_support(), false)
    AND EXISTS (
      SELECT 1 FROM public.staff_user s
      WHERE s.id = internal.jwt_staff_id() AND s.active AND s.consultant AND s.treats_patients
    )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.writes_patient_content() FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.writes_patient_content() TO authenticated;--> statement-breakpoint

-- The live knowledge base version: the newest approved; before any approval, the newest import.
CREATE FUNCTION internal.live_kb_version() RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT v.id FROM public.kb_version v
  WHERE v.status = 'approved'
    OR NOT EXISTS (SELECT 1 FROM public.kb_version a WHERE a.status = 'approved')
  ORDER BY v.number DESC
  LIMIT 1
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.live_kb_version() FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.live_kb_version() TO authenticated;--> statement-breakpoint

-- What every write must keep: a draft is written against a version holding the condition, by its
-- writer (a person's draft) or the system (an AI draft); text changes only while it is a draft;
-- approved text changes only to superseded; only a draft is removed.
-- SECURITY DEFINER so its own checks read the knowledge base whoever writes; row level security
-- then decides whether they may.
CREATE FUNCTION internal.patient_content_guard() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'Approved patient content is kept' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'Patient content starts as a draft' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.kb_condition c
      WHERE c.kb_version_id = NEW.kb_version_id AND c.condition_id = NEW.condition_id
    ) THEN
      RAISE EXCEPTION 'No condition % in that knowledge base version', NEW.condition_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF internal.jwt_staff_id() IS NOT NULL THEN
      NEW.source := 'clinician';
      NEW.written_by := internal.jwt_staff_id();
    END IF;
    NEW.created_at := now();
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  IF OLD.status = 'draft' THEN
    IF NEW.condition_id IS DISTINCT FROM OLD.condition_id
      OR NEW.source IS DISTINCT FROM OLD.source
      OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'A draft keeps its condition' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'draft' AND internal.jwt_staff_id() IS NOT NULL THEN
      NEW.written_by := internal.jwt_staff_id();
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  IF OLD.status = 'approved' AND NEW.status = 'superseded'
    AND (NEW.condition_id, NEW.kb_version_id, NEW.explanation, NEW.roadmap, NEW.home_advice,
      NEW.warning_signs, NEW.source, NEW.written_by, NEW.approved_by, NEW.approved_at,
      NEW.created_at)
      IS NOT DISTINCT FROM
      (OLD.condition_id, OLD.kb_version_id, OLD.explanation, OLD.roadmap, OLD.home_advice,
      OLD.warning_signs, OLD.source, OLD.written_by, OLD.approved_by, OLD.approved_at,
      OLD.created_at)
  THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Approved patient content never changes' USING ERRCODE = 'check_violation';
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.patient_content_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER patient_content_guard BEFORE INSERT OR UPDATE OR DELETE
  ON public.kb_patient_content
  FOR EACH ROW EXECUTE FUNCTION internal.patient_content_guard();--> statement-breakpoint

CREATE POLICY patient_content_read ON public.kb_patient_content FOR SELECT TO authenticated
  USING ((SELECT internal.jwt_views_knowledge()));--> statement-breakpoint
-- A consultant who treats patients writes a draft, against the live version, edits and discards
-- it; approving goes through the function below.
CREATE POLICY patient_content_draft ON public.kb_patient_content FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT internal.writes_patient_content())
    AND status = 'draft'
    AND kb_version_id = (SELECT internal.live_kb_version())
  );--> statement-breakpoint
CREATE POLICY patient_content_edit ON public.kb_patient_content FOR UPDATE TO authenticated
  USING ((SELECT internal.writes_patient_content()) AND status = 'draft')
  WITH CHECK (status = 'draft' AND kb_version_id = (SELECT internal.live_kb_version()));--> statement-breakpoint
CREATE POLICY patient_content_discard ON public.kb_patient_content FOR DELETE TO authenticated
  USING ((SELECT internal.writes_patient_content()) AND status = 'draft');--> statement-breakpoint
CREATE POLICY support_read_only_insert ON public.kb_patient_content AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.kb_patient_content AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.kb_patient_content AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
REVOKE TRUNCATE ON public.kb_patient_content FROM authenticated;--> statement-breakpoint

-- Approving a condition's draft, as the consultant who read it: it becomes what patients see, and
-- the condition's approved text before it is superseded. The approved row's id.
CREATE FUNCTION internal.approve_patient_content(draft_id uuid) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  draft record;
BEGIN
  IF NOT internal.writes_patient_content() THEN
    RAISE EXCEPTION 'Only a consultant who treats patients approves patient content'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT c.id, c.condition_id, c.status INTO draft
    FROM public.kb_patient_content c WHERE c.id = approve_patient_content.draft_id FOR UPDATE;
  IF NOT FOUND OR draft.status <> 'draft' THEN
    RAISE EXCEPTION 'That draft is no longer waiting' USING ERRCODE = 'check_violation';
  END IF;
  -- One approval per condition at a time.
  PERFORM pg_advisory_xact_lock(hashtext('patient_content:' || draft.condition_id));
  UPDATE public.kb_patient_content c SET status = 'superseded'
    WHERE c.condition_id = draft.condition_id AND c.status = 'approved';
  UPDATE public.kb_patient_content c
    SET status = 'approved', approved_by = internal.jwt_staff_id(), approved_at = now()
    WHERE c.id = draft.id;
  RETURN draft.id;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.approve_patient_content(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.approve_patient_content(uuid) TO authenticated;

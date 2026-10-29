-- AI-07 review: a decision or a save is on the text that was read. Each save of a draft counts a
-- revision; approving names the revision read and is refused for any other, or for a draft written
-- against a knowledge base version no longer live (save it again first). Writers are knowledge base
-- readers too (a desk login with both ticks writes nothing); a row's id never changes; the table is
-- never truncated. Recommended defaults chosen under the user's standing approval, 29 October 2026
-- (DECISION AI-07; docs/runbooks/patient-content.md).

CREATE OR REPLACE FUNCTION internal.writes_patient_content() RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT NOT coalesce(internal.jwt_support(), false)
    AND coalesce(internal.jwt_views_knowledge(), false)
    AND EXISTS (
      SELECT 1 FROM public.staff_user s
      WHERE s.id = internal.jwt_staff_id() AND s.active AND s.consultant AND s.treats_patients
    )
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.patient_content_guard() RETURNS trigger
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
    NEW.revision := 1;
    NEW.created_at := now();
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Patient content keeps its id' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'draft' THEN
    IF NEW.condition_id IS DISTINCT FROM OLD.condition_id
      OR NEW.source IS DISTINCT FROM OLD.source
      OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'A draft keeps its condition' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.kb_version_id IS DISTINCT FROM OLD.kb_version_id AND NOT EXISTS (
      SELECT 1 FROM public.kb_condition c
      WHERE c.kb_version_id = NEW.kb_version_id AND c.condition_id = NEW.condition_id
    ) THEN
      RAISE EXCEPTION 'No condition % in that knowledge base version', NEW.condition_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF NEW.status = 'draft' THEN
      -- A save: one more revision, by whoever saved it.
      NEW.revision := OLD.revision + 1;
      IF internal.jwt_staff_id() IS NOT NULL THEN
        NEW.written_by := internal.jwt_staff_id();
      END IF;
    ELSE
      NEW.revision := OLD.revision;
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  IF OLD.status = 'approved' AND NEW.status = 'superseded'
    AND (NEW.condition_id, NEW.kb_version_id, NEW.explanation, NEW.roadmap, NEW.home_advice,
      NEW.warning_signs, NEW.source, NEW.written_by, NEW.approved_by, NEW.approved_at,
      NEW.created_at, NEW.revision)
      IS NOT DISTINCT FROM
      (OLD.condition_id, OLD.kb_version_id, OLD.explanation, OLD.roadmap, OLD.home_advice,
      OLD.warning_signs, OLD.source, OLD.written_by, OLD.approved_by, OLD.approved_at,
      OLD.created_at, OLD.revision)
  THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Approved patient content never changes' USING ERRCODE = 'check_violation';
END;
$$;--> statement-breakpoint

-- Approved text is never emptied out wholesale either.
CREATE FUNCTION internal.patient_content_no_truncate() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Patient content is kept' USING ERRCODE = 'check_violation';
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.patient_content_no_truncate() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER patient_content_no_truncate BEFORE TRUNCATE ON public.kb_patient_content
  FOR EACH STATEMENT EXECUTE FUNCTION internal.patient_content_no_truncate();--> statement-breakpoint

-- Approving the revision of a condition's draft the consultant read, written against the live
-- version: it becomes what patients see, and the condition's approved text before it is
-- superseded. The approved row's id.
DROP FUNCTION internal.approve_patient_content(uuid);--> statement-breakpoint
CREATE FUNCTION internal.approve_patient_content(draft_id uuid, read_revision integer)
RETURNS uuid
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
  SELECT c.id, c.condition_id, c.status, c.revision, c.kb_version_id INTO draft
    FROM public.kb_patient_content c WHERE c.id = approve_patient_content.draft_id FOR UPDATE;
  IF NOT FOUND OR draft.status <> 'draft' THEN
    RAISE EXCEPTION 'That draft is no longer waiting' USING ERRCODE = 'check_violation';
  END IF;
  IF draft.revision <> approve_patient_content.read_revision THEN
    RAISE EXCEPTION 'The draft has changed since it was read' USING ERRCODE = 'check_violation';
  END IF;
  IF draft.kb_version_id IS DISTINCT FROM internal.live_kb_version() THEN
    RAISE EXCEPTION 'The draft was written against an older knowledge base version'
      USING ERRCODE = 'check_violation';
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
REVOKE ALL ON FUNCTION internal.approve_patient_content(uuid, integer) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.approve_patient_content(uuid, integer) TO authenticated;

-- OUT-08: readiness and clearances (PRD J6.3 to J6.5, section 7 "Return to sport"; user decisions
-- 27 October 2026). The workbooks' readiness criteria are knowledge, read like the measures. On a
-- treated episode (Active or Under review), anyone with the Consultant and Treats patients ticks
-- now marks a yes or no criterion, overrides one with a written reason, or records a reading for a
-- measured one (as `measure` rows of a readiness recording); all appended, never changed. Each of
-- the three clearances is signed once, in order, keeping every criterion of the region's version,
-- each Met or overridden; the marks it keeps are the latest on record. Clinical readers read it all
-- at any centre; every change audited; Velyx support never writes.

-- The knowledge: read like the measures; nobody signed in writes it (the import writes as the owner).
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.kb_readiness_criterion
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint
CREATE POLICY kb_readiness_criterion_read ON public.kb_readiness_criterion FOR SELECT
  TO authenticated USING ((SELECT internal.jwt_views_knowledge()));--> statement-breakpoint
CREATE POLICY support_read_only_insert ON public.kb_readiness_criterion AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.kb_readiness_criterion AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.kb_readiness_criterion AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint

-- Whether the caller, with both ticks now, works on this treated episode's readiness.
CREATE OR REPLACE FUNCTION internal.works_readiness(episode_id uuid) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.staff_user s
    WHERE s.id = internal.jwt_staff_id() AND s.active AND s.consultant AND s.treats_patients
  ) AND EXISTS (
    SELECT 1 FROM public.episode e
    WHERE e.id = works_readiness.episode_id AND e.status IN ('active', 'under_review')
  )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.works_readiness(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.works_readiness(uuid) TO authenticated;--> statement-breakpoint

-- A criterion's kind (measure or check) in a version, by its key; null when it is none.
CREATE OR REPLACE FUNCTION internal.readiness_criterion_kind(kb_version_id uuid, key text)
RETURNS public.kb_readiness_kind
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT c.kind FROM public.kb_readiness_criterion c
  WHERE c.kb_version_id = readiness_criterion_kind.kb_version_id
    AND c.key = readiness_criterion_kind.key
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.readiness_criterion_kind(uuid, text) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.readiness_criterion_kind(uuid, text) TO authenticated;--> statement-breakpoint

-- Recordings and marks: stamped as the caller now, on a treated episode, for the version's
-- criteria (a check's result only on a yes or no criterion); never changed.
CREATE OR REPLACE FUNCTION internal.readiness_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Readiness records never change' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT internal.works_readiness(NEW.episode_id) THEN
    RAISE EXCEPTION 'Readiness is recorded by a consultant with the Treats patients tick, while the episode is Active or Under review'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_TABLE_NAME = 'readiness_recording' THEN
    NEW.recorded_by := internal.jwt_staff_id();
    NEW.recorded_at := now();
    IF NOT EXISTS (
      SELECT 1 FROM public.kb_readiness_criterion c WHERE c.kb_version_id = NEW.kb_version_id
    ) THEN
      RAISE EXCEPTION 'That knowledge base version has no readiness criteria'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  NEW.marked_by := internal.jwt_staff_id();
  NEW.marked_at := now();
  IF internal.readiness_criterion_kind(NEW.kb_version_id, NEW.criterion_key) IS NULL THEN
    RAISE EXCEPTION 'That is not a readiness criterion of this version' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.kind = 'check'
     AND internal.readiness_criterion_kind(NEW.kb_version_id, NEW.criterion_key) <> 'check' THEN
    RAISE EXCEPTION 'A measured criterion is judged by its reading' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.readiness_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER readiness_guard BEFORE INSERT OR UPDATE ON public.readiness_recording
  FOR EACH ROW EXECUTE FUNCTION internal.readiness_guard();--> statement-breakpoint
CREATE TRIGGER readiness_guard BEFORE INSERT OR UPDATE ON public.readiness_mark
  FOR EACH ROW EXECUTE FUNCTION internal.readiness_guard();--> statement-breakpoint

-- Whether the caller is writing this recording of the episode, in this very transaction.
CREATE OR REPLACE FUNCTION internal.writing_readiness_recording(
  recording_id uuid, episode_id uuid, kb_version_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.readiness_recording r
    WHERE r.id = writing_readiness_recording.recording_id
      AND r.episode_id = writing_readiness_recording.episode_id
      AND r.kb_version_id = writing_readiness_recording.kb_version_id
      AND r.recorded_by = internal.jwt_staff_id()
      AND r.recorded_at = now()
  )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.writing_readiness_recording(uuid, uuid, uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.writing_readiness_recording(uuid, uuid, uuid) TO authenticated;--> statement-breakpoint

-- Whether a measure is a measured criterion of the version.
CREATE OR REPLACE FUNCTION internal.readiness_measure(kb_version_id uuid, measure_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.kb_readiness_criterion c
    WHERE c.kb_version_id = readiness_measure.kb_version_id
      AND c.measure_key = readiness_measure.measure_key
  )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.readiness_measure(uuid, text) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.readiness_measure(uuid, text) TO authenticated;--> statement-breakpoint

-- A panel reading: with the caller's own recording of this transaction, for a criterion's measure.
CREATE POLICY measure_readiness ON public.measure FOR INSERT TO authenticated
  WITH CHECK (
    measure.readiness_recording_id IS NOT NULL
    AND internal.writing_readiness_recording(
      measure.readiness_recording_id, measure.episode_id, measure.kb_version_id
    )
    AND internal.readiness_measure(measure.kb_version_id, measure.measure_key)
    AND measure.created_by = (SELECT internal.jwt_staff_id())
  );--> statement-breakpoint
DROP POLICY measure_read ON public.measure;--> statement-breakpoint
CREATE POLICY measure_read ON public.measure FOR SELECT TO authenticated
  USING (
    internal.reads_consultation(measure.consultation_id)
    OR internal.reads_session(measure.session_id)
    OR (
      (measure.final_test_id IS NOT NULL OR measure.readiness_recording_id IS NOT NULL)
      AND (SELECT internal.jwt_clinical_reader())
    )
  );--> statement-breakpoint

-- A clearance: stamped as the caller now, both ticks now, a treated episode, in order, and keeping
-- exactly the version's criteria for its region, each Met or overridden; a yes or no criterion it
-- keeps as Met, and each override's reason, are the latest marks on record. Never changed.
CREATE OR REPLACE FUNCTION internal.clearance_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  before_status public.clearance_status;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'A signed clearance never changes' USING ERRCODE = 'check_violation';
  END IF;
  NEW.signed_by := internal.jwt_staff_id();
  NEW.signed_at := now();
  IF NOT internal.works_readiness(NEW.episode_id) THEN
    RAISE EXCEPTION 'A clearance is signed by a consultant with the Treats patients tick, while the episode is Active or Under review'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  before_status := CASE NEW.status
    WHEN 'return_to_training' THEN 'rehabilitation_complete'::public.clearance_status
    WHEN 'return_to_sport' THEN 'return_to_training'::public.clearance_status
  END;
  IF before_status IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.clearance c
    WHERE c.episode_id = NEW.episode_id AND c.status = before_status
  ) THEN
    RAISE EXCEPTION 'The clearances are signed in order' USING ERRCODE = 'check_violation';
  END IF;
  IF jsonb_typeof(NEW.criteria) <> 'array' OR jsonb_array_length(NEW.criteria) = 0 THEN
    RAISE EXCEPTION 'A clearance keeps its criteria' USING ERRCODE = 'check_violation';
  END IF;
  -- Exactly the version's criteria for the region, once each.
  IF (SELECT array_agg(e ->> 'key' ORDER BY e ->> 'key') FROM jsonb_array_elements(NEW.criteria) e)
     IS DISTINCT FROM
     (SELECT array_agg(c.key ORDER BY c.key) FROM public.kb_readiness_criterion c
       WHERE c.kb_version_id = NEW.kb_version_id AND c.region = NEW.region) THEN
    RAISE EXCEPTION 'A clearance keeps exactly the region''s criteria' USING ERRCODE = 'check_violation';
  END IF;
  -- Each Met, or overridden with a reason.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(NEW.criteria) e
    WHERE e ->> 'result' IS DISTINCT FROM 'met'
      AND length(trim(coalesce(e ->> 'override', ''))) = 0
  ) THEN
    RAISE EXCEPTION 'Every criterion is Met or overridden with a reason' USING ERRCODE = 'check_violation';
  END IF;
  -- What the marks say: a yes or no criterion kept as Met is marked Met, and an override is the
  -- latest reason on record.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(NEW.criteria) e
    JOIN public.kb_readiness_criterion c
      ON c.kb_version_id = NEW.kb_version_id AND c.key = e ->> 'key'
    WHERE (
      c.kind = 'check' AND e ->> 'result' = 'met'
      AND (SELECT m.result FROM public.readiness_mark m
            WHERE m.episode_id = NEW.episode_id AND m.criterion_key = c.key AND m.kind = 'check'
            ORDER BY m.marked_at DESC LIMIT 1) IS DISTINCT FROM 'met'
    ) OR (
      e ->> 'override' IS NOT NULL
      AND (SELECT m.reason FROM public.readiness_mark m
            WHERE m.episode_id = NEW.episode_id AND m.criterion_key = c.key AND m.kind = 'override'
            ORDER BY m.marked_at DESC LIMIT 1) IS DISTINCT FROM e ->> 'override'
    )
  ) THEN
    RAISE EXCEPTION 'A clearance keeps the marks on record' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.clearance_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER clearance_guard BEFORE INSERT OR UPDATE ON public.clearance
  FOR EACH ROW EXECUTE FUNCTION internal.clearance_guard();--> statement-breakpoint

CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.readiness_recording
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.readiness_mark
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.clearance
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint

CREATE POLICY readiness_recording_read ON public.readiness_recording FOR SELECT TO authenticated
  USING ((SELECT internal.jwt_clinical_reader()));--> statement-breakpoint
CREATE POLICY readiness_recording_write ON public.readiness_recording FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT internal.jwt_consultant()) AND (SELECT internal.jwt_treats())
    AND readiness_recording.recorded_by = (SELECT internal.jwt_staff_id())
  );--> statement-breakpoint
CREATE POLICY readiness_mark_read ON public.readiness_mark FOR SELECT TO authenticated
  USING ((SELECT internal.jwt_clinical_reader()));--> statement-breakpoint
CREATE POLICY readiness_mark_write ON public.readiness_mark FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT internal.jwt_consultant()) AND (SELECT internal.jwt_treats())
    AND readiness_mark.marked_by = (SELECT internal.jwt_staff_id())
  );--> statement-breakpoint
CREATE POLICY clearance_read ON public.clearance FOR SELECT TO authenticated
  USING ((SELECT internal.jwt_clinical_reader()));--> statement-breakpoint
CREATE POLICY clearance_sign ON public.clearance FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT internal.jwt_consultant()) AND (SELECT internal.jwt_treats())
    AND clearance.signed_by = (SELECT internal.jwt_staff_id())
  );--> statement-breakpoint

-- Velyx support stays read only here too (IAM-08).
CREATE POLICY support_read_only_insert ON public.readiness_recording AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.readiness_recording AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.readiness_recording AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_insert ON public.readiness_mark AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.readiness_mark AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.readiness_mark AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_insert ON public.clearance AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.clearance AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.clearance AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint

-- Appended and signed: nobody changes or deletes them.
REVOKE UPDATE, DELETE, TRUNCATE ON public.readiness_recording, public.readiness_mark,
  public.clearance FROM authenticated;

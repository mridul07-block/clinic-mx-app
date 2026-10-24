-- CLN-09: sign and lock. A draft consultation is signed by its own consultant, who must have the
-- Treats patients tick at that moment (read from staff_user, not the token); signing changes only
-- the status, who signed and when (TAD authorisation model). The same transaction writes the
-- record's rows (measures, special test results, the diagnosis, the plan of care and its
-- modalities), which are written only then and never change, and completes the visit. Changes
-- after signing are addenda, written by clinicians who see the episode's centre. Every change is
-- audited; Velyx support never writes.

-- Whether a staff member is active and has the Treats patients tick now.
CREATE OR REPLACE FUNCTION internal.staff_treats(staff_id uuid) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.staff_user s
    WHERE s.id = staff_treats.staff_id AND s.active AND s.treats_patients
  )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.staff_treats(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.staff_treats(uuid) TO authenticated;--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.consultation_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  editable text[] := ARRAY['sections', 'version', 'updated_at'];
  signing text[] := ARRAY['status', 'signed_by', 'signed_at', 'version', 'updated_at'];
BEGIN
  IF OLD.status = 'signed' THEN
    RAISE EXCEPTION 'A signed consultation never changes; changes are addenda'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'signed' THEN
    IF (to_jsonb(NEW) - signing) IS DISTINCT FROM (to_jsonb(OLD) - signing) THEN
      RAISE EXCEPTION 'Signing changes nothing but the status, who signed and when'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.signed_by IS DISTINCT FROM NEW.physio_id
       OR (internal.jwt_staff_id() IS NOT NULL
           AND NEW.signed_by IS DISTINCT FROM internal.jwt_staff_id()) THEN
      RAISE EXCEPTION 'A consultation is signed by its own consultant'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT internal.staff_treats(NEW.signed_by) THEN
      RAISE EXCEPTION 'Signing needs the Treats patients tick'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - editable) IS DISTINCT FROM (to_jsonb(OLD) - editable) THEN
    RAISE EXCEPTION 'Only the sections of a consultation change while it is a draft'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE POLICY consultation_sign ON public.consultation FOR UPDATE TO authenticated
  USING (
    consultation.physio_id = (SELECT internal.jwt_staff_id())
    AND (SELECT internal.jwt_consultant())
    AND (SELECT internal.jwt_treats())
    AND consultation.status = 'draft'
  )
  WITH CHECK (
    consultation.physio_id = (SELECT internal.jwt_staff_id())
    AND consultation.signed_by = (SELECT internal.jwt_staff_id())
    AND consultation.status = 'signed'
  );--> statement-breakpoint

-- Who reads a consultation's record: its consultant, and clinicians who see the episode's centre
-- (the same as consultation_read).
CREATE OR REPLACE FUNCTION internal.reads_consultation(consultation_id uuid) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.consultation c
    JOIN public.episode e ON e.id = c.episode_id
    WHERE c.id = reads_consultation.consultation_id
      AND (
        c.physio_id = internal.jwt_staff_id()
        OR (internal.jwt_treats() AND internal.jwt_sees_centre(e.centre_id))
      )
  )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.reads_consultation(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.reads_consultation(uuid) TO authenticated;--> statement-breakpoint

-- Whether the caller is signing this consultation in this very transaction (signed_at is the
-- transaction's now()), on this episode: the only time its record rows are written.
CREATE OR REPLACE FUNCTION internal.signing_consultation(consultation_id uuid, episode_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.consultation c
    WHERE c.id = signing_consultation.consultation_id
      AND c.episode_id = signing_consultation.episode_id
      AND c.physio_id = internal.jwt_staff_id()
      AND c.status = 'signed'
      AND c.signed_at = now()
  )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.signing_consultation(uuid, uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.signing_consultation(uuid, uuid) TO authenticated;--> statement-breakpoint

-- The version a consultation keeps, for its rows.
CREATE OR REPLACE FUNCTION internal.consultation_kb_version(consultation_id uuid) RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT c.kb_version_id FROM public.consultation c
  WHERE c.id = consultation_kb_version.consultation_id
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.consultation_kb_version(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.consultation_kb_version(uuid) TO authenticated;--> statement-breakpoint

-- Whether the caller may add an addendum: a clinician with the Treats patients tick now, on a
-- signed consultation they read, on its episode.
CREATE OR REPLACE FUNCTION internal.adds_addendum(consultation_id uuid, episode_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT internal.jwt_treats()
    AND internal.staff_treats(internal.jwt_staff_id())
    AND internal.reads_consultation(adds_addendum.consultation_id)
    AND EXISTS (
      SELECT 1 FROM public.consultation c
      WHERE c.id = adds_addendum.consultation_id
        AND c.episode_id = adds_addendum.episode_id
        AND c.status = 'signed'
    )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.adds_addendum(uuid, uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.adds_addendum(uuid, uuid) TO authenticated;--> statement-breakpoint

CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.measure
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.special_test_result
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.diagnosis
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.plan_of_care
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.plan_modality
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.addendum
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint

CREATE POLICY measure_read ON public.measure FOR SELECT TO authenticated
  USING (internal.reads_consultation(measure.consultation_id));--> statement-breakpoint
CREATE POLICY measure_sign ON public.measure FOR INSERT TO authenticated
  WITH CHECK (
    internal.signing_consultation(measure.consultation_id, measure.episode_id)
    AND measure.kb_version_id = internal.consultation_kb_version(measure.consultation_id)
    AND measure.created_by = (SELECT internal.jwt_staff_id())
  );--> statement-breakpoint
CREATE POLICY special_test_result_read ON public.special_test_result FOR SELECT TO authenticated
  USING (internal.reads_consultation(special_test_result.consultation_id));--> statement-breakpoint
CREATE POLICY special_test_result_sign ON public.special_test_result FOR INSERT TO authenticated
  WITH CHECK (
    internal.signing_consultation(special_test_result.consultation_id, special_test_result.episode_id)
    AND special_test_result.kb_version_id
      = internal.consultation_kb_version(special_test_result.consultation_id)
  );--> statement-breakpoint
CREATE POLICY diagnosis_read ON public.diagnosis FOR SELECT TO authenticated
  USING (internal.reads_consultation(diagnosis.consultation_id));--> statement-breakpoint
CREATE POLICY diagnosis_sign ON public.diagnosis FOR INSERT TO authenticated
  WITH CHECK (
    internal.signing_consultation(diagnosis.consultation_id, diagnosis.episode_id)
    AND diagnosis.kb_version_id = internal.consultation_kb_version(diagnosis.consultation_id)
  );--> statement-breakpoint
CREATE POLICY plan_of_care_read ON public.plan_of_care FOR SELECT TO authenticated
  USING (internal.reads_consultation(plan_of_care.consultation_id));--> statement-breakpoint
CREATE POLICY plan_of_care_sign ON public.plan_of_care FOR INSERT TO authenticated
  WITH CHECK (
    internal.signing_consultation(plan_of_care.consultation_id, plan_of_care.episode_id)
    AND plan_of_care.created_by = (SELECT internal.jwt_staff_id())
  );--> statement-breakpoint

-- A plan's modality reaches its consultation through the plan.
CREATE OR REPLACE FUNCTION internal.plan_consultation(plan_id uuid)
RETURNS TABLE (consultation_id uuid, episode_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.consultation_id, p.episode_id FROM public.plan_of_care p
  WHERE p.id = plan_consultation.plan_id
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.plan_consultation(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.plan_consultation(uuid) TO authenticated;--> statement-breakpoint
CREATE POLICY plan_modality_read ON public.plan_modality FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM internal.plan_consultation(plan_modality.plan_of_care_id) p
      WHERE internal.reads_consultation(p.consultation_id)
    )
  );--> statement-breakpoint
CREATE POLICY plan_modality_sign ON public.plan_modality FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM internal.plan_consultation(plan_modality.plan_of_care_id) p
      WHERE internal.signing_consultation(p.consultation_id, p.episode_id)
    )
  );--> statement-breakpoint

CREATE POLICY addendum_read ON public.addendum FOR SELECT TO authenticated
  USING (internal.reads_consultation(addendum.consultation_id));--> statement-breakpoint
CREATE POLICY addendum_add ON public.addendum FOR INSERT TO authenticated
  WITH CHECK (
    addendum.author_id = (SELECT internal.jwt_staff_id())
    AND internal.adds_addendum(addendum.consultation_id, addendum.episode_id)
  );--> statement-breakpoint

-- Velyx support stays read only here too (IAM-08). Nobody updates or deletes these rows.
CREATE POLICY support_read_only_insert ON public.measure AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.measure AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.measure AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_insert ON public.special_test_result AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.special_test_result AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.special_test_result AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_insert ON public.diagnosis AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.diagnosis AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.diagnosis AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_insert ON public.plan_of_care AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.plan_of_care AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.plan_of_care AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_insert ON public.plan_modality AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.plan_modality AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.plan_modality AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_insert ON public.addendum AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.addendum AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.addendum AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint

-- A physio completes their own started visit once its consultation is signed (CLN-09); starting
-- it stays as CLN-01 made it.
CREATE OR REPLACE FUNCTION internal.appointment_physio_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  starting text[] := ARRAY['status', 'started_at', 'started_by', 'updated_at'];
  completing text[] := ARRAY['status', 'completed_at', 'updated_at'];
BEGIN
  IF internal.jwt_staff_id() IS NULL OR internal.jwt_edits_patients() THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'checked_in' AND NEW.status = 'in_progress'
     AND (to_jsonb(NEW) - starting) = (to_jsonb(OLD) - starting) THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'in_progress' AND NEW.status = 'completed' AND NEW.completed_at IS NOT NULL
     AND (to_jsonb(NEW) - completing) = (to_jsonb(OLD) - completing)
     AND EXISTS (
       SELECT 1 FROM public.consultation c
       WHERE c.appointment_id = NEW.id AND c.status = 'signed'
     ) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'A physio only starts their own checked in appointment, or completes it once its consultation is signed'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint

-- The health form's answers behind a signed consultation are part of its record: those who read
-- the consultation (its consultant, clinicians at the episode's centre) read them too. Before
-- signing, only the visit's own treating physio does (CLN-03).
CREATE OR REPLACE FUNCTION internal.consultant_health_form(visit_id uuid)
RETURNS TABLE (form_version text, answers jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT r.form_version, r.answers
  FROM public.intake_response r
  JOIN public.appointment a ON a.id = r.appointment_id
  WHERE r.appointment_id = consultant_health_form.visit_id
    AND r.submitted_at IS NOT NULL
    AND (
      (a.physio_id = internal.jwt_staff_id() AND internal.jwt_treats())
      OR EXISTS (
        SELECT 1 FROM public.consultation c
        WHERE c.appointment_id = a.id
          AND c.status = 'signed'
          AND internal.reads_consultation(c.id)
      )
    )
$$;
--> statement-breakpoint

-- The visit behind a signed consultation is part of its record: those who read the consultation
-- read the visit too (its time, centre and type), not the rest of a colleague's diary.
CREATE OR REPLACE FUNCTION internal.reads_signed_visit(visit_id uuid) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.consultation c
    WHERE c.appointment_id = reads_signed_visit.visit_id
      AND c.status = 'signed'
      AND internal.reads_consultation(c.id)
  )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.reads_signed_visit(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.reads_signed_visit(uuid) TO authenticated;--> statement-breakpoint
CREATE POLICY appointment_signed_consultation_read ON public.appointment FOR SELECT TO authenticated
  USING (internal.reads_signed_visit(appointment.id));

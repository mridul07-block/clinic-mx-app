-- OUT-05: the session 4 reassessment (PRD J5.10; decision 7 default, user decisions 26 October
-- 2026). Signing session `clinical.reassessment_session` writes its readings as measure rows of
-- that session and one reassessment row, only in that transaction and only by its own physio; the
-- database stamps the episode's consultant (who signed the consultation) and gives them a task.
-- The consultant alone signs a written decision, once, with the Treats patients tick now; signing
-- closes the task with it. Nothing else changes and nothing is deleted; read where the session
-- note is read; every change audited; Velyx support never writes.

-- Whether the caller is signing their own session numbered as given, in this very transaction.
CREATE OR REPLACE FUNCTION internal.signing_session_numbered(
  session_id uuid, episode_id uuid, kb_version_id uuid, numbers int[]
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.session s
    WHERE s.id = signing_session_numbered.session_id
      AND s.episode_id = signing_session_numbered.episode_id
      AND s.kb_version_id = signing_session_numbered.kb_version_id
      AND s.number = ANY (signing_session_numbered.numbers)
      AND s.physio_id = internal.jwt_staff_id()
      AND s.status = 'signed'
      AND s.signed_at = now()
  )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.signing_session_numbered(uuid, uuid, uuid, int[]) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.signing_session_numbered(uuid, uuid, uuid, int[]) TO authenticated;--> statement-breakpoint

-- The reassessment session's number, from the setting.
CREATE OR REPLACE FUNCTION internal.reassessment_session() RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT (st.value #>> '{}')::int FROM public.setting st
  WHERE st.key = 'clinical.reassessment_session'
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.reassessment_session() FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.reassessment_session() TO authenticated;--> statement-breakpoint

-- A session's readings are written while its physio signs session 1 (the baseline, OUT-01) or the
-- reassessment session (OUT-05).
DROP POLICY measure_baseline ON public.measure;--> statement-breakpoint
CREATE POLICY measure_session ON public.measure FOR INSERT TO authenticated
  WITH CHECK (
    measure.session_id IS NOT NULL
    AND internal.signing_session_numbered(
      measure.session_id, measure.episode_id, measure.kb_version_id,
      ARRAY[1, internal.reassessment_session()]
    )
    AND measure.created_by = (SELECT internal.jwt_staff_id())
  );--> statement-breakpoint

-- Written: the consultant stamped from the episode's signed consultation. Signed: only the
-- decision, who and when, once, by that consultant with the tick now.
CREATE OR REPLACE FUNCTION internal.reassessment_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  signing text[] := ARRAY['decision', 'signed_by', 'signed_at'];
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT c.signed_by INTO NEW.consultant_id
      FROM public.consultation c
      WHERE c.episode_id = NEW.episode_id AND c.status = 'signed'
      ORDER BY c.signed_at DESC
      LIMIT 1;
    IF NEW.consultant_id IS NULL THEN
      RAISE EXCEPTION 'A reassessment needs the episode''s signed consultation'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.not_tested := coalesce(NEW.not_tested, '{}'::jsonb);
    NEW.decision := NULL;
    NEW.signed_by := NULL;
    NEW.signed_at := NULL;
    NEW.created_at := now();
    RETURN NEW;
  END IF;
  IF OLD.signed_at IS NOT NULL THEN
    RAISE EXCEPTION 'A signed reassessment never changes' USING ERRCODE = 'check_violation';
  END IF;
  IF (to_jsonb(NEW) - signing) IS DISTINCT FROM (to_jsonb(OLD) - signing) THEN
    RAISE EXCEPTION 'Signing changes nothing but the decision, who signed and when'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.signed_by IS DISTINCT FROM OLD.consultant_id
     OR NEW.signed_by IS DISTINCT FROM internal.jwt_staff_id() THEN
    RAISE EXCEPTION 'A reassessment is signed by the episode''s consultant'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT internal.staff_treats(NEW.signed_by) THEN
    RAISE EXCEPTION 'Signing needs the Treats patients tick' USING ERRCODE = 'insufficient_privilege';
  END IF;
  NEW.signed_at := now();
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.reassessment_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER reassessment_guard BEFORE INSERT OR UPDATE ON public.reassessment
  FOR EACH ROW EXECUTE FUNCTION internal.reassessment_guard();--> statement-breakpoint

-- The consultant's task on writing; signing closes it with the decision, as the consultant.
CREATE OR REPLACE FUNCTION internal.reassessment_task() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  visit public.session%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO visit FROM public.session s WHERE s.id = NEW.session_id;
    INSERT INTO public.task (kind, title, details, priority, assignee_staff_user_id, centre_id,
      patient_id, episode_id)
    VALUES ('review.reassessment', 'Review the session ' || visit.number || ' reassessment',
      jsonb_build_object('reassessmentId', NEW.id, 'sessionNumber', visit.number), 'normal',
      NEW.consultant_id, visit.centre_id, visit.patient_id, NEW.episode_id);
  ELSIF OLD.signed_at IS NULL AND NEW.signed_at IS NOT NULL THEN
    UPDATE public.task t
      SET status = 'closed', decision = NEW.decision, closed_by = NEW.signed_by
      WHERE t.kind = 'review.reassessment' AND t.status = 'open'
        AND t.details ->> 'reassessmentId' = NEW.id::text;
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.reassessment_task() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER reassessment_task AFTER INSERT OR UPDATE ON public.reassessment
  FOR EACH ROW EXECUTE FUNCTION internal.reassessment_task();--> statement-breakpoint

CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.reassessment
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint

CREATE POLICY reassessment_read ON public.reassessment FOR SELECT TO authenticated
  USING (internal.reads_session(reassessment.session_id));--> statement-breakpoint
CREATE POLICY reassessment_record ON public.reassessment FOR INSERT TO authenticated
  WITH CHECK (
    internal.signing_session_numbered(
      reassessment.session_id, reassessment.episode_id, reassessment.kb_version_id,
      ARRAY[internal.reassessment_session()]
    )
  );--> statement-breakpoint
CREATE POLICY reassessment_sign ON public.reassessment FOR UPDATE TO authenticated
  USING (consultant_id = (SELECT internal.jwt_staff_id()) AND (SELECT internal.jwt_treats()))
  WITH CHECK (consultant_id = (SELECT internal.jwt_staff_id()));--> statement-breakpoint

-- Velyx support stays read only here too (IAM-08).
CREATE POLICY support_read_only_insert ON public.reassessment AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.reassessment AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.reassessment AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint

-- Signing changes only the decision, who and when; nobody deletes a reassessment.
REVOKE UPDATE, DELETE, TRUNCATE ON public.reassessment FROM authenticated;--> statement-breakpoint
GRANT UPDATE (decision, signed_by, signed_at) ON public.reassessment TO authenticated;

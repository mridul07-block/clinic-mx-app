-- OUT-07: final testing (PRD J6.2; user decisions 27 October 2026). Anyone with the Consultant
-- tick, and the Treats patients tick now, retests exactly the episode's frozen baseline (OUT-01)
-- while the episode is Active or Under review, once, and signs it as it is written. Its readings
-- are measure rows of it, written only in that transaction by its signer and only for baseline
-- measures. Nothing changes after and nothing is deleted; clinical readers read it at any centre
-- (it is always signed, CLN-12); every write audited; Velyx support never writes.

-- Whether a measure key is in the episode's frozen baseline.
CREATE OR REPLACE FUNCTION internal.in_baseline(episode_id uuid, measure_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.baseline_measure b
    WHERE b.episode_id = in_baseline.episode_id AND b.measure_key = in_baseline.measure_key
  )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.in_baseline(uuid, text) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.in_baseline(uuid, text) TO authenticated;--> statement-breakpoint

-- Whether the caller is signing this final test of the episode, in this very transaction.
CREATE OR REPLACE FUNCTION internal.writing_final_test(
  final_test_id uuid, episode_id uuid, kb_version_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.final_test f
    WHERE f.id = writing_final_test.final_test_id
      AND f.episode_id = writing_final_test.episode_id
      AND f.kb_version_id = writing_final_test.kb_version_id
      AND f.signed_by = internal.jwt_staff_id()
      AND f.signed_at = now()
  )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.writing_final_test(uuid, uuid, uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.writing_final_test(uuid, uuid, uuid) TO authenticated;--> statement-breakpoint

-- Written: signed by the caller now, with both ticks now, on a treated episode with a baseline,
-- at the baseline's version, and not tested only for baseline measures. Never changed.
CREATE OR REPLACE FUNCTION internal.final_test_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  baseline_version uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Signed final testing never changes' USING ERRCODE = 'check_violation';
  END IF;
  NEW.signed_by := internal.jwt_staff_id();
  NEW.signed_at := now();
  NEW.created_at := now();
  NEW.not_tested := coalesce(NEW.not_tested, '{}'::jsonb);
  IF NOT EXISTS (
    SELECT 1 FROM public.staff_user s
    WHERE s.id = NEW.signed_by AND s.active AND s.consultant AND s.treats_patients
  ) THEN
    RAISE EXCEPTION 'Final testing is signed with the Consultant and Treats patients ticks'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.episode e
    WHERE e.id = NEW.episode_id AND e.status IN ('active', 'under_review')
  ) THEN
    RAISE EXCEPTION 'Final testing is for an Active or Under review episode'
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT b.kb_version_id INTO baseline_version
    FROM public.baseline_measure b WHERE b.episode_id = NEW.episode_id LIMIT 1;
  IF baseline_version IS NULL THEN
    RAISE EXCEPTION 'Final testing needs the episode''s baseline' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.kb_version_id IS DISTINCT FROM baseline_version THEN
    RAISE EXCEPTION 'Final testing uses the baseline''s knowledge base version'
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(NEW.not_tested) k
    WHERE NOT internal.in_baseline(NEW.episode_id, k)
  ) THEN
    RAISE EXCEPTION 'Final testing retests only the baseline''s measures'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.final_test_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER final_test_guard BEFORE INSERT OR UPDATE ON public.final_test
  FOR EACH ROW EXECUTE FUNCTION internal.final_test_guard();--> statement-breakpoint

CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.final_test
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint

CREATE POLICY final_test_read ON public.final_test FOR SELECT TO authenticated
  USING ((SELECT internal.jwt_clinical_reader()));--> statement-breakpoint
CREATE POLICY final_test_sign ON public.final_test FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT internal.jwt_consultant())
    AND (SELECT internal.jwt_treats())
    AND final_test.signed_by = (SELECT internal.jwt_staff_id())
  );--> statement-breakpoint

-- Velyx support stays read only here too (IAM-08).
CREATE POLICY support_read_only_insert ON public.final_test AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.final_test AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.final_test AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint

-- Signed as written: nobody changes or deletes final testing.
REVOKE UPDATE, DELETE, TRUNCATE ON public.final_test FROM authenticated;--> statement-breakpoint

-- Its readings: written with it by its signer, baseline measures only; read with it.
CREATE POLICY measure_final_test ON public.measure FOR INSERT TO authenticated
  WITH CHECK (
    measure.final_test_id IS NOT NULL
    AND internal.writing_final_test(measure.final_test_id, measure.episode_id, measure.kb_version_id)
    AND internal.in_baseline(measure.episode_id, measure.measure_key)
    AND measure.created_by = (SELECT internal.jwt_staff_id())
  );--> statement-breakpoint
DROP POLICY measure_read ON public.measure;--> statement-breakpoint
CREATE POLICY measure_read ON public.measure FOR SELECT TO authenticated
  USING (
    internal.reads_consultation(measure.consultation_id)
    OR internal.reads_session(measure.session_id)
    OR (measure.final_test_id IS NOT NULL AND (SELECT internal.jwt_clinical_reader()))
  );

-- AI-05: the diagnosis confirmed at review or discharge (PRD section 6: the learning label, "not the
-- first impression"; TAD section 7). Recommended defaults chosen under the user's standing approval,
-- 29 October 2026 (DECISION AI-05; docs/runbooks/ai-similar-cases.md). An active consultant with
-- the Treats patients tick confirms the episode's latest signed diagnosis, or changes it to another
-- condition of the same knowledge base version, on the Review and discharge screen. The database
-- stamps who, when and the stage (Discharge once the episode is discharged, else Review). Nothing
-- changes after and nothing is deleted: a later confirmation is the label. Clinical readers read it
-- at any centre, as they read signed records (CLN-12); every write audited; Velyx support never
-- writes.
CREATE OR REPLACE FUNCTION internal.confirmed_diagnosis_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  signed_id uuid;
  signed_version uuid;
  episode_status text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.staff_user s
    WHERE s.id = internal.jwt_staff_id() AND s.active AND s.consultant AND s.treats_patients
      AND NOT s.velyx_support
  ) THEN
    RAISE EXCEPTION 'A diagnosis is confirmed by a consultant with the Treats patients tick'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT d.id, d.kb_version_id INTO signed_id, signed_version
  FROM public.diagnosis d
  JOIN public.consultation c ON c.id = d.consultation_id
  WHERE d.episode_id = NEW.episode_id AND c.status = 'signed'
  ORDER BY c.signed_at DESC, c.id DESC
  LIMIT 1;
  IF signed_id IS NULL
    OR NEW.source_diagnosis_id IS DISTINCT FROM signed_id
    OR NEW.kb_version_id IS DISTINCT FROM signed_version THEN
    RAISE EXCEPTION 'A diagnosis is confirmed against the episode''s latest signed diagnosis, in its knowledge base version'
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT e.status::text INTO episode_status FROM public.episode e WHERE e.id = NEW.episode_id;
  NEW.stage := CASE WHEN episode_status = 'discharged' THEN 'discharge' ELSE 'review' END;
  NEW.confirmed_by := internal.jwt_staff_id();
  -- The statement's own moment, so two confirmations in one transaction still order.
  NEW.confirmed_at := clock_timestamp();
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.confirmed_diagnosis_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER confirmed_diagnosis_guard BEFORE INSERT ON public.confirmed_diagnosis
  FOR EACH ROW EXECUTE FUNCTION internal.confirmed_diagnosis_guard();--> statement-breakpoint

CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.confirmed_diagnosis
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint

CREATE POLICY confirmed_diagnosis_read ON public.confirmed_diagnosis FOR SELECT TO authenticated
  USING ((SELECT internal.jwt_clinical_reader()));--> statement-breakpoint
CREATE POLICY confirmed_diagnosis_confirm ON public.confirmed_diagnosis FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT internal.jwt_consultant())
    AND (SELECT internal.jwt_treats())
    AND confirmed_diagnosis.confirmed_by = (SELECT internal.jwt_staff_id())
  );--> statement-breakpoint

-- Velyx support stays read only here too (IAM-08).
CREATE POLICY support_read_only_insert ON public.confirmed_diagnosis AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.confirmed_diagnosis AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.confirmed_diagnosis AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint

-- Confirmed as written: nobody changes or deletes a confirmation.
REVOKE UPDATE, DELETE, TRUNCATE ON public.confirmed_diagnosis FROM authenticated;

-- OUT-01: the baseline (PRD J5.3, section 7 "Baseline reuse"; user decisions 26 October 2026).
-- Session 1's signing writes it, as the consultation's signing writes its record: the markers
-- the session recorded become measure rows of that session, and every baseline measure gets one
-- baseline_measure row (reused from a consultation, recorded in the session, or not tested with
-- a reason). Both are written only in that signing transaction, by its own physio, and never
-- change. A reused reading must be the episode's signed consultation's, taken within
-- `clinical.baseline_reuse_days` before session 1 started. Who reads them is who reads the
-- session note. Every change is audited; Velyx support never writes.

-- Whether the caller is signing session 1 of this episode in this very transaction (signed_at is
-- the transaction's now()), at this knowledge base version.
CREATE OR REPLACE FUNCTION internal.signing_baseline(
  session_id uuid, episode_id uuid, kb_version_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.session s
    WHERE s.id = signing_baseline.session_id
      AND s.episode_id = signing_baseline.episode_id
      AND s.kb_version_id = signing_baseline.kb_version_id
      AND s.number = 1
      AND s.physio_id = internal.jwt_staff_id()
      AND s.status = 'signed'
      AND s.signed_at = now()
  )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.signing_baseline(uuid, uuid, uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.signing_baseline(uuid, uuid, uuid) TO authenticated;--> statement-breakpoint

-- Whether a consultation's reading of a measure counts for session 1's baseline: the episode's
-- signed consultation took it within the setting's days before the session started.
CREATE OR REPLACE FUNCTION internal.reusable_measure(
  consultation_id uuid, session_id uuid, measure_key text
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.session s
    JOIN public.consultation c
      ON c.id = reusable_measure.consultation_id
      AND c.episode_id = s.episode_id
      AND c.status = 'signed'
    JOIN public.measure m
      ON m.consultation_id = c.id AND m.measure_key = reusable_measure.measure_key
    WHERE s.id = reusable_measure.session_id
      AND m.taken_at <= s.created_at
      AND m.taken_at >= s.created_at - make_interval(days => (
        SELECT (st.value #>> '{}')::int FROM public.setting st
        WHERE st.key = 'clinical.baseline_reuse_days'
      ))
  )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.reusable_measure(uuid, uuid, text) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.reusable_measure(uuid, uuid, text) TO authenticated;--> statement-breakpoint

-- Whether the session recorded a reading of the measure itself.
CREATE OR REPLACE FUNCTION internal.session_measured(session_id uuid, measure_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.measure m
    WHERE m.session_id = session_measured.session_id
      AND m.measure_key = session_measured.measure_key
  )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.session_measured(uuid, text) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.session_measured(uuid, text) TO authenticated;--> statement-breakpoint

-- A measure is read by whoever reads the consultation or the session that took it.
DROP POLICY measure_read ON public.measure;--> statement-breakpoint
CREATE POLICY measure_read ON public.measure FOR SELECT TO authenticated
  USING (
    internal.reads_consultation(measure.consultation_id)
    OR internal.reads_session(measure.session_id)
  );--> statement-breakpoint
CREATE POLICY measure_baseline ON public.measure FOR INSERT TO authenticated
  WITH CHECK (
    measure.session_id IS NOT NULL
    AND internal.signing_baseline(measure.session_id, measure.episode_id, measure.kb_version_id)
    AND measure.created_by = (SELECT internal.jwt_staff_id())
  );--> statement-breakpoint

CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.baseline_measure
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint

CREATE POLICY baseline_measure_read ON public.baseline_measure FOR SELECT TO authenticated
  USING (internal.reads_session(baseline_measure.session_id));--> statement-breakpoint
CREATE POLICY baseline_measure_sign ON public.baseline_measure FOR INSERT TO authenticated
  WITH CHECK (
    internal.signing_baseline(
      baseline_measure.session_id, baseline_measure.episode_id, baseline_measure.kb_version_id
    )
    AND CASE
      WHEN baseline_measure.consultation_id IS NOT NULL THEN internal.reusable_measure(
        baseline_measure.consultation_id, baseline_measure.session_id, baseline_measure.measure_key
      )
      WHEN baseline_measure.not_tested_reason IS NOT NULL THEN true
      ELSE internal.session_measured(baseline_measure.session_id, baseline_measure.measure_key)
    END
  );--> statement-breakpoint

-- Velyx support stays read only here too (IAM-08).
CREATE POLICY support_read_only_insert ON public.baseline_measure AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.baseline_measure AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.baseline_measure AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint

-- Kept as signed: nobody signed in changes or deletes a baseline.
REVOKE UPDATE, DELETE, TRUNCATE ON public.baseline_measure FROM authenticated;

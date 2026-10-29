-- OUT-02: patient filled questionnaires (PRD J5.3, M10; TAD `questionnaire_result`; Frontend
-- Specification: one question per screen, progress shown, auto score; used at baseline,
-- reassessment and discharge). A questionnaire link for an open episode opens the plan's
-- questionnaires that can be filled (SET-08: items, a confirmed licence and sign-off, in the live
-- knowledge base version), one after another; the patient answers each once on that link, our
-- server scores it by the instrument's own rule, and the row keeps the raw answers, the score, the
-- knowledge base version and the instrument's own version. Read by clinicians as signed records
-- are; never changed. Recommended defaults chosen under the user's standing approval, 29 October
-- 2026 (DECISION OUT-02; docs/runbooks/questionnaires.md).

CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.questionnaire_result
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint

-- The plan's questionnaires a patient can fill for an open episode: in the live knowledge base
-- version (the newest approved; before any approval, the newest import), signed off with its items
-- and a confirmed licence; in the plan's order.
CREATE FUNCTION internal.questionnaires_for(p_episode_id uuid)
RETURNS TABLE (key text, name text, kb_version_id uuid, definition jsonb, sort integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH live AS (
    SELECT v.id FROM public.kb_version v
    WHERE v.status = 'approved'
      OR NOT EXISTS (SELECT 1 FROM public.kb_version a WHERE a.status = 'approved')
    ORDER BY v.number DESC
    LIMIT 1
  ), plan AS (
    SELECT p.questionnaires FROM public.plan_of_care p
    JOIN public.episode e ON e.id = p.episode_id
    WHERE p.episode_id = p_episode_id
      AND e.status IN ('plan_proposed', 'active', 'on_hold', 'under_review')
    ORDER BY p.version DESC
    LIMIT 1
  )
  SELECT q.key, q.name, q.kb_version_id, q.definition, array_position(plan.questionnaires, q.key)
  FROM plan
  CROSS JOIN live
  JOIN public.kb_questionnaire q ON q.kb_version_id = live.id AND q.key = ANY (plan.questionnaires)
  WHERE q.signed_off AND q.licence <> 'unconfirmed' AND jsonb_typeof(q.definition) = 'object'
  ORDER BY array_position(plan.questionnaires, q.key)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.questionnaires_for(uuid) FROM PUBLIC, anon, authenticated;--> statement-breakpoint

-- The page's own questionnaire link, still working: whom for, and each questionnaire it still has
-- to fill (those not answered on this link yet).
CREATE FUNCTION internal.questionnaires_due()
RETURNS TABLE (
  patient_id uuid, episode_id uuid, centre_id uuid,
  key text, name text, kb_version_id uuid, definition jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT l.patient_id, e.id, e.centre_id, q.key, q.name, q.kb_version_id, q.definition
  FROM public.patient_link l
  JOIN public.episode e ON e.id = l.episode_id AND e.patient_id = l.patient_id
  CROSS JOIN LATERAL internal.questionnaires_for(e.id) q
  WHERE l.id = (SELECT internal.jwt_patient_link_id())
    AND l.purpose = 'questionnaire'
    AND l.completed_at IS NULL AND l.revoked_at IS NULL AND l.expires_at > now()
    AND NOT EXISTS (
      SELECT 1 FROM public.questionnaire_result r
      WHERE r.patient_link_id = l.id AND r.instrument_key = q.key
    )
  ORDER BY q.sort
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.questionnaires_due() FROM PUBLIC, anon, authenticated;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.questionnaires_due() TO clinic_patient;--> statement-breakpoint

-- The patient writes each due questionnaire once on their link, now, against the knowledge base
-- version and instrument version due now (our server refuses a send shown from another).
CREATE POLICY questionnaire_result_patient ON public.questionnaire_result FOR INSERT
  TO clinic_patient
  WITH CHECK (
    patient_link_id = (SELECT internal.jwt_patient_link_id())
    AND submitted_at = now()
    AND EXISTS (
      SELECT 1 FROM internal.questionnaires_due() d
      WHERE d.key = questionnaire_result.instrument_key
        AND d.kb_version_id = questionnaire_result.kb_version_id
        AND d.definition ->> 'version' = questionnaire_result.instrument_version
        AND d.patient_id = questionnaire_result.patient_id
        AND d.episode_id = questionnaire_result.episode_id
        AND d.centre_id = questionnaire_result.centre_id
    )
  );--> statement-breakpoint

-- Clinicians read them as they read signed records (any centre); nobody signed in writes one.
CREATE POLICY questionnaire_result_read ON public.questionnaire_result FOR SELECT
  TO authenticated USING ((SELECT internal.jwt_clinical_reader()));--> statement-breakpoint
CREATE POLICY support_read_only_insert ON public.questionnaire_result AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.questionnaire_result AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.questionnaire_result AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.questionnaire_result FROM authenticated;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON public.questionnaire_result FROM clinic_patient;--> statement-breakpoint
GRANT INSERT ON public.questionnaire_result TO clinic_patient;--> statement-breakpoint

-- Whether a questionnaire link has nothing left to fill. SECURITY DEFINER so the patient_link
-- policy below does not need the patient to read results.
CREATE FUNCTION internal.questionnaires_done(link_id uuid) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
      SELECT 1 FROM public.questionnaire_result r WHERE r.patient_link_id = link_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.patient_link l
      CROSS JOIN LATERAL internal.questionnaires_for(l.episode_id) q
      WHERE l.id = link_id
        AND NOT EXISTS (
          SELECT 1 FROM public.questionnaire_result r
          WHERE r.patient_link_id = l.id AND r.instrument_key = q.key
        )
    )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.questionnaires_done(uuid) FROM PUBLIC, anon, authenticated;--> statement-breakpoint
-- The desk too: a link with everything filled is never shown again as the QR.
GRANT EXECUTE ON FUNCTION internal.questionnaires_done(uuid) TO clinic_patient, authenticated;--> statement-breakpoint

-- The page's own questionnaire link, still working, completes once every questionnaire is in.
CREATE POLICY patient_link_patient_complete_questionnaire ON public.patient_link FOR UPDATE
  TO clinic_patient
  USING (
    id = (SELECT internal.jwt_patient_link_id())
    AND purpose = 'questionnaire'
    AND completed_at IS NULL
    AND revoked_at IS NULL
    AND expires_at > now()
  )
  WITH CHECK (
    id = (SELECT internal.jwt_patient_link_id())
    AND completed_at = now()
    AND (SELECT internal.questionnaires_done(id))
  );--> statement-breakpoint

-- Until WhatsApp sends them (WA-06), the desk shows the questionnaire link as a QR on the plan and
-- payment sheet: whom for, how many questionnaires the plan names, and how many can be filled now;
-- for those who check in at the episode's centre.
CREATE FUNCTION internal.questionnaire_target(p_episode_id uuid)
RETURNS TABLE (patient_id uuid, assigned integer, fillable integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT e.patient_id,
    coalesce((
      SELECT cardinality(p.questionnaires) FROM public.plan_of_care p
      WHERE p.episode_id = e.id ORDER BY p.version DESC LIMIT 1
    ), 0),
    (SELECT count(*)::int FROM internal.questionnaires_for(e.id))
  FROM public.episode e
  WHERE e.id = p_episode_id
    AND e.status IN ('plan_proposed', 'active', 'on_hold', 'under_review')
    AND coalesce((SELECT internal.jwt_checks_in()), false)
    AND internal.jwt_sees_centre(e.centre_id)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.questionnaire_target(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.questionnaire_target(uuid) TO authenticated;--> statement-breakpoint

-- Those who check patients in read and issue questionnaire links for open episodes at their
-- centres, for the episode's own patient, while the plan has a questionnaire to fill.
CREATE POLICY patient_link_questionnaire_read ON public.patient_link FOR SELECT TO authenticated
  USING (
    (SELECT internal.jwt_checks_in())
    AND purpose = 'questionnaire'
    AND EXISTS (SELECT 1 FROM public.episode e
      WHERE e.id = episode_id AND e.patient_id = patient_link.patient_id
        AND internal.jwt_sees_centre(e.centre_id))
  );--> statement-breakpoint
CREATE POLICY patient_link_questionnaire_issue ON public.patient_link FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT internal.jwt_checks_in())
    AND purpose = 'questionnaire'
    AND EXISTS (SELECT 1 FROM public.episode e
      WHERE e.id = episode_id AND e.patient_id = patient_link.patient_id
        AND internal.jwt_sees_centre(e.centre_id))
    AND (SELECT t.fillable FROM internal.questionnaire_target(episode_id) t) > 0
  );
--> statement-breakpoint

-- How many questionnaires the page's own link has filled, for "Questionnaire 2 of 3".
CREATE FUNCTION internal.questionnaires_answered() RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT count(*)::int FROM public.questionnaire_result r
  WHERE r.patient_link_id = (SELECT internal.jwt_patient_link_id())
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.questionnaires_answered() FROM PUBLIC, anon, authenticated;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.questionnaires_answered() TO clinic_patient;

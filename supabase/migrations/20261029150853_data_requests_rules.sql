-- ADM-03: data requests (PRD M16 "data export and deletion requests"; TAD section 5, DPDP Act 2023:
-- "data export and deletion requests handled by the Super Admin (deletion may mean anonymising
-- where clinical retention applies)"). The Super Admin records a patient's export, correction or
-- deletion request; it is due a set number of days after it was received; it is closed once, done
-- or declined, with what was done, and never changes after. A patient's data is exported only for
-- their open export request, from a reviewed list of tables, and each export is audited on the
-- request. Deletion waits for the clinic's retention period (DECISION #20). Recommended defaults
-- chosen under the user's standing approval, 29 October 2026 (DECISION ADM-03;
-- docs/runbooks/data-requests.md).

CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.data_request
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint

-- What every write keeps: a request starts open, with no outcome, recorded by the signed in
-- person; while open it is only closed, by the signed in person, now, as done or declined; once
-- closed it never changes; none is removed or emptied.
CREATE FUNCTION internal.data_request_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'Data requests are kept' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'open' THEN
      RAISE EXCEPTION 'A data request starts open' USING ERRCODE = 'check_violation';
    END IF;
    IF internal.jwt_staff_id() IS NOT NULL THEN
      NEW.recorded_by := internal.jwt_staff_id();
    END IF;
    NEW.outcome := NULL;
    NEW.closed_by := NULL;
    NEW.closed_at := NULL;
    NEW.created_at := now();
    RETURN NEW;
  END IF;
  IF OLD.status <> 'open' THEN
    RAISE EXCEPTION 'A closed data request never changes' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'open'
    OR (NEW.id, NEW.patient_id, NEW.kind, NEW.received_on, NEW.due_on, NEW.details,
        NEW.recorded_by, NEW.created_at)
      IS DISTINCT FROM (OLD.id, OLD.patient_id, OLD.kind, OLD.received_on, OLD.due_on,
        OLD.details, OLD.recorded_by, OLD.created_at)
  THEN
    RAISE EXCEPTION 'An open data request is only closed' USING ERRCODE = 'check_violation';
  END IF;
  IF internal.jwt_staff_id() IS NOT NULL THEN
    NEW.closed_by := internal.jwt_staff_id();
  END IF;
  NEW.closed_at := now();
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER data_request_guard BEFORE INSERT OR UPDATE OR DELETE ON public.data_request
  FOR EACH ROW EXECUTE FUNCTION internal.data_request_guard();--> statement-breakpoint
CREATE TRIGGER data_request_no_truncate BEFORE TRUNCATE ON public.data_request
  FOR EACH STATEMENT EXECUTE FUNCTION internal.data_request_guard();--> statement-breakpoint

-- Only the Super Admin (data_requests.manage), never a Velyx support login, reads, records and
-- closes them. Nobody removes or empties one.
CREATE POLICY data_request_read ON public.data_request FOR SELECT TO authenticated
  USING ((SELECT internal.jwt_staff_role()) = 'super_admin' AND NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY data_request_insert ON public.data_request FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT internal.jwt_staff_role()) = 'super_admin' AND NOT (SELECT internal.jwt_support())
  );--> statement-breakpoint
CREATE POLICY data_request_update ON public.data_request FOR UPDATE TO authenticated
  USING ((SELECT internal.jwt_staff_role()) = 'super_admin' AND NOT (SELECT internal.jwt_support()))
  WITH CHECK (
    (SELECT internal.jwt_staff_role()) = 'super_admin' AND NOT (SELECT internal.jwt_support())
  );--> statement-breakpoint
CREATE POLICY support_read_only_insert ON public.data_request AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.data_request AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.data_request AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
REVOKE ALL ON public.data_request FROM anon;--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON public.data_request FROM authenticated;--> statement-breakpoint

-- The tables a patient's copy is made from, each reviewed, with the columns left out of it. A
-- database test fails when a table points at a patient and is neither here nor deliberately left
-- out, so nothing new reaches a patient unreviewed. Left out of every copy: other patients' cases
-- the AI sheet was shown (AI-05 similar confirmed cases, in the sheet and in the run's input) and
-- the AI provider's costs and counts. Staff work items (tasks, notifications) and the audit trail
-- are the clinic's records and are not listed.
CREATE FUNCTION internal.patient_export_tables() RETURNS TABLE (name text, hidden text[])
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  VALUES
    ('addendum', ARRAY[]::text[]),
    ('ai_preparation_sheet', ARRAY['similar']),
    ('ai_run', ARRAY['input', 'input_hash', 'cost_micro_usd', 'tokens_in', 'tokens_out']),
    ('ai_suggestion', ARRAY[]::text[]),
    ('appointment', ARRAY[]::text[]),
    ('baseline_measure', ARRAY[]::text[]),
    ('bill', ARRAY[]::text[]),
    ('bill_line', ARRAY[]::text[]),
    ('booking_counter', ARRAY[]::text[]),
    ('clearance', ARRAY[]::text[]),
    ('confirmed_diagnosis', ARRAY[]::text[]),
    ('consent_record', ARRAY[]::text[]),
    ('consultation', ARRAY[]::text[]),
    ('data_request', ARRAY[]::text[]),
    ('diagnosis', ARRAY[]::text[]),
    ('document', ARRAY[]::text[]),
    ('episode', ARRAY[]::text[]),
    ('exercise_tick', ARRAY[]::text[]),
    ('feedback', ARRAY[]::text[]),
    ('final_test', ARRAY[]::text[]),
    ('follow_up_schedule', ARRAY[]::text[]),
    ('guardian', ARRAY[]::text[]),
    ('intake_response', ARRAY[]::text[]),
    ('measure', ARRAY[]::text[]),
    ('opening_entry', ARRAY[]::text[]),
    ('package', ARRAY[]::text[]),
    ('patient_link', ARRAY[]::text[]),
    ('patient_report', ARRAY[]::text[]),
    ('payment', ARRAY[]::text[]),
    ('phase_mark', ARRAY[]::text[]),
    ('phase_move', ARRAY[]::text[]),
    ('plan_booking', ARRAY[]::text[]),
    ('plan_choice', ARRAY[]::text[]),
    ('plan_modality', ARRAY[]::text[]),
    ('plan_of_care', ARRAY[]::text[]),
    ('precaution', ARRAY[]::text[]),
    ('questionnaire_result', ARRAY[]::text[]),
    ('readiness_mark', ARRAY[]::text[]),
    ('readiness_recording', ARRAY[]::text[]),
    ('reassessment', ARRAY[]::text[]),
    ('red_flag_alert', ARRAY[]::text[]),
    ('refund_credit', ARRAY[]::text[]),
    ('session', ARRAY[]::text[]),
    ('special_test_result', ARRAY[]::text[])
$$;--> statement-breakpoint

-- Everything held about the patient of an open export request: their row, then every row of the
-- listed tables that points at them, at one of their episodes, appointments, consultations,
-- sessions, plans of care, bills, AI sheets or patient links, less the hidden columns. Uploaded
-- files are listed, not attached. Each export is audited as `export` on the request.
CREATE FUNCTION internal.patient_export(of_request uuid) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  of_patient uuid;
  episodes uuid[];
  appointments uuid[];
  consultations uuid[];
  sessions uuid[];
  plans uuid[];
  bills uuid[];
  sheets uuid[];
  links uuid[];
  t record;
  found jsonb;
  records jsonb := '{}'::jsonb;
  conditions text[];
BEGIN
  IF internal.jwt_support() OR internal.jwt_staff_role() IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'Only the Super Admin exports a patient''s data'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT r.patient_id INTO of_patient FROM public.data_request r
  WHERE r.id = of_request AND r.kind = 'export' AND r.status = 'open';
  IF of_patient IS NULL THEN
    RAISE EXCEPTION 'A patient''s data is exported only for their open export request'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT coalesce(array_agg(e.id), '{}') INTO episodes FROM public.episode e
  WHERE e.patient_id = of_patient;
  SELECT coalesce(array_agg(a.id), '{}') INTO appointments FROM public.appointment a
  WHERE a.patient_id = of_patient;
  SELECT coalesce(array_agg(c.id), '{}') INTO consultations FROM public.consultation c
  WHERE c.episode_id = ANY (episodes) OR c.appointment_id = ANY (appointments);
  SELECT coalesce(array_agg(s.id), '{}') INTO sessions FROM public.session s
  WHERE s.patient_id = of_patient;
  SELECT coalesce(array_agg(p.id), '{}') INTO plans FROM public.plan_of_care p
  WHERE p.episode_id = ANY (episodes);
  SELECT coalesce(array_agg(b.id), '{}') INTO bills FROM public.bill b
  WHERE b.patient_id = of_patient;
  SELECT coalesce(array_agg(h.id), '{}') INTO sheets FROM public.ai_preparation_sheet h
  WHERE h.episode_id = ANY (episodes);
  SELECT coalesce(array_agg(l.id), '{}') INTO links FROM public.patient_link l
  WHERE l.patient_id = of_patient;

  FOR t IN SELECT x.name, x.hidden FROM internal.patient_export_tables() x ORDER BY x.name LOOP
    SELECT array_agg(format(
      CASE c.column_name
        WHEN 'patient_id' THEN 'x.%I = $1'
        WHEN 'episode_id' THEN 'x.%I = ANY ($2)'
        WHEN 'appointment_id' THEN 'x.%I = ANY ($3)'
        WHEN 'consultation_id' THEN 'x.%I = ANY ($4)'
        WHEN 'session_id' THEN 'x.%I = ANY ($5)'
        WHEN 'plan_of_care_id' THEN 'x.%I = ANY ($6)'
        WHEN 'bill_id' THEN 'x.%I = ANY ($7)'
        WHEN 'sheet_id' THEN 'x.%I = ANY ($8)'
        ELSE 'x.%I = ANY ($9)'
      END, c.column_name))
    INTO conditions
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = t.name
      AND c.column_name IN ('patient_id', 'episode_id', 'appointment_id', 'consultation_id',
        'session_id', 'plan_of_care_id', 'bill_id', 'sheet_id', 'patient_link_id');
    IF conditions IS NULL THEN
      RAISE EXCEPTION 'The export table % no longer points at a patient', t.name;
    END IF;
    EXECUTE format(
      'SELECT coalesce(jsonb_agg(to_jsonb(x) - $10), ''[]''::jsonb) FROM public.%I x WHERE %s',
      t.name, array_to_string(conditions, ' OR '))
      INTO found
      USING of_patient, episodes, appointments, consultations, sessions, plans, bills, sheets,
        links, t.hidden;
    IF jsonb_array_length(found) > 0 THEN
      records := records || jsonb_build_object(t.name, found);
    END IF;
  END LOOP;

  INSERT INTO public.audit_event (actor, action, entity, entity_id, ip)
  VALUES ('staff:' || internal.jwt_staff_id()::text, 'export', 'data_request', of_request::text,
    nullif(current_setting('audit.ip', true), ''));

  RETURN jsonb_build_object(
    'exported_at', now(),
    'patient', (SELECT to_jsonb(p) FROM public.patient p WHERE p.id = of_patient),
    'records', records
  );
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.patient_export_tables(), internal.patient_export(uuid)
  FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.patient_export(uuid) TO authenticated;--> statement-breakpoint

SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint
INSERT INTO public.setting (key, value, updated_by) VALUES
  -- DECISION ADM-03: the days to answer a data request are the client's lawyer's to confirm
  -- under the DPDP Act and its rules; 30 is a placeholder.
  ('privacy.request_response_days', '30', 'system:migration')
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint
SELECT set_config('audit.actor', '', false);

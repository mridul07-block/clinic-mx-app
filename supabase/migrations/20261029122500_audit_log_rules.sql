ALTER TABLE "audit_event" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "audit_event" ADD COLUMN "centre_id" uuid;--> statement-breakpoint
CREATE INDEX "audit_event_category_idx" ON "audit_event" USING btree ("category","id");--> statement-breakpoint
CREATE INDEX "audit_event_centre_idx" ON "audit_event" USING btree ("centre_id","id");--> statement-breakpoint

-- ADM-01: the audit log viewer (PRD M16, section 2: "Audit log | Full | Clinical audit, own centres |
-- No | No | Finance audit"). Recommended defaults chosen under the user's standing approval, 29
-- October 2026 (DECISION ADM-01; docs/runbooks/audit.md).

-- Which part of the trail a table's events belong to. `clinical_record`: the clinical record
-- itself, its values read only by clinicians (the Super Admin or the Treats patients tick).
-- `clinical`: the patient's care around it. `finance`: anything holding money. `admin`: setup
-- (staff, access, settings, the knowledge base), the Super Admin's alone. The same lists as
-- packages/schemas/src/audit-log.ts, which a database test checks against every audited table.
CREATE OR REPLACE FUNCTION internal.audit_category(entity text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT CASE
    WHEN entity IN ('consultation', 'session', 'measure', 'baseline_measure', 'special_test_result',
      'reassessment', 'final_test', 'clearance', 'phase_mark', 'phase_move', 'readiness_mark',
      'readiness_recording', 'diagnosis', 'plan_of_care', 'plan_modality', 'addendum',
      'confirmed_diagnosis', 'precaution', 'intake_response', 'document', 'patient_report',
      'exercise_tick', 'questionnaire_result', 'ai_run', 'ai_preparation_sheet', 'ai_suggestion')
      THEN 'clinical_record'
    WHEN entity IN ('patient', 'guardian', 'episode', 'appointment', 'plan_booking',
      'booking_counter', 'consent_record', 'red_flag_alert', 'task', 'patient_link', 'feedback',
      'follow_up_schedule')
      THEN 'clinical'
    WHEN entity IN ('bill', 'bill_line', 'payment', 'refund_credit', 'package', 'opening_entry',
      'price_item', 'package_type', 'package_type_item', 'discount_preset', 'plan_choice')
      THEN 'finance'
    ELSE 'admin'
  END
$$;--> statement-breakpoint

-- The centre a clinical event is about: the row's own centre, else through the episode,
-- appointment, consultation, plan or AI sheet it points at, else the patient's registering centre.
-- A record view has no row, so the record opened is read. Null when nothing says.
CREATE OR REPLACE FUNCTION internal.audit_centre(entity text, entity_id text, before jsonb, after jsonb)
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  r jsonb := coalesce(after, before);
  found uuid;
BEGIN
  IF internal.audit_category(entity) NOT IN ('clinical', 'clinical_record') THEN
    RETURN NULL;
  END IF;
  IF r IS NULL AND entity_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE t.id = $1', entity)
      INTO r USING entity_id::uuid;
  END IF;
  r := coalesce(r, '{}'::jsonb);
  IF r ->> 'centre_id' IS NOT NULL THEN
    RETURN (r ->> 'centre_id')::uuid;
  END IF;
  IF r ->> 'episode_id' IS NOT NULL THEN
    SELECT e.centre_id INTO found FROM public.episode e WHERE e.id = (r ->> 'episode_id')::uuid;
    IF found IS NOT NULL THEN RETURN found; END IF;
  END IF;
  IF r ->> 'appointment_id' IS NOT NULL THEN
    SELECT a.centre_id INTO found FROM public.appointment a
    WHERE a.id = (r ->> 'appointment_id')::uuid;
    IF found IS NOT NULL THEN RETURN found; END IF;
  END IF;
  IF r ->> 'consultation_id' IS NOT NULL THEN
    SELECT e.centre_id INTO found
    FROM public.consultation c JOIN public.episode e ON e.id = c.episode_id
    WHERE c.id = (r ->> 'consultation_id')::uuid;
    IF found IS NOT NULL THEN RETURN found; END IF;
  END IF;
  IF r ->> 'plan_of_care_id' IS NOT NULL THEN
    SELECT e.centre_id INTO found
    FROM public.plan_of_care p JOIN public.episode e ON e.id = p.episode_id
    WHERE p.id = (r ->> 'plan_of_care_id')::uuid;
    IF found IS NOT NULL THEN RETURN found; END IF;
  END IF;
  IF r ->> 'sheet_id' IS NOT NULL THEN
    SELECT e.centre_id INTO found
    FROM public.ai_preparation_sheet s JOIN public.episode e ON e.id = s.episode_id
    WHERE s.id = (r ->> 'sheet_id')::uuid;
    IF found IS NOT NULL THEN RETURN found; END IF;
  END IF;
  IF r ->> 'registered_centre_id' IS NOT NULL THEN
    RETURN (r ->> 'registered_centre_id')::uuid;
  END IF;
  IF r ->> 'patient_id' IS NOT NULL THEN
    SELECT p.registered_centre_id INTO found FROM public.patient p
    WHERE p.id = (r ->> 'patient_id')::uuid;
    RETURN found;
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint

-- Every event is placed when it is written, so reading the log filters on two columns.
CREATE OR REPLACE FUNCTION internal.audit_place() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  NEW.category := internal.audit_category(NEW.entity);
  NEW.centre_id := internal.audit_centre(NEW.entity, NEW.entity_id, NEW.before, NEW.after);
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER audit_place BEFORE INSERT ON public.audit_event
  FOR EACH ROW EXECUTE FUNCTION internal.audit_place();--> statement-breakpoint

-- The events already written are placed once, here. Only the two new columns are filled; who,
-- what, when and the rows before and after are untouched, and the trail is append only again
-- straight after.
ALTER TABLE public.audit_event DISABLE TRIGGER audit_event_append_only;--> statement-breakpoint
UPDATE public.audit_event
SET category = internal.audit_category(entity),
  centre_id = internal.audit_centre(entity, entity_id, before, after);--> statement-breakpoint
ALTER TABLE public.audit_event ENABLE TRIGGER audit_event_append_only;--> statement-breakpoint

-- Fields a Centre Manager never reads in the log: the free text written at discharge without the
-- Treats patients tick (the clinical tab needs it), and AI spend always.
CREATE OR REPLACE FUNCTION internal.audit_hidden_keys(entity text, clinician boolean) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT CASE
    WHEN entity = 'episode' AND NOT clinician THEN ARRAY['discharge_note', 'discharge_goals',
      'discharge_ongoing_needs', 'discharge_recommendations', 'discharge_return_plan',
      'discharge_flare_plan']
    WHEN entity = 'ai_run' THEN ARRAY['cost_micro_usd']
    ELSE ARRAY[]::text[]
  END
$$;--> statement-breakpoint

-- The audit log as the signed in staff member may read it, newest first, `max_rows` at a time
-- before the event `before_id`. The Super Admin reads everything. A Centre Manager reads the
-- clinical events at their own centres, of tasks only those their inbox shows, and a clinical
-- record's values only with the Treats patients tick (otherwise the fields that changed).
-- Finance reads the finance events. Velyx support and everyone else read nothing. The page is
-- chosen first, on the placed columns, and named after.
CREATE OR REPLACE FUNCTION internal.audit_log(
  part text, of_entity text, from_at timestamptz, to_at timestamptz, before_id bigint, max_rows integer
)
RETURNS TABLE (
  id bigint, at timestamptz, actor text, actor_name text, action public.audit_action, entity text,
  entity_id text, category text, before jsonb, after jsonb, changed text[], redacted boolean,
  hidden_fields text[]
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  reader_role text := internal.jwt_staff_role();
  reader_id text := internal.jwt_staff_id()::text;
  clinician boolean := internal.jwt_clinical_reader();
  manager boolean := coalesce(internal.jwt_staff_role() = 'centre_manager', false);
  readable text[];
  centres uuid[];
BEGIN
  IF internal.jwt_support() OR reader_role IS NULL THEN
    RETURN;
  ELSIF reader_role = 'super_admin' THEN
    readable := NULL;
  ELSIF reader_role = 'finance' THEN
    readable := ARRAY['finance'];
  ELSIF manager THEN
    readable := ARRAY['clinical', 'clinical_record'];
    centres := internal.jwt_centre_ids();
  ELSE
    RETURN;
  END IF;
  RETURN QUERY
  WITH page AS (
    SELECT e.* FROM public.audit_event e
    WHERE (before_id IS NULL OR e.id < before_id)
      AND (from_at IS NULL OR e.at >= from_at)
      AND (to_at IS NULL OR e.at < to_at)
      AND (of_entity IS NULL OR e.entity = of_entity)
      AND (part IS NULL OR e.category = part OR (part = 'clinical' AND e.category = 'clinical_record'))
      AND (readable IS NULL OR e.category = ANY (readable))
      AND (NOT manager OR e.centre_id = ANY (centres))
      AND (NOT manager OR e.entity <> 'task'
        OR coalesce(e.after, e.before) ->> 'assignee_staff_user_id' = reader_id
        OR (coalesce(e.after, e.before) ->> 'assignee_staff_user_id' IS NULL
          AND coalesce(e.after, e.before) ->> 'assignee_role' = 'centre_manager'))
    ORDER BY e.id DESC
    LIMIT least(greatest(max_rows, 1), 200)
  )
  SELECT p.id, p.at, p.actor, s.name, p.action, p.entity, p.entity_id, p.category,
    CASE WHEN h.redacted THEN NULL ELSE p.before - h.keys END,
    CASE WHEN h.redacted THEN NULL ELSE p.after - h.keys END,
    CASE p.action
      WHEN 'update' THEN ARRAY(
        SELECT k FROM jsonb_object_keys(coalesce(p.after, '{}'::jsonb)) k
        WHERE p.before -> k IS DISTINCT FROM p.after -> k ORDER BY k)
      WHEN 'insert' THEN ARRAY(SELECT jsonb_object_keys(coalesce(p.after, '{}'::jsonb)) ORDER BY 1)
      WHEN 'delete' THEN ARRAY(SELECT jsonb_object_keys(coalesce(p.before, '{}'::jsonb)) ORDER BY 1)
      ELSE NULL
    END,
    h.redacted,
    h.keys
  FROM page p
  CROSS JOIN LATERAL (
    SELECT manager AND p.category = 'clinical_record' AND NOT clinician AS redacted,
      CASE WHEN manager THEN internal.audit_hidden_keys(p.entity, clinician)
        ELSE ARRAY[]::text[] END AS keys
  ) h
  LEFT JOIN public.staff_user s
    ON s.id = CASE WHEN p.actor LIKE 'staff:%' THEN substr(p.actor, 7)::uuid END
  ORDER BY p.id DESC;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.audit_category(text), internal.audit_centre(text, text, jsonb, jsonb),
  internal.audit_place(), internal.audit_hidden_keys(text, boolean),
  internal.audit_log(text, text, timestamptz, timestamptz, bigint, integer) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.audit_log(text, text, timestamptz, timestamptz, bigint, integer)
  TO authenticated;--> statement-breakpoint

-- Velyx support never reads the trail, which holds clinical rows; it still reads the support
-- requests logged under grants, which Support access lists (IAM-08).
DROP POLICY audit_event_read ON public.audit_event;--> statement-breakpoint
CREATE POLICY audit_event_read ON public.audit_event FOR SELECT TO authenticated
  USING (
    (SELECT internal.jwt_staff_role()) = 'super_admin'
    AND (NOT (SELECT internal.jwt_support()) OR action = 'support_request')
  );

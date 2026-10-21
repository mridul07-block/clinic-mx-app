-- IAM-09: patient links (TAD sections 3 and 5). Patients never log in; the server checks a link's
-- signed token, then reads for the patient page as the `clinic_patient` role with the link in
-- its claims (withPatientAccess in packages/db), so row level security applies to patients too
-- (rule 10). Policies TO clinic_patient show only what that one link reaches.

-- Links are audited like every table: issued (insert), stopped or submitted (update).
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.patient_link
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint

-- The role patient page reads run as. It cannot log in; the server's own role switches to it
-- inside a transaction (`set local role`).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clinic_patient') THEN
    CREATE ROLE clinic_patient NOLOGIN NOINHERIT;
  END IF;
END;
$$;--> statement-breakpoint
GRANT clinic_patient TO postgres;--> statement-breakpoint
GRANT USAGE ON SCHEMA public, internal TO clinic_patient;--> statement-breakpoint

-- The link the patient page runs under, from the claims withPatientAccess sets, or null.
CREATE OR REPLACE FUNCTION internal.jwt_patient_link_id() RETURNS uuid
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT (nullif(current_setting('request.jwt.claims', true), '')::jsonb
          -> 'patient_link' ->> 'id')::uuid
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.jwt_patient_link_id() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.jwt_patient_link_id() TO clinic_patient;--> statement-breakpoint

-- A patient page reads its own link only. Staff have no policy yet: the tickets that issue links
-- from staff screens add theirs. Nobody changes a link through a policy; the server issues,
-- stops and completes links in audited transactions.
GRANT SELECT ON public.patient_link TO clinic_patient;--> statement-breakpoint
CREATE POLICY patient_link_read_own ON public.patient_link FOR SELECT TO clinic_patient
  USING (id = (SELECT internal.jwt_patient_link_id()));--> statement-breakpoint

-- Velyx support stays read only here too (IAM-08).
CREATE POLICY support_read_only_insert ON public.patient_link AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.patient_link AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.patient_link AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint

-- How long each kind of link works (rule 6; user decision, 22 October 2026).
SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint
INSERT INTO public.setting (key, value, updated_by) VALUES
  ('links.health_form_hours', '2', 'system:migration'),
  ('links.consent_hours', '2', 'system:migration'),
  ('links.questionnaire_days', '7', 'system:migration'),
  ('links.feedback_days', '7', 'system:migration'),
  ('links.my_plan_days', '30', 'system:migration')
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint
SELECT set_config('audit.actor', '', false);

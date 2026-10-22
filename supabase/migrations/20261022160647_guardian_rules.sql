-- SCH-02: guardians of patients under the adult age. Read by every signed in staff member, like
-- the patient they belong to; added, edited and removed (removed_at set) by those who edit patients
-- (patients.edit_contact: Super Admin, Centre Manager, Front Desk). Nobody deletes a guardian:
-- consent records (INT-07) point to the one who signed. Every change is audited.

CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.guardian
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint

CREATE POLICY guardian_read ON public.guardian FOR SELECT TO authenticated
  USING ((SELECT internal.jwt_staff_id()) IS NOT NULL);--> statement-breakpoint
CREATE POLICY guardian_insert ON public.guardian FOR INSERT TO authenticated
  WITH CHECK ((SELECT internal.jwt_edits_patients()));--> statement-breakpoint
CREATE POLICY guardian_update ON public.guardian FOR UPDATE TO authenticated
  USING ((SELECT internal.jwt_edits_patients()))
  WITH CHECK ((SELECT internal.jwt_edits_patients()));--> statement-breakpoint

-- Velyx support stays read only here too (IAM-08).
CREATE POLICY support_read_only_insert ON public.guardian AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.guardian AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.guardian AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint

-- PRD J2.7: patients under 18 need a guardian (a setting, rule 6).
SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint
INSERT INTO public.setting (key, value, updated_by) VALUES
  ('patients.adult_age_years', '18', 'system:migration')
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint
SELECT set_config('audit.actor', '', false);

-- INT-02: the check in drawer. Reports: rows are only ever added, by someone with check in rights
-- as themselves, and read by them; the files are in the private `reports` bucket, which only our
-- server reaches (rule 9). Health form links: someone with check in rights reads and issues the
-- health form link of an appointment they can see; tokens are never stored, and staff still see
-- no other link (IAM-09).
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.patient_report
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint

CREATE POLICY patient_report_read ON public.patient_report FOR SELECT TO authenticated
  USING ((SELECT internal.jwt_checks_in()));--> statement-breakpoint
CREATE POLICY patient_report_add ON public.patient_report FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT internal.jwt_checks_in())
    AND uploaded_by = (SELECT internal.jwt_staff_id())
  );--> statement-breakpoint
CREATE POLICY support_read_only_insert ON public.patient_report AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.patient_report AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.patient_report AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint

CREATE POLICY patient_link_checkin_read ON public.patient_link FOR SELECT TO authenticated
  USING (
    (SELECT internal.jwt_checks_in())
    AND purpose = 'health_form'
    AND EXISTS (SELECT 1 FROM public.appointment a WHERE a.id = appointment_id)
  );--> statement-breakpoint
CREATE POLICY patient_link_checkin_issue ON public.patient_link FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT internal.jwt_checks_in())
    AND purpose = 'health_form'
    AND EXISTS (SELECT 1 FROM public.appointment a WHERE a.id = appointment_id)
  );--> statement-breakpoint

-- The private bucket for report photos and scans (TAD section 9), at most the hosted request
-- limit; the setting below can only lower it.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('reports', 'reports', false, 4194304, ARRAY['image/jpeg', 'image/png', 'application/pdf'])
ON CONFLICT (id) DO NOTHING;--> statement-breakpoint

SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint
INSERT INTO public.setting (key, value, updated_by) VALUES
  ('reports.max_file_mb', '4', 'system:migration')
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint
SELECT set_config('audit.actor', '', false);

-- ALT-08: report photos and scans are opened by clinicians only: the Super Admin, and staff with
-- the Treats patients tick (the `clinical.read` permission), at any centre (user decision, 23
-- October 2026: patient records are not bound to a centre). Clinicians read the rows to list them;
-- the front desk (and anyone who checks in) keeps reading them to show what was added. Where the
-- file is, no staff member reads from the table: only `internal.report_file`, for clinicians,
-- gives it to our server, which alone reaches the private bucket. Velyx support reads none.
CREATE POLICY patient_report_clinical_read ON public.patient_report FOR SELECT TO authenticated
  USING (
    ((SELECT internal.jwt_staff_role()) = 'super_admin' OR (SELECT internal.jwt_treats()))
    AND NOT (SELECT internal.jwt_support())
  );--> statement-breakpoint

REVOKE SELECT ON public.patient_report FROM authenticated;--> statement-breakpoint
GRANT SELECT (id, patient_id, appointment_id, content_type, size_bytes, uploaded_by, patient_link_id, created_at)
  ON public.patient_report TO authenticated;--> statement-breakpoint

-- The file of a report, for a clinician only; nothing for anyone else, or for a missing report.
CREATE OR REPLACE FUNCTION internal.report_file(report_id uuid)
RETURNS TABLE (file_path text, content_type text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT r.file_path, r.content_type
  FROM public.patient_report r
  WHERE r.id = report_file.report_id
    AND (internal.jwt_staff_role() = 'super_admin' OR internal.jwt_treats())
    AND NOT internal.jwt_support()
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.report_file(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.report_file(uuid) TO authenticated;

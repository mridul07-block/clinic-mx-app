-- INT-06: Part A consent. A patient page (as `clinic_patient`, with the link in its claims) adds
-- its own Part A decisions for its health form link's visit, signed by the patient, only while
-- the visit is on (Checked in or In consultation), and reads them back; the guardian signs with
-- INT-07. Those with check in rights read the decisions of appointments they can see, so
-- reception sees a decline. Records are only ever added; nobody changes or deletes one. Every
-- record is audited. Drawn signatures go to the private `signatures` bucket, which only our server
-- reaches (rule 9).
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.consent_record
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint

GRANT SELECT, INSERT ON public.consent_record TO clinic_patient;--> statement-breakpoint

CREATE POLICY consent_record_patient_read ON public.consent_record FOR SELECT TO clinic_patient
  USING (
    patient_link_id = (SELECT internal.jwt_patient_link_id())
  );--> statement-breakpoint
CREATE POLICY consent_record_patient_add ON public.consent_record FOR INSERT TO clinic_patient
  WITH CHECK (
    (appointment_id, patient_id, patient_link_id) = (
      SELECT l.appointment_id, l.patient_id, l.id FROM public.patient_link l
      WHERE l.id = (SELECT internal.jwt_patient_link_id()) AND l.purpose = 'health_form'
    )
    AND stage = 'A'
    AND signer = 'patient'
    AND episode_id IS NULL
    AND modality IS NULL
    AND EXISTS (
      SELECT 1 FROM public.appointment a
      WHERE a.id = appointment_id AND a.status IN ('checked_in', 'in_progress')
    )
  );--> statement-breakpoint

CREATE POLICY consent_record_checkin_read ON public.consent_record FOR SELECT TO authenticated
  USING (
    (SELECT internal.jwt_checks_in())
    AND EXISTS (SELECT 1 FROM public.appointment a WHERE a.id = appointment_id)
  );--> statement-breakpoint

-- Velyx support stays read only here too (IAM-08).
CREATE POLICY support_read_only_insert ON public.consent_record AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.consent_record AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.consent_record AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint

-- The drawn signatures: private, PNG only, at most 200 KB (the pad's technical ceiling).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('signatures', 'signatures', false, 200000, ARRAY['image/png'])
ON CONFLICT (id) DO NOTHING;

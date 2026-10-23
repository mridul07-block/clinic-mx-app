-- INT-07: the guardian section. For a patient under the adult age a guardian on file signs Part A
-- (PRD J2.7; user decision, 23 October 2026). A patient page reads its patient's guardians who are
-- not removed (names and relationships, never phones) and the date of birth, so the age decides;
-- a record signed by a guardian names one of those guardians, and a record signed by the patient
-- names none.
GRANT SELECT (id, patient_id, name, relationship, removed_at) ON public.guardian
  TO clinic_patient;--> statement-breakpoint
CREATE POLICY guardian_patient_read ON public.guardian FOR SELECT TO clinic_patient
  USING (
    removed_at IS NULL
    AND patient_id = (SELECT patient_id FROM public.patient_link
                      WHERE id = (SELECT internal.jwt_patient_link_id()))
  );--> statement-breakpoint
GRANT SELECT (date_of_birth) ON public.patient TO clinic_patient;--> statement-breakpoint

DROP POLICY consent_record_patient_add ON public.consent_record;--> statement-breakpoint
CREATE POLICY consent_record_patient_add ON public.consent_record FOR INSERT TO clinic_patient
  WITH CHECK (
    (appointment_id, patient_id, patient_link_id) = (
      SELECT l.appointment_id, l.patient_id, l.id FROM public.patient_link l
      WHERE l.id = (SELECT internal.jwt_patient_link_id()) AND l.purpose = 'health_form'
    )
    AND stage = 'A'
    AND (
      (signer = 'patient' AND guardian_id IS NULL)
      OR (signer = 'guardian' AND guardian_id IN (SELECT g.id FROM public.guardian g))
    )
    AND episode_id IS NULL
    AND modality IS NULL
    AND EXISTS (
      SELECT 1 FROM public.appointment a
      WHERE a.id = appointment_id AND a.status IN ('checked_in', 'in_progress')
    )
  );

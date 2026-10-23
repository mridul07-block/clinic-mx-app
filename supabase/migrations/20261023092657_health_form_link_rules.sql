-- INT-03: the health form link opens the form for its own appointment only. A patient page reads
-- as `clinic_patient` with the link in its claims (IAM-09); these policies show it that one
-- appointment, the patient's name, the centre and the physio, and nothing else. Column grants
-- keep everything else on those rows (phone, date of birth, notes) out of reach. Patients still
-- change nothing through a policy: the form tickets add their own writes.

-- The appointment the link is tied to (a health form link always has one).
GRANT SELECT (id, patient_id, centre_id, physio_id, starts_at, status) ON public.appointment
  TO clinic_patient;--> statement-breakpoint
CREATE POLICY appointment_patient_read ON public.appointment FOR SELECT TO clinic_patient
  USING (id = (SELECT appointment_id FROM public.patient_link
               WHERE id = (SELECT internal.jwt_patient_link_id())));--> statement-breakpoint

-- The patient's name, for "Hello <first name>" (user decision, 23 October 2026).
GRANT SELECT (id, name) ON public.patient TO clinic_patient;--> statement-breakpoint
CREATE POLICY patient_patient_read ON public.patient FOR SELECT TO clinic_patient
  USING (id = (SELECT patient_id FROM public.patient_link
               WHERE id = (SELECT internal.jwt_patient_link_id())));--> statement-breakpoint

-- The centre and the physio of that appointment, by name. The appointment read runs under the
-- policy above, so another appointment's centre or physio is never reached.
GRANT SELECT (id, name) ON public.centre TO clinic_patient;--> statement-breakpoint
CREATE POLICY centre_patient_read ON public.centre FOR SELECT TO clinic_patient
  USING (id IN (SELECT centre_id FROM public.appointment));--> statement-breakpoint
GRANT SELECT (id, name) ON public.staff_user TO clinic_patient;--> statement-breakpoint
CREATE POLICY staff_user_patient_read ON public.staff_user FOR SELECT TO clinic_patient
  USING (id IN (SELECT physio_id FROM public.appointment));

-- PAT-04: feedback after the consultation (PRD J4.1, M14; TAD `feedback`). Recommended defaults
-- chosen under the user's standing approval, 28 October 2026 (docs/runbooks/feedback.md). The
-- patient answers through a feedback link tied to the consultation's visit; the row keeps the
-- consultation's centre and the physio who held it, and is never changed (rule 5).

CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.feedback
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint

-- Velyx support stays read only here too (IAM-08); staff never write feedback.
CREATE POLICY support_read_only_insert ON public.feedback AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.feedback AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.feedback AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.feedback FROM authenticated;--> statement-breakpoint

-- Who reads the answers: the Super Admin and Centre Managers, at their centres (the Centre
-- Manager's Feedback screen, DSH-03). Not the desk, Finance or the physio it names.
CREATE POLICY feedback_manager_read ON public.feedback FOR SELECT TO authenticated
  USING (
    coalesce((SELECT internal.jwt_staff_role()) IN ('super_admin', 'centre_manager'), false)
    AND internal.jwt_sees_centre(centre_id)
  );--> statement-breakpoint

-- What the page's feedback link answers for: its own visit's signed consultation, while the link
-- works and the consultation is unanswered (by this link or any other). SECURITY DEFINER: the
-- patient reads no consultation itself.
CREATE OR REPLACE FUNCTION internal.feedback_subject()
RETURNS TABLE (
  patient_id uuid, episode_id uuid, appointment_id uuid, consultation_id uuid, centre_id uuid,
  physio_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT l.patient_id, c.episode_id, a.id, c.id, a.centre_id, c.physio_id
  FROM public.patient_link l
  JOIN public.appointment a ON a.id = l.appointment_id AND a.patient_id = l.patient_id
  JOIN public.consultation c ON c.appointment_id = a.id AND c.status = 'signed'
  WHERE l.id = internal.jwt_patient_link_id()
    AND l.purpose = 'feedback'
    AND l.revoked_at IS NULL AND l.completed_at IS NULL AND l.expires_at > now()
    AND NOT EXISTS (SELECT 1 FROM public.feedback f WHERE f.consultation_id = c.id)
  LIMIT 1
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.feedback_subject() FROM PUBLIC, anon, authenticated;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.feedback_subject() TO clinic_patient;--> statement-breakpoint

-- The patient writes their answers once, for exactly that subject, now; they read none back.
GRANT INSERT ON public.feedback TO clinic_patient;--> statement-breakpoint
CREATE POLICY feedback_patient_answer ON public.feedback FOR INSERT TO clinic_patient
  WITH CHECK (
    patient_link_id = (SELECT internal.jwt_patient_link_id())
    AND survey_key = 'post_consultation'
    AND submitted_at = now()
    AND (patient_id, episode_id, appointment_id, consultation_id, centre_id, physio_id) = (
      SELECT s.patient_id, s.episode_id, s.appointment_id, s.consultation_id, s.centre_id,
        s.physio_id
      FROM internal.feedback_subject() s
    )
  );--> statement-breakpoint

-- Whether a link's feedback is in. SECURITY DEFINER so the patient_link policy below does not
-- need the patient to read feedback.
CREATE OR REPLACE FUNCTION internal.feedback_submitted(link_id uuid) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.feedback f WHERE f.patient_link_id = feedback_submitted.link_id
  )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.feedback_submitted(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.feedback_submitted(uuid) TO clinic_patient;--> statement-breakpoint

-- The page's own feedback link, still working, completes once its answers are in.
CREATE POLICY patient_link_patient_complete_feedback ON public.patient_link FOR UPDATE
  TO clinic_patient
  USING (
    id = (SELECT internal.jwt_patient_link_id())
    AND purpose = 'feedback'
    AND completed_at IS NULL
    AND revoked_at IS NULL
    AND expires_at > now()
  )
  WITH CHECK (
    id = (SELECT internal.jwt_patient_link_id())
    AND completed_at = now()
    AND (SELECT internal.feedback_submitted(id))
  );--> statement-breakpoint

-- Until WhatsApp sends "Rate your visit" (ALT-06, WA-06), the desk shows it as a QR on the plan
-- and payment sheet. What for: the episode's newest signed consultation, its visit and patient,
-- and whether its feedback is in; for those who check in at the episode's centre. The desk reads
-- no consultation itself.
CREATE OR REPLACE FUNCTION internal.feedback_target(p_episode_id uuid)
RETURNS TABLE (appointment_id uuid, patient_id uuid, received boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT a.id, a.patient_id,
    EXISTS (SELECT 1 FROM public.feedback f WHERE f.consultation_id = c.id)
  FROM public.consultation c
  JOIN public.appointment a ON a.id = c.appointment_id
  JOIN public.episode e ON e.id = c.episode_id
  WHERE c.episode_id = p_episode_id AND c.status = 'signed'
    AND coalesce((SELECT internal.jwt_checks_in()), false)
    AND internal.jwt_sees_centre(e.centre_id)
  ORDER BY c.signed_at DESC, c.id
  LIMIT 1
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.feedback_target(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.feedback_target(uuid) TO authenticated;--> statement-breakpoint

-- Whether a visit's consultation is signed and still unanswered: a feedback link is issued only
-- then.
CREATE OR REPLACE FUNCTION internal.feedback_open_for(p_appointment_id uuid) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.consultation c
    WHERE c.appointment_id = p_appointment_id AND c.status = 'signed'
      AND NOT EXISTS (SELECT 1 FROM public.feedback f WHERE f.consultation_id = c.id)
  )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.feedback_open_for(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.feedback_open_for(uuid) TO authenticated;--> statement-breakpoint

-- Those who check patients in read and issue feedback links for visits at their centres, for the
-- visit's own patient, once its consultation is signed.
CREATE POLICY patient_link_feedback_read ON public.patient_link FOR SELECT TO authenticated
  USING (
    (SELECT internal.jwt_checks_in())
    AND purpose = 'feedback'
    AND EXISTS (SELECT 1 FROM public.appointment a
      WHERE a.id = appointment_id AND a.patient_id = patient_link.patient_id
        AND internal.jwt_sees_centre(a.centre_id))
  );--> statement-breakpoint
CREATE POLICY patient_link_feedback_issue ON public.patient_link FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT internal.jwt_checks_in())
    AND purpose = 'feedback'
    AND EXISTS (SELECT 1 FROM public.appointment a
      WHERE a.id = appointment_id AND a.patient_id = patient_link.patient_id
        AND internal.jwt_sees_centre(a.centre_id))
    AND (SELECT internal.feedback_open_for(appointment_id))
  );

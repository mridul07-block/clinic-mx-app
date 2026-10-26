-- SES-03 follow up: a signed session note is part of the patient's record wherever it was made, as
-- a signed consultation is (CLN-12, user decision 24 October 2026): clinicians (the Super Admin and
-- staff with the Treats patients tick, never Velyx support) read it at any centre. A draft keeps its
-- own rule: its physio, and clinicians who see the centre.
DROP POLICY session_read ON public.session;--> statement-breakpoint
CREATE POLICY session_read ON public.session FOR SELECT TO authenticated
  USING (
    session.physio_id = (SELECT internal.jwt_staff_id())
    OR ((SELECT internal.jwt_treats()) AND internal.jwt_sees_centre(session.centre_id))
    OR (session.status = 'signed' AND (SELECT internal.jwt_clinical_reader()))
  );

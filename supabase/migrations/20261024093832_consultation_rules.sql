-- CLN-02: the consultation. Its own consultant (the appointment's physio, with the Consultant
-- tick) opens it on their checked in or started visit, on the episode the health form opened,
-- and edits it while it is a draft. Clinical staff at the episode's centre read it (CLN-12 shows
-- it). Who, where and which knowledge base version never change once opened; a signed
-- consultation never changes at all (changes are addenda, rule 5; CLN-09 signs). Nobody deletes.
-- Every change is audited.
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.consultation
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.consultation_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  editable text[] := ARRAY['sections', 'version', 'updated_at'];
BEGIN
  IF OLD.status = 'signed' THEN
    RAISE EXCEPTION 'A signed consultation never changes; changes are addenda'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (to_jsonb(NEW) - editable) IS DISTINCT FROM (to_jsonb(OLD) - editable) THEN
    RAISE EXCEPTION 'Only the sections of a consultation change while it is a draft'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.consultation_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER consultation_guard BEFORE UPDATE ON public.consultation
  FOR EACH ROW EXECUTE FUNCTION internal.consultation_guard();--> statement-breakpoint

CREATE POLICY consultation_read ON public.consultation FOR SELECT TO authenticated
  USING (
    consultation.physio_id = (SELECT internal.jwt_staff_id())
    OR (
      (SELECT internal.jwt_treats())
      AND EXISTS (
        SELECT 1 FROM public.episode e
        WHERE e.id = consultation.episode_id AND internal.jwt_sees_centre(e.centre_id)
      )
    )
  );--> statement-breakpoint
CREATE POLICY consultation_open ON public.consultation FOR INSERT TO authenticated
  WITH CHECK (
    consultation.physio_id = (SELECT internal.jwt_staff_id())
    AND (SELECT internal.jwt_consultant())
    AND consultation.status = 'draft'
    AND EXISTS (
      SELECT 1 FROM public.appointment a
      WHERE a.id = consultation.appointment_id
        AND a.physio_id = consultation.physio_id
        AND a.episode_id = consultation.episode_id
        AND a.status IN ('checked_in', 'in_progress')
    )
  );--> statement-breakpoint
CREATE POLICY consultation_save ON public.consultation FOR UPDATE TO authenticated
  USING (
    consultation.physio_id = (SELECT internal.jwt_staff_id())
    AND (SELECT internal.jwt_consultant())
    AND consultation.status = 'draft'
  )
  WITH CHECK (
    consultation.physio_id = (SELECT internal.jwt_staff_id())
    AND (SELECT internal.jwt_consultant())
    AND consultation.status = 'draft'
  );--> statement-breakpoint

-- Velyx support stays read only here too (IAM-08).
CREATE POLICY support_read_only_insert ON public.consultation AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.consultation AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.consultation AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));

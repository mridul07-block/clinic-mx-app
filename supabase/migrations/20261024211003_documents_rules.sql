-- ALT-05: generated documents. Clinical documents (the consultation summary, the referral letter,
-- the discharge report) are read by clinicians, meaning the Super Admin and staff with the Treats
-- patients tick, never Velyx support, at any centre like the signed records they come from
-- (CLN-12). The invoice is read by those who see bill amounts (`bills.view_amounts`): the Super
-- Admin, Finance, and the front desk at its centre. Only the server writes rows, as the system;
-- nobody signed in adds, changes or deletes one. Where the file is, no staff member reads from the
-- table: only `internal.document_file` gives it to our server, which alone reaches the private
-- bucket (rule 9).

-- Whether the signed in person reads a document of this kind at this centre.
CREATE OR REPLACE FUNCTION internal.reads_document(kind public.document_kind, centre_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT CASE
    WHEN reads_document.kind = 'invoice_receipt' THEN
      internal.jwt_staff_role() IN ('super_admin', 'finance')
      OR (internal.jwt_staff_role() = 'front_desk' AND internal.jwt_sees_centre(reads_document.centre_id))
    ELSE internal.jwt_clinical_reader()
  END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.reads_document(public.document_kind, uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.reads_document(public.document_kind, uuid) TO authenticated;--> statement-breakpoint

CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.document
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint

CREATE POLICY document_read ON public.document FOR SELECT TO authenticated
  USING (internal.reads_document(document.kind, document.centre_id));--> statement-breakpoint

-- Velyx support stays read only here too (IAM-08).
CREATE POLICY support_read_only_insert ON public.document AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.document AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.document AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint

REVOKE SELECT ON public.document FROM authenticated;--> statement-breakpoint
GRANT SELECT (id, kind, patient_id, episode_id, centre_id, source_id, version, size_bytes, created_at)
  ON public.document TO authenticated;--> statement-breakpoint

-- A document's file, for those who read it; nothing for anyone else, or for a missing document.
CREATE OR REPLACE FUNCTION internal.document_file(document_id uuid)
RETURNS TABLE (file_path text, kind text, version integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT d.file_path, d.kind::text, d.version
  FROM public.document d
  WHERE d.id = document_file.document_id
    AND internal.reads_document(d.kind, d.centre_id)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.document_file(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.document_file(uuid) TO authenticated;--> statement-breakpoint

-- Someone opening a document (TAD section 5: every view of a clinical record is logged), written
-- with the transaction's own audit actor and address, like internal.record_view, so it cannot be
-- recorded as anyone else. Only someone who reads the document logs a view of it.
CREATE OR REPLACE FUNCTION internal.document_view(document_id uuid) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor text := nullif(current_setting('audit.actor', true), '');
BEGIN
  IF actor IS NULL OR actor IS DISTINCT FROM 'staff:' || internal.jwt_staff_id()::text THEN
    RAISE EXCEPTION 'A document view is logged by the staff member viewing'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.document d
    WHERE d.id = document_view.document_id AND internal.reads_document(d.kind, d.centre_id)
  ) THEN
    RAISE EXCEPTION 'Not a document this person reads' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO public.audit_event (actor, action, entity, entity_id, ip)
  VALUES (actor, 'view', 'document', document_id::text, nullif(current_setting('audit.ip', true), ''));
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.document_view(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.document_view(uuid) TO authenticated;--> statement-breakpoint

-- The private bucket for generated PDFs (TAD section 9). Only our server reaches it, with the
-- service role. A document of a few pages is well under the limit.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('documents', 'documents', false, 10485760, ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;

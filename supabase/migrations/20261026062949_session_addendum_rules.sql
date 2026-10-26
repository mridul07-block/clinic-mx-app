-- Addenda on signed session notes (CLN-12 follow up, user decisions 26 October 2026; TAD
-- `addendum`: consultation or session). Who reads a session note's addenda is who reads the note
-- (`session_read`); who adds one is as for a consultation: the Treats patients tick now, on a
-- signed note, at the episode's centre or on one's own note. Velyx support stays read only (the
-- restrictive policies on addendum stay). A session addendum queues no document.

-- Who reads a session note: its physio, clinicians who see its centre, and, once it is signed,
-- clinicians at any centre (as `session_read`).
CREATE OR REPLACE FUNCTION internal.reads_session(session_id uuid) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.session s
    WHERE s.id = reads_session.session_id
      AND (
        s.physio_id = internal.jwt_staff_id()
        OR (internal.jwt_treats() AND internal.jwt_sees_centre(s.centre_id))
        OR (s.status = 'signed' AND internal.jwt_clinical_reader())
      )
  )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.reads_session(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.reads_session(uuid) TO authenticated;--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.adds_session_addendum(session_id uuid, episode_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT internal.jwt_treats()
    AND internal.staff_treats(internal.jwt_staff_id())
    AND EXISTS (
      SELECT 1 FROM public.session s
      WHERE s.id = adds_session_addendum.session_id
        AND s.episode_id = adds_session_addendum.episode_id
        AND s.status = 'signed'
        AND (s.physio_id = internal.jwt_staff_id() OR internal.jwt_sees_centre(s.centre_id))
    )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.adds_session_addendum(uuid, uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.adds_session_addendum(uuid, uuid) TO authenticated;--> statement-breakpoint

DROP POLICY addendum_read ON public.addendum;--> statement-breakpoint
CREATE POLICY addendum_read ON public.addendum FOR SELECT TO authenticated
  USING (
    (addendum.consultation_id IS NOT NULL AND internal.reads_consultation(addendum.consultation_id))
    OR (addendum.session_id IS NOT NULL AND internal.reads_session(addendum.session_id))
  );--> statement-breakpoint

DROP POLICY addendum_add ON public.addendum;--> statement-breakpoint
CREATE POLICY addendum_add ON public.addendum FOR INSERT TO authenticated
  WITH CHECK (
    addendum.author_id = (SELECT internal.jwt_staff_id())
    AND (
      (addendum.consultation_id IS NOT NULL
        AND internal.adds_addendum(addendum.consultation_id, addendum.episode_id))
      OR (addendum.session_id IS NOT NULL
        AND internal.adds_session_addendum(addendum.session_id, addendum.episode_id))
    )
  );--> statement-breakpoint

-- The consultation summary prints a consultation's addenda (ALT-06); a session's queue nothing.
CREATE OR REPLACE FUNCTION internal.addendum_summary_job() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.consultation_id IS NULL THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.job (kind, payload, idempotency_key)
  VALUES ('documents.consultation_summary',
    jsonb_build_object('consultationId', NEW.consultation_id),
    'consultation_summary:addendum:' || NEW.id)
  ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN NULL;
END;
$$;

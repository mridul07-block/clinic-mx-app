-- SCH-12: a physio books their patient's next session from the session screen (PRD access table:
-- "Own schedule; book a patient's next session"; user decisions, 26 October 2026). The physio who
-- writes a session's note books into their own free times at the visit's centre, in the visit's
-- Active episode, as themselves. The count of the episode's session appointments, which both this
-- and Book plan sessions (SCH-11) cap against, includes appointments with colleagues, which a
-- physio cannot read: it comes from a function that gives counts only.

-- The episode's appointments of the given types: booked and not yet done, and completed. For
-- those who book at the episode's centre and for physios who treat there; nobody else.
CREATE OR REPLACE FUNCTION internal.episode_session_counts(episode_id uuid, type_keys text[])
RETURNS TABLE (booked integer, done integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    count(*) FILTER (WHERE a.status IN ('booked', 'confirmed', 'checked_in', 'in_progress'))::int,
    count(*) FILTER (WHERE a.status = 'completed')::int
  FROM public.episode e
  JOIN public.appointment a ON a.episode_id = e.id
  JOIN public.appointment_type t ON t.id = a.appointment_type_id
  WHERE e.id = episode_session_counts.episode_id
    AND t.key = ANY (episode_session_counts.type_keys)
    AND ((SELECT internal.jwt_edits_patients()) OR (SELECT internal.jwt_treats()))
    AND internal.jwt_sees_centre(e.centre_id)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.episode_session_counts(uuid, text[]) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.episode_session_counts(uuid, text[]) TO authenticated;--> statement-breakpoint

-- Whether the signed in physio books the episode's next session: it is Active and they have a
-- visit in it they are booked on or started (cover, SES-08), in progress or done.
CREATE OR REPLACE FUNCTION internal.books_next_session(episode_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.episode e
    JOIN public.appointment a ON a.episode_id = e.id
    WHERE e.id = books_next_session.episode_id
      AND e.status = 'active'
      AND a.status IN ('in_progress', 'completed')
      AND (SELECT internal.jwt_staff_id()) IN (a.physio_id, a.started_by)
  )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.books_next_session(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.books_next_session(uuid) TO authenticated;--> statement-breakpoint

CREATE POLICY appointment_next_session ON public.appointment FOR INSERT TO authenticated
  WITH CHECK (
    physio_id = (SELECT internal.jwt_staff_id())
    AND booked_by = (SELECT internal.jwt_staff_id())
    AND (SELECT internal.jwt_treats())
    AND internal.jwt_sees_centre(centre_id)
    AND episode_id IS NOT NULL
    AND internal.books_next_session(episode_id)
  );

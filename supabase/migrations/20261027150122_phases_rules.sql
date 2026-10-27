-- OUT-04 with SET-09: the phased programme (PRD J5.11; user decisions 27 October 2026). Each
-- region's phases and exit criteria are knowledge, read like the measures. An episode is in Phase 0
-- until it is moved. On an Active or Under review episode, the treating physio (the newest plan's)
-- marks each exit criterion of the current phase Met or Not yet, and moves the episode on one phase
-- once every one is Met since it entered the phase; anyone with the Consultant and Treats patients
-- ticks now moves it to any other phase of the programme with a written reason. One knowledge
-- version and region per episode. Appended, never changed; clinical readers read it all at any
-- centre; every change audited; Velyx support never writes.

-- The knowledge: read like the measures; nobody signed in writes it (the import writes as the owner).
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.kb_phase
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.kb_phase_criterion
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint
CREATE POLICY kb_phase_read ON public.kb_phase FOR SELECT
  TO authenticated USING ((SELECT internal.jwt_views_knowledge()));--> statement-breakpoint
CREATE POLICY kb_phase_criterion_read ON public.kb_phase_criterion FOR SELECT
  TO authenticated USING ((SELECT internal.jwt_views_knowledge()));--> statement-breakpoint

-- The episode's treating physio: the newest plan version's.
CREATE OR REPLACE FUNCTION internal.episode_treating_physio(episode_id uuid) RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.treating_physio_id FROM public.plan_of_care p
  WHERE p.episode_id = episode_treating_physio.episode_id
  ORDER BY p.version DESC LIMIT 1
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.episode_treating_physio(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.episode_treating_physio(uuid) TO authenticated;--> statement-breakpoint

-- The episode's newest move (its phase and when), if any.
CREATE OR REPLACE FUNCTION internal.episode_phase(episode_id uuid) RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce((
    SELECT m.to_phase FROM public.phase_move m
    WHERE m.episode_id = episode_phase.episode_id
    ORDER BY m.moved_at DESC LIMIT 1
  ), 0)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.episode_phase(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.episode_phase(uuid) TO authenticated;--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.episode_phase_since(episode_id uuid) RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce((
    SELECT max(m.moved_at) FROM public.phase_move m
    WHERE m.episode_id = episode_phase_since.episode_id
  ), '-infinity'::timestamptz)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.episode_phase_since(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.episode_phase_since(uuid) TO authenticated;--> statement-breakpoint

-- Whether the episode's phase records so far are all of this version and region.
CREATE OR REPLACE FUNCTION internal.episode_phase_programme_is(
  episode_id uuid, kb_version_id uuid, region public.kb_region
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.phase_move m
    WHERE m.episode_id = episode_phase_programme_is.episode_id
      AND (m.kb_version_id <> episode_phase_programme_is.kb_version_id
        OR m.region <> episode_phase_programme_is.region)
  ) AND NOT EXISTS (
    SELECT 1 FROM public.phase_mark k
    JOIN public.kb_phase_criterion c ON c.kb_version_id = k.kb_version_id AND c.key = k.criterion_key
    WHERE k.episode_id = episode_phase_programme_is.episode_id
      AND (k.kb_version_id <> episode_phase_programme_is.kb_version_id
        OR c.region <> episode_phase_programme_is.region)
  )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.episode_phase_programme_is(uuid, uuid, public.kb_region) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.episode_phase_programme_is(uuid, uuid, public.kb_region) TO authenticated;--> statement-breakpoint

-- Marks and moves: stamped as the caller now, on a treated episode, within one programme. One
-- episode's marks and moves are serialised (a lock until commit), and stamped with the clock, not
-- the transaction's start, so each sees the one before it and the newest move is the last made.
CREATE OR REPLACE FUNCTION internal.phase_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  caller uuid := internal.jwt_staff_id();
  treating boolean;
  line_phase integer;
  line_region public.kb_region;
  since timestamptz;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Phase records never change' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('phase:episode:' || NEW.episode_id::text, 0));
  IF NOT EXISTS (
    SELECT 1 FROM public.episode e
    WHERE e.id = NEW.episode_id AND e.status IN ('active', 'under_review')
  ) THEN
    RAISE EXCEPTION 'The phase moves only while the episode is Active or Under review'
      USING ERRCODE = 'check_violation';
  END IF;
  -- Never null: an episode without a plan has no treating physio.
  treating := EXISTS (
    SELECT 1 FROM public.staff_user s WHERE s.id = caller AND s.active
  ) AND coalesce(internal.episode_treating_physio(NEW.episode_id) = caller, false);

  IF TG_TABLE_NAME = 'phase_mark' THEN
    NEW.marked_by := caller;
    NEW.marked_at := clock_timestamp();
    IF NOT treating THEN
      RAISE EXCEPTION 'Only the treating physio marks the exit criteria'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT c.phase, c.region INTO line_phase, line_region FROM public.kb_phase_criterion c
    WHERE c.kb_version_id = NEW.kb_version_id AND c.key = NEW.criterion_key;
    IF line_phase IS NULL THEN
      RAISE EXCEPTION 'That is not an exit criterion of this version' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT internal.episode_phase_programme_is(NEW.episode_id, NEW.kb_version_id, line_region) THEN
      RAISE EXCEPTION 'An episode follows one phased programme' USING ERRCODE = 'check_violation';
    END IF;
    IF line_phase <> internal.episode_phase(NEW.episode_id) THEN
      RAISE EXCEPTION 'Only the current phase''s exit criteria are marked'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  NEW.moved_by := caller;
  NEW.moved_at := clock_timestamp();
  IF NEW.from_phase <> internal.episode_phase(NEW.episode_id) THEN
    RAISE EXCEPTION 'The episode is no longer in that phase' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.kb_phase p
    WHERE p.kb_version_id = NEW.kb_version_id AND p.region = NEW.region AND p.number = NEW.to_phase
  ) THEN
    RAISE EXCEPTION 'That phase is not in the programme' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT internal.episode_phase_programme_is(NEW.episode_id, NEW.kb_version_id, NEW.region) THEN
    RAISE EXCEPTION 'An episode follows one phased programme' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.kind = 'override' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.staff_user s
      WHERE s.id = caller AND s.active AND s.consultant AND s.treats_patients
    ) THEN
      RAISE EXCEPTION 'A phase override is made by a consultant with the Treats patients tick'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT treating THEN
    RAISE EXCEPTION 'Only the treating physio moves the patient on'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Every exit criterion of the phase is Met by its latest mark since the phase was entered.
  since := internal.episode_phase_since(NEW.episode_id);
  IF EXISTS (
    SELECT 1 FROM public.kb_phase_criterion c
    WHERE c.kb_version_id = NEW.kb_version_id AND c.region = NEW.region
      AND c.phase = NEW.from_phase
      AND (
        SELECT k.result FROM public.phase_mark k
        WHERE k.episode_id = NEW.episode_id AND k.kb_version_id = NEW.kb_version_id
          AND k.criterion_key = c.key AND k.marked_at >= since
        ORDER BY k.marked_at DESC LIMIT 1
      ) IS DISTINCT FROM 'met'
  ) THEN
    RAISE EXCEPTION 'Every exit criterion of the phase is Met first' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.phase_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER phase_guard BEFORE INSERT OR UPDATE ON public.phase_mark
  FOR EACH ROW EXECUTE FUNCTION internal.phase_guard();--> statement-breakpoint
CREATE TRIGGER phase_guard BEFORE INSERT OR UPDATE ON public.phase_move
  FOR EACH ROW EXECUTE FUNCTION internal.phase_guard();--> statement-breakpoint

CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.phase_mark
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.phase_move
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint

CREATE POLICY phase_mark_read ON public.phase_mark FOR SELECT TO authenticated
  USING ((SELECT internal.jwt_clinical_reader()));--> statement-breakpoint
CREATE POLICY phase_mark_write ON public.phase_mark FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT internal.jwt_treats())
    AND phase_mark.marked_by = (SELECT internal.jwt_staff_id())
  );--> statement-breakpoint
CREATE POLICY phase_move_read ON public.phase_move FOR SELECT TO authenticated
  USING ((SELECT internal.jwt_clinical_reader()));--> statement-breakpoint
CREATE POLICY phase_move_write ON public.phase_move FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT internal.jwt_treats())
    AND phase_move.moved_by = (SELECT internal.jwt_staff_id())
  );--> statement-breakpoint

-- Velyx support stays read only here too (IAM-08).
CREATE POLICY support_read_only_insert ON public.kb_phase AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.kb_phase AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.kb_phase AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_insert ON public.kb_phase_criterion AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.kb_phase_criterion AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.kb_phase_criterion AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_insert ON public.phase_mark AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.phase_mark AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.phase_mark AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_insert ON public.phase_move AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.phase_move AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.phase_move AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint

-- Appended: nobody changes or deletes them.
REVOKE UPDATE, DELETE, TRUNCATE ON public.phase_mark, public.phase_move FROM authenticated;--> statement-breakpoint

-- DECISION #4: acceptable exercise pain is the client's (4/10 in the SOP, 5/10 in the workbooks);
-- 5 is a placeholder.
SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint
INSERT INTO public.setting (key, value, updated_by) VALUES
  ('clinical.acceptable_exercise_pain', '5', 'system:migration')
ON CONFLICT (key) DO NOTHING;

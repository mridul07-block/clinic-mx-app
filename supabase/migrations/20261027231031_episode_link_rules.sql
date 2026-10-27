-- SCH-14: a recurrence (PRD J7.5) links an episode to the discharged episode of the same patient
-- it is the same problem as. The consultant decides it in the consultation (recommended default
-- chosen under the user's standing approval, 28 October 2026; docs/runbooks/episodes.md): a link
-- names the same patient's discharged episode, never the episode itself; a change after opening is
-- made by an active consultant with the Treats patients tick. A discharged episode never changes
-- (episode_transition_guard). Audited with every episode change.
CREATE OR REPLACE FUNCTION internal.episode_link_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.linked_episode_id IS NOT DISTINCT FROM OLD.linked_episode_id THEN
    RETURN NEW;
  END IF;
  IF NEW.linked_episode_id IS NOT NULL AND (
    NEW.linked_episode_id = NEW.id OR NOT EXISTS (
      SELECT 1 FROM public.episode l
      WHERE l.id = NEW.linked_episode_id AND l.patient_id = NEW.patient_id
        AND l.status = 'discharged'
    )
  ) THEN
    RAISE EXCEPTION 'A recurrence links to a discharged episode of the same patient'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND NOT EXISTS (
    SELECT 1 FROM public.staff_user s
    WHERE s.id = internal.jwt_staff_id() AND s.active AND s.consultant AND s.treats_patients
      AND NOT s.velyx_support
  ) THEN
    RAISE EXCEPTION 'A recurrence is linked by a consultant with the Treats patients tick'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.episode_link_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER episode_link_guard BEFORE INSERT OR UPDATE OF linked_episode_id ON public.episode
  FOR EACH ROW EXECUTE FUNCTION internal.episode_link_guard();

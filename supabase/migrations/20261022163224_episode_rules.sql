-- SCH-03: clinical episodes. Every signed in staff member reads every episode (records are shared
-- across centres, PRD J7.6); the Super Admin, Centre Managers and the Front Desk open them at a
-- centre they see (at booking); any signed in staff member may move one, because payment, the
-- front desk and clinicians all do, and each service checks its own permission. Nobody deletes an
-- episode. Every change is audited: the audit trail is the status history.

-- The database's copy of the status machine (packages/schemas/src/episodes.ts); a CI test checks
-- the two allow the same pairs. Also: a discharged episode never changes; the patient and centre
-- stay; resume and return go back to the paused status; a discharge as recovered (Goals achieved,
-- Independent management) needs treatment first (PRD J6.6).
CREATE OR REPLACE FUNCTION internal.episode_transition_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  treated_before public.episode_status;
BEGIN
  IF OLD.status = 'discharged' THEN
    RAISE EXCEPTION 'A discharged episode never changes; a recurrence opens a new episode'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.patient_id IS DISTINCT FROM OLD.patient_id OR NEW.centre_id IS DISTINCT FROM OLD.centre_id
    OR NEW.opened_at IS DISTINCT FROM OLD.opened_at THEN
    RAISE EXCEPTION 'An episode''s patient, centre and opening time never change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM (VALUES
      ('active', 'discharged'),
      ('active', 'lost_to_follow_up'),
      ('active', 'on_hold'),
      ('active', 'under_review'),
      ('awaiting_consultation', 'discharged'),
      ('awaiting_consultation', 'lost_to_follow_up'),
      ('awaiting_consultation', 'on_hold'),
      ('awaiting_consultation', 'plan_proposed'),
      ('intake_pending', 'awaiting_consultation'),
      ('intake_pending', 'discharged'),
      ('intake_pending', 'lost_to_follow_up'),
      ('intake_pending', 'on_hold'),
      ('lost_to_follow_up', 'active'),
      ('lost_to_follow_up', 'awaiting_consultation'),
      ('lost_to_follow_up', 'discharged'),
      ('lost_to_follow_up', 'intake_pending'),
      ('lost_to_follow_up', 'plan_proposed'),
      ('lost_to_follow_up', 'under_review'),
      ('on_hold', 'active'),
      ('on_hold', 'awaiting_consultation'),
      ('on_hold', 'discharged'),
      ('on_hold', 'intake_pending'),
      ('on_hold', 'lost_to_follow_up'),
      ('on_hold', 'plan_proposed'),
      ('on_hold', 'under_review'),
      ('plan_proposed', 'active'),
      ('plan_proposed', 'discharged'),
      ('plan_proposed', 'lost_to_follow_up'),
      ('plan_proposed', 'on_hold'),
      ('under_review', 'active'),
      ('under_review', 'discharged'),
      ('under_review', 'lost_to_follow_up'),
      ('under_review', 'on_hold')
    ) AS allowed(from_status, to_status)
    WHERE allowed.from_status = OLD.status::text AND allowed.to_status = NEW.status::text
  ) THEN
    RAISE EXCEPTION 'An episode cannot go from % to %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  -- Resume and return go back to where the episode paused.
  IF OLD.status IN ('on_hold', 'lost_to_follow_up')
    AND NEW.status NOT IN ('on_hold', 'lost_to_follow_up', 'discharged')
    AND NEW.status IS DISTINCT FROM OLD.paused_from THEN
    RAISE EXCEPTION 'The episode goes back to %, where it paused', OLD.paused_from
      USING ERRCODE = 'check_violation';
  END IF;
  -- Non attendance is never counted as recovered.
  IF NEW.status = 'discharged' AND NEW.discharge_reason IN ('goals_achieved', 'independent_management') THEN
    treated_before := CASE WHEN OLD.status = 'on_hold' THEN OLD.paused_from ELSE OLD.status END;
    IF treated_before NOT IN ('active', 'under_review') THEN
      RAISE EXCEPTION 'A discharge as recovered needs treatment first (the episode was %)', treated_before
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.episode_transition_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER episode_transition_guard BEFORE UPDATE ON public.episode
  FOR EACH ROW EXECUTE FUNCTION internal.episode_transition_guard();--> statement-breakpoint

-- A new episode starts at the beginning: Intake pending, not paused, not closed.
CREATE OR REPLACE FUNCTION internal.episode_opens_pending() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF NEW.status <> 'intake_pending' OR NEW.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'A new episode starts as Intake pending' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.episode_opens_pending() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER episode_opens_pending BEFORE INSERT ON public.episode
  FOR EACH ROW EXECUTE FUNCTION internal.episode_opens_pending();--> statement-breakpoint

CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.episode
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint

CREATE POLICY episode_read ON public.episode FOR SELECT TO authenticated
  USING ((SELECT internal.jwt_staff_id()) IS NOT NULL);--> statement-breakpoint
CREATE POLICY episode_insert ON public.episode FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT internal.jwt_edits_patients())
    AND internal.jwt_sees_centre(centre_id)
  );--> statement-breakpoint
CREATE POLICY episode_update ON public.episode FOR UPDATE TO authenticated
  USING ((SELECT internal.jwt_staff_id()) IS NOT NULL)
  WITH CHECK ((SELECT internal.jwt_staff_id()) IS NOT NULL);--> statement-breakpoint

-- Velyx support stays read only here too (IAM-08).
CREATE POLICY support_read_only_insert ON public.episode AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.episode AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.episode AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));

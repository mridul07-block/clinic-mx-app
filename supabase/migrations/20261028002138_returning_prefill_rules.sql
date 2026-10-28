-- INT-08: a returning patient's health form starts from their earlier one (PRD J2.8, "Returning
-- patients get prefilled details with 'Has anything changed?'"). Recommended defaults chosen under
-- the user's standing approval, 28 October 2026 (docs/runbooks/health-form.md): the details carried
-- over are about you, activity and history; the problem, the warning signs and the health check are
-- asked again every time. After Part A the patient answers "Has anything changed?".

-- The earlier form a patient page may carry over: the newest submitted form of the link's patient,
-- for another visit, within the months given, or the one already chosen. Only the keys asked for
-- leave the database; the problem, warning signs and health check answers never do. For the page's
-- own health form link, while its visit is on.
CREATE OR REPLACE FUNCTION internal.health_form_carry_source(
  keys text[],
  within_months int,
  chosen uuid DEFAULT NULL
)
RETURNS TABLE (id uuid, submitted_at timestamptz, answers jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT r.id, r.submitted_at,
    coalesce(
      (SELECT jsonb_object_agg(e.key, e.value) FROM jsonb_each(r.answers) e
       WHERE e.key = ANY (health_form_carry_source.keys)),
      '{}'::jsonb
    )
  FROM public.patient_link l
  JOIN public.appointment a ON a.id = l.appointment_id
  JOIN public.intake_response r
    ON r.patient_id = l.patient_id AND r.appointment_id <> l.appointment_id
  WHERE l.id = internal.jwt_patient_link_id()
    AND l.purpose = 'health_form'
    AND a.status IN ('checked_in', 'in_progress')
    AND r.submitted_at IS NOT NULL
    AND CASE
      WHEN health_form_carry_source.chosen IS NULL
        THEN r.submitted_at >= now() - make_interval(months => health_form_carry_source.within_months)
      ELSE r.id = health_form_carry_source.chosen
    END
  ORDER BY r.submitted_at DESC, r.id DESC
  LIMIT 1
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.health_form_carry_source(text[], int, uuid) FROM PUBLIC, anon, authenticated;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.health_form_carry_source(text[], int, uuid) TO clinic_patient;--> statement-breakpoint

-- A form carries over only the same patient's submitted form for another visit, whoever writes it.
CREATE OR REPLACE FUNCTION internal.intake_carry_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.carried_from_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.intake_response p
    WHERE p.id = NEW.carried_from_id AND p.patient_id = NEW.patient_id
      AND p.appointment_id <> NEW.appointment_id AND p.submitted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'A health form carries over the same patient''s submitted form for another visit'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.intake_carry_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER intake_carry_guard BEFORE INSERT OR UPDATE OF carried_from_id ON public.intake_response
  FOR EACH ROW EXECUTE FUNCTION internal.intake_carry_guard();--> statement-breakpoint

-- The patient answers "Has anything changed?" on their own form, under the existing save policy
-- (their link's visit, while on, before submit).
GRANT UPDATE (carried_from_id, details_changed) ON public.intake_response TO clinic_patient;--> statement-breakpoint

-- What the consultant reads with the answers: whether details were carried over, from when, and
-- the patient's answer. The same people as before; the old columns come first, as they were.
DROP FUNCTION internal.consultant_health_form(uuid);--> statement-breakpoint
CREATE FUNCTION internal.consultant_health_form(visit_id uuid)
RETURNS TABLE (form_version text, answers jsonb, details_changed boolean, carried_from_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT r.form_version, r.answers, r.details_changed, p.submitted_at
  FROM public.intake_response r
  JOIN public.appointment a ON a.id = r.appointment_id
  LEFT JOIN public.intake_response p ON p.id = r.carried_from_id
  WHERE r.appointment_id = consultant_health_form.visit_id
    AND r.submitted_at IS NOT NULL
    AND (
      (a.physio_id = internal.jwt_staff_id() AND internal.jwt_treats())
      OR EXISTS (
        SELECT 1 FROM public.consultation c
        WHERE c.appointment_id = a.id
          AND c.status = 'signed'
          AND internal.reads_consultation(c.id)
      )
    )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.consultant_health_form(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.consultant_health_form(uuid) TO authenticated;--> statement-breakpoint

-- How far back a submitted form makes a returning patient (rule 6).
SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint
INSERT INTO public.setting (key, value, updated_by) VALUES
  ('intake.carry_over_months', '24', 'system:migration')
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint
SELECT set_config('audit.actor', '', false);

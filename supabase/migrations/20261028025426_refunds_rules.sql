-- BIL-11: refunds (TAD `refund_credit`; PRD section 3: refunds are the Super Admin's and
-- Finance's; decisions 9 and 12). Recommended defaults chosen under the user's standing approval,
-- 28 October 2026 (docs/runbooks/refunds.md): Finance or the Super Admin records money given back
-- against a payment not undone, any day (no time limit or eligibility rule until the client words
-- the refund policy, DECISION 9), with the amount, how, why and their name as the approval; several
-- on one payment, never more than was paid. A full refund closes the payment's live package; a
-- partial one leaves it. The bill stays paid; the clinical episode is never touched. Credits wait
-- for the client (DECISION 12). Revenue is net of refunds, each on the day it was given.

CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.refund_credit
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint

-- Read with its bill: those who see amounts at the bill's centre (the desk there, Finance, the
-- Super Admin).
CREATE POLICY refund_credit_read ON public.refund_credit FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.bill b WHERE b.id = refund_credit.bill_id));--> statement-breakpoint

-- Velyx support stays read only here too (IAM-08).
CREATE POLICY support_read_only_insert ON public.refund_credit AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.refund_credit AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.refund_credit AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.refund_credit FROM authenticated;--> statement-breakpoint

-- Records a refund of `amount_paise` against a payment, as the signed in Finance or Super Admin
-- member; closes the payment's live package once the whole payment is refunded. Its id.
CREATE OR REPLACE FUNCTION internal.refund_payment(
  payment_id uuid,
  amount_paise int,
  method public.payment_method,
  reference text,
  reason text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  paid record;
  before int;
  made uuid;
  why text := trim(coalesce(refund_payment.reason, ''));
BEGIN
  IF NOT coalesce(internal.jwt_staff_role() IN ('super_admin', 'finance'), false)
    OR coalesce(internal.jwt_support(), false) OR internal.jwt_staff_id() IS NULL THEN
    RAISE EXCEPTION 'Refunds are recorded by Finance' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT p.id, p.bill_id, p.amount_paise, p.undone_at INTO paid
    FROM public.payment p WHERE p.id = refund_payment.payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such payment' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF paid.undone_at IS NOT NULL THEN
    RAISE EXCEPTION 'An undone payment is not refunded' USING ERRCODE = 'check_violation';
  END IF;
  IF length(why) NOT BETWEEN 1 AND 300 THEN
    RAISE EXCEPTION 'A refund needs its reason' USING ERRCODE = 'check_violation';
  END IF;
  SELECT coalesce(sum(c.amount_paise), 0)::int INTO before
    FROM public.refund_credit c WHERE c.payment_id = paid.id;
  IF refund_payment.amount_paise IS NULL OR refund_payment.amount_paise < 1
    OR before::bigint + refund_payment.amount_paise > paid.amount_paise THEN
    RAISE EXCEPTION 'A refund is never more than was paid' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO public.refund_credit
    (payment_id, bill_id, amount_paise, method, reference, reason, approved_by, approved_by_name)
  VALUES (paid.id, paid.bill_id, refund_payment.amount_paise, refund_payment.method,
    nullif(trim(refund_payment.reference), ''), why, internal.jwt_staff_id(),
    (SELECT s.name FROM public.staff_user s WHERE s.id = internal.jwt_staff_id()))
  RETURNING id INTO made;
  IF before::bigint + refund_payment.amount_paise = paid.amount_paise THEN
    UPDATE public.package k SET cancelled_at = now(), cancel_reason = 'Refunded.'
      WHERE k.payment_id = paid.id AND k.cancelled_at IS NULL;
  END IF;
  RETURN made;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.refund_payment(uuid, int, public.payment_method, text, text) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.refund_payment(uuid, int, public.payment_method, text, text) TO authenticated;--> statement-breakpoint

-- The desk's same-day undo is refused once a refund was given: the money would go back twice.
CREATE OR REPLACE FUNCTION internal.undo_payment(payment_id uuid, reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  paid record;
  bought record;
BEGIN
  SELECT p.id, p.bill_id, p.recorded_at, p.undone_at, b.centre_id INTO paid
    FROM public.payment p JOIN public.bill b ON b.id = p.bill_id
    WHERE p.id = undo_payment.payment_id FOR UPDATE OF p;
  IF NOT FOUND OR NOT internal.collects_at(paid.centre_id) THEN
    RAISE EXCEPTION 'Not a payment this person undoes' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF paid.undone_at IS NOT NULL THEN
    RAISE EXCEPTION 'The payment is already undone' USING ERRCODE = 'check_violation';
  END IF;
  IF (paid.recorded_at AT TIME ZONE 'Asia/Kolkata')::date
    <> (now() AT TIME ZONE 'Asia/Kolkata')::date THEN
    RAISE EXCEPTION 'A payment is undone only on the day it was recorded'
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM public.refund_credit c WHERE c.payment_id = paid.id) THEN
    RAISE EXCEPTION 'The payment has a refund' USING ERRCODE = 'check_violation';
  END IF;
  IF length(trim(coalesce(undo_payment.reason, ''))) NOT BETWEEN 1 AND 300 THEN
    RAISE EXCEPTION 'An undone payment needs its reason' USING ERRCODE = 'check_violation';
  END IF;
  SELECT k.id, k.sessions_used INTO bought
    FROM public.package k
    WHERE k.payment_id = paid.id AND k.cancelled_at IS NULL FOR UPDATE;
  IF FOUND THEN
    IF bought.sessions_used > 0 THEN
      RAISE EXCEPTION 'Sessions from this package have been used; Finance refunds it'
        USING ERRCODE = 'check_violation';
    END IF;
    UPDATE public.package k
      SET cancelled_at = now(), cancel_reason = 'The payment was undone.'
      WHERE k.id = bought.id;
  END IF;
  UPDATE public.payment p
    SET undone_at = now(), undone_by = internal.jwt_staff_id(), undo_reason = trim(undo_payment.reason)
    WHERE p.id = paid.id;
  UPDATE public.bill b SET status = 'unpaid' WHERE b.id = paid.bill_id;
  INSERT INTO public.job (kind, payload, idempotency_key)
  VALUES ('documents.invoice', jsonb_build_object('paymentId', paid.id), 'invoice:undo:' || paid.id)
  ON CONFLICT (idempotency_key) DO NOTHING;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.kpi_daily(from_day date, to_day date)
RETURNS TABLE (centre_id uuid, day date, metric text, numerator bigint, denominator bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  caller_role text := internal.jwt_staff_role();
  clinical boolean := internal.jwt_staff_id() IS NOT NULL
    AND internal.jwt_staff_role() IN ('super_admin', 'centre_manager');
  finance boolean := internal.jwt_staff_id() IS NOT NULL
    AND internal.jwt_staff_role() IN ('super_admin', 'finance');
  longest int := coalesce((SELECT (s.value #>> '{}')::int FROM public.setting s
    WHERE s.key = 'kpi.max_range_days'), 366);
  range_start timestamptz := from_day::timestamp AT TIME ZONE 'Asia/Kolkata';
  range_end timestamptz := (to_day + 1)::timestamp AT TIME ZONE 'Asia/Kolkata';
  today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  IF NOT (clinical OR finance) THEN
    RAISE EXCEPTION 'The figures are for the Super Admin, Centre Managers and Finance (not %)',
      coalesce(caller_role, 'signed out') USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF from_day IS NULL OR to_day IS NULL OR to_day < from_day OR to_day - from_day + 1 > longest THEN
    RAISE EXCEPTION 'The figures cover 1 to % days', longest
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN QUERY
  WITH visit AS (
    SELECT a.id, a.centre_id, a.episode_id, a.status, a.starts_at, t.key AS type_key,
      (a.starts_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
      a.status IN ('checked_in', 'in_progress', 'completed') AS came
    FROM public.appointment a
    JOIN public.appointment_type t ON t.id = a.appointment_type_id
    WHERE clinical AND a.starts_at >= range_start AND a.starts_at < range_end
  ),
  proposed AS (
    SELECT e.id, e.centre_id, e.activated_at,
      (e.plan_proposed_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
      (SELECT c.choice FROM public.plan_choice c WHERE c.episode_id = e.id
        ORDER BY c.recorded_at DESC LIMIT 1) AS choice
    FROM public.episode e
    WHERE clinical AND e.plan_proposed_at >= range_start AND e.plan_proposed_at < range_end
      AND NOT EXISTS (SELECT 1 FROM public.opening_entry o WHERE o.episode_id = e.id)
      -- A red flag referral puts the episode On hold, before or after the plan was proposed.
      AND NOT EXISTS (SELECT 1 FROM public.red_flag_alert r
        WHERE r.episode_id = e.id AND r.referred_at IS NOT NULL)
  ),
  history AS (
    -- Each stretch of an episode's status, from the audit trail: from one change to the next.
    SELECT e.centre_id, e.patient_id, a.after ->> 'status' AS status, a.at AS since,
      lead(a.at) OVER (PARTITION BY a.entity_id ORDER BY a.at, a.id) AS until
    FROM public.episode e
    JOIN public.audit_event a ON a.entity = 'episode' AND a.entity_id = e.id::text
    WHERE clinical AND a.after IS NOT NULL AND e.opened_at < range_end
      AND (e.closed_at IS NULL OR e.closed_at >= range_start)
      AND internal.jwt_sees_centre(e.centre_id)
  ),
  day_end AS (
    SELECT d::date AS day,
      least(((d::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata'), now()) AS at
    FROM generate_series(from_day, least(to_day, today), interval '1 day') d
  ),
  figures AS (
    -- Red flag documentation: the first consultation of each episode the patient came to.
    SELECT v.centre_id, v.day, 'red_flag_documentation' AS metric,
      count(*) FILTER (WHERE c.status = 'signed') AS numerator, count(*) AS denominator
    FROM visit v
    LEFT JOIN public.consultation c ON c.appointment_id = v.id
    WHERE v.type_key = 'consultation' AND v.came AND v.episode_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.appointment p
        JOIN public.appointment_type pt ON pt.id = p.appointment_type_id AND pt.key = 'consultation'
        WHERE p.episode_id = v.episode_id
          AND p.status IN ('checked_in', 'in_progress', 'completed')
          AND (p.starts_at, p.id) < (v.starts_at, v.id)
      )
    GROUP BY v.centre_id, v.day
    UNION ALL
    SELECT p.centre_id, p.day, 'consultation_conversion',
      count(*) FILTER (WHERE p.activated_at IS NOT NULL), count(*)
    FROM proposed p GROUP BY p.centre_id, p.day
    UNION ALL
    SELECT p.centre_id, p.day, 'plan_acceptance',
      count(*) FILTER (WHERE p.choice IN ('package', 'per_session')), count(*)
    FROM proposed p GROUP BY p.centre_id, p.day
    UNION ALL
    -- Treatment completion: discharged after treatment began.
    SELECT e.centre_id, (e.closed_at AT TIME ZONE 'Asia/Kolkata')::date, 'treatment_completion',
      count(*) FILTER (WHERE e.discharge_reason IN ('goals_achieved', 'independent_management')),
      count(*)
    FROM public.episode e
    WHERE clinical AND e.status = 'discharged' AND e.activated_at IS NOT NULL
      AND e.closed_at >= range_start AND e.closed_at < range_end
    GROUP BY 1, 2
    UNION ALL
    -- Notes signed same day: a day counts once it has ended.
    SELECT v.centre_id, v.day, 'notes_signed_same_day',
      count(*) FILTER (WHERE n.status = 'signed'
        AND (n.signed_at AT TIME ZONE 'Asia/Kolkata')::date = v.day),
      count(*)
    FROM visit v
    JOIN (
      SELECT c.appointment_id, c.status::text AS status, c.signed_at FROM public.consultation c
      UNION ALL
      SELECT s.appointment_id, s.status::text, s.signed_at FROM public.session s
    ) n ON n.appointment_id = v.id
    WHERE v.day < today
    GROUP BY v.centre_id, v.day
    UNION ALL
    -- No show rate: of the visits resolved either way; past visits nobody marked are left out.
    SELECT v.centre_id, v.day, 'no_show_rate',
      count(*) FILTER (WHERE v.status = 'no_show'), count(*)
    FROM visit v
    WHERE v.came OR v.status = 'no_show'
    GROUP BY v.centre_id, v.day
    UNION ALL
    SELECT v.centre_id, v.day, 'health_form_before_consultation',
      count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM public.intake_response r
        WHERE r.appointment_id = v.id AND r.submitted_at <= v.starts_at)),
      count(*)
    FROM visit v
    WHERE v.type_key = 'consultation' AND v.came
    GROUP BY v.centre_id, v.day
    UNION ALL
    SELECT v.centre_id, v.day, 'consultations', count(*), NULL::bigint
    FROM visit v
    WHERE v.type_key = 'consultation' AND v.status = 'completed'
    GROUP BY v.centre_id, v.day
    UNION ALL
    -- Active patients: Active or Under review at the end of each day (now, for today), at each
    -- centre and, with no centre, across the centres the reader sees: a patient treated at two
    -- centres counts at each, and once in all.
    SELECT h.centre_id, d.day, 'active_patients', count(DISTINCT h.patient_id), NULL::bigint
    FROM day_end d
    JOIN history h ON h.since <= d.at AND (h.until IS NULL OR h.until > d.at)
      AND h.status IN ('active', 'under_review')
    GROUP BY GROUPING SETS ((h.centre_id, d.day), (d.day))
    UNION ALL
    -- Revenue on a cash basis (DSH-04), less refunds (BIL-11) on the day each was given.
    SELECT r.centre_id, r.day, 'revenue', sum(r.paise)::bigint, NULL::bigint
    FROM (
      SELECT b.centre_id, (p.recorded_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
        p.amount_paise AS paise
      FROM public.payment p
      JOIN public.bill b ON b.id = p.bill_id
      WHERE finance AND p.undone_at IS NULL
        AND p.recorded_at >= range_start AND p.recorded_at < range_end
      UNION ALL
      SELECT b.centre_id, (c.approved_at AT TIME ZONE 'Asia/Kolkata')::date, -c.amount_paise
      FROM public.refund_credit c
      JOIN public.bill b ON b.id = c.bill_id
      WHERE finance AND c.approved_at >= range_start AND c.approved_at < range_end
    ) r
    GROUP BY 1, 2
  )
  SELECT f.centre_id, f.day, f.metric, f.numerator, f.denominator
  FROM figures f
  WHERE f.centre_id IS NULL OR internal.jwt_sees_centre(f.centre_id)
  ORDER BY f.day, f.centre_id, f.metric;
END;
$$;--> statement-breakpoint

-- BIL-07, after review (28 October 2026). Three fixes:
-- 1. A discount keeps the name of whoever applied it, so the desk sees Finance's or the Super
--    Admin's name on their approval (staff_user rows outside one's centre are not readable).
-- 2. "Mark paid" now names the total the desk was shown: a discount changed elsewhere meanwhile
--    refuses the payment instead of recording an amount that did not change hands.
-- 3. A payment keeps the lines as charged, discounts included, and its invoice prints those: a
--    payment undone and the bill discounted again never rewrites an earlier invoice.
CREATE OR REPLACE FUNCTION internal.apply_discount(
  line_id uuid,
  preset_id uuid,
  percent int,
  amount_paise int,
  reason text
) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  line record;
  preset record;
  finance boolean := coalesce(internal.jwt_staff_role() IN ('super_admin', 'finance'), false);
  kind public.discount_kind;
  name text;
  pct int;
  off int;
  why text := nullif(trim(apply_discount.reason), '');
  total int;
BEGIN
  SELECT l.id, l.amount_paise, l.discount_kind, l.discount_preset_id, b.id AS bill_id,
      b.status, b.centre_id
    INTO line
    FROM public.bill_line l JOIN public.bill b ON b.id = l.bill_id
    WHERE l.id = apply_discount.line_id FOR UPDATE OF b, l;
  IF NOT FOUND OR NOT internal.collects_at(line.centre_id) THEN
    RAISE EXCEPTION 'Not a bill this person discounts' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF line.status <> 'unpaid' THEN
    RAISE EXCEPTION 'Only an unpaid bill is discounted' USING ERRCODE = 'check_violation';
  END IF;
  -- An Other discount is Finance's: the desk neither applies nor replaces one.
  IF (apply_discount.preset_id IS NULL
      OR (line.discount_kind IS NOT NULL AND line.discount_preset_id IS NULL)) AND NOT finance THEN
    RAISE EXCEPTION 'Other discounts are applied by Finance' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF apply_discount.preset_id IS NOT NULL THEN
    SELECT p.kind, p.name, p.percent, p.amount_paise INTO preset
      FROM public.discount_preset p WHERE p.id = apply_discount.preset_id AND p.active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'That discount is not in use' USING ERRCODE = 'check_violation';
    END IF;
    kind := preset.kind;
    name := preset.name;
    pct := preset.percent;
    off := CASE WHEN preset.kind = 'percent'
      THEN ((line.amount_paise::bigint * preset.percent + 50) / 100)::int
      ELSE preset.amount_paise END;
  ELSE
    IF why IS NULL THEN
      RAISE EXCEPTION 'An Other discount needs a reason' USING ERRCODE = 'check_violation';
    END IF;
    IF (apply_discount.percent IS NULL) = (apply_discount.amount_paise IS NULL) THEN
      RAISE EXCEPTION 'An Other discount is a percent or an amount' USING ERRCODE = 'check_violation';
    END IF;
    name := 'Other discount';
    IF apply_discount.percent IS NOT NULL THEN
      kind := 'percent';
      pct := apply_discount.percent;
      off := ((line.amount_paise::bigint * apply_discount.percent + 50) / 100)::int;
    ELSE
      kind := 'flat';
      pct := NULL;
      off := apply_discount.amount_paise;
    END IF;
  END IF;
  -- DECISION BIL-07: a discount never makes a line free; a free visit is not a bill.
  IF off IS NULL OR off < 1 OR off >= line.amount_paise THEN
    RAISE EXCEPTION 'The discount would make the bill free' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.bill_line l SET
    discount_kind = kind,
    discount_preset_id = apply_discount.preset_id,
    discount_name = name,
    discount_percent = pct,
    discount_paise = off,
    discount_reason = why,
    discounted_by = internal.jwt_staff_id(),
    discounted_by_name = (SELECT s.name FROM public.staff_user s WHERE s.id = internal.jwt_staff_id()),
    discounted_at = now()
  WHERE l.id = line.id;
  UPDATE public.bill b SET total_paise = (
    SELECT sum(x.amount_paise - x.discount_paise)::int FROM public.bill_line x WHERE x.bill_id = b.id
  ) WHERE b.id = line.bill_id
  RETURNING b.total_paise INTO total;
  RETURN total;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.remove_discount(line_id uuid) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  line record;
  total int;
BEGIN
  SELECT l.id, l.discount_kind, l.discount_preset_id, b.id AS bill_id, b.status, b.centre_id
    INTO line
    FROM public.bill_line l JOIN public.bill b ON b.id = l.bill_id
    WHERE l.id = remove_discount.line_id FOR UPDATE OF b, l;
  IF NOT FOUND OR NOT internal.collects_at(line.centre_id) THEN
    RAISE EXCEPTION 'Not a bill this person discounts' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF line.status <> 'unpaid' THEN
    RAISE EXCEPTION 'Only an unpaid bill is discounted' USING ERRCODE = 'check_violation';
  END IF;
  IF line.discount_kind IS NOT NULL AND line.discount_preset_id IS NULL
    AND NOT coalesce(internal.jwt_staff_role() IN ('super_admin', 'finance'), false) THEN
    RAISE EXCEPTION 'Other discounts are applied by Finance' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE public.bill_line l SET
    discount_kind = NULL, discount_preset_id = NULL, discount_name = NULL,
    discount_percent = NULL, discount_paise = 0, discount_reason = NULL,
    discounted_by = NULL, discounted_by_name = NULL, discounted_at = NULL
  WHERE l.id = line.id;
  UPDATE public.bill b SET total_paise = (
    SELECT sum(x.amount_paise - x.discount_paise)::int FROM public.bill_line x WHERE x.bill_id = b.id
  ) WHERE b.id = line.bill_id
  RETURNING b.total_paise INTO total;
  RETURN total;
END;
$$;--> statement-breakpoint

-- Marks a bill paid for the total the desk was shown (`expected_total`), then records the lines as
-- charged on the payment. `internal.record_payment` does the rest, as before.
CREATE OR REPLACE FUNCTION internal.record_payment_of(
  bill_id uuid,
  method public.payment_method,
  reference text,
  expected_total int
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  current_total int;
  made uuid;
BEGIN
  SELECT b.total_paise INTO current_total FROM public.bill b
    WHERE b.id = record_payment_of.bill_id FOR UPDATE;
  IF FOUND AND internal.collects_at((SELECT b.centre_id FROM public.bill b WHERE b.id = record_payment_of.bill_id))
    AND current_total IS DISTINCT FROM record_payment_of.expected_total THEN
    RAISE EXCEPTION 'The bill''s total has changed' USING ERRCODE = 'check_violation';
  END IF;
  made := internal.record_payment(record_payment_of.bill_id, record_payment_of.method,
    record_payment_of.reference);
  UPDATE public.payment p SET charged_lines = (
    SELECT jsonb_agg(jsonb_build_object(
      'description', l.description,
      'quantity', l.quantity,
      'unitPaise', l.unit_paise,
      'amountPaise', l.amount_paise,
      'discount', CASE WHEN l.discount_kind IS NULL THEN NULL ELSE jsonb_build_object(
        'name', l.discount_name, 'percent', l.discount_percent, 'paise', l.discount_paise) END
    ) ORDER BY l.description, l.id)
    FROM public.bill_line l WHERE l.bill_id = record_payment_of.bill_id
  ) WHERE p.id = made;
  RETURN made;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.record_payment_of(uuid, public.payment_method, text, int) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.record_payment_of(uuid, public.payment_method, text, int) TO authenticated;

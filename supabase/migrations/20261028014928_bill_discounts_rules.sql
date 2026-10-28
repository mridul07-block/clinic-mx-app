-- BIL-07: discounts (decision 15; PRD section 3 "preset only" at the desk, "full" for Finance).
-- Recommended defaults chosen under the user's standing approval, 28 October 2026
-- (docs/runbooks/bills.md): the front desk applies a preset discount from the clinic's list;
-- any other discount is applied by Finance or the Super Admin with a reason, and applying it is
-- the approval, recorded with their name. One discount per line, on an unpaid bill only, never
-- down to ₹0 (no partial payments, decision 10; a payment is above 0). The bill's total becomes
-- the lines less their discounts, so payments, invoices, dashboards and exports follow. Staff
-- still write no bill or line directly: only these functions do, audited as the person.

-- Applies a discount to a line, replacing any it had: a preset (its kind, amount and name copied
-- now, so a later edit of the preset changes nothing here), or with no preset an Other discount of
-- `percent` or `amount_paise` with its reason. The bill's new total.
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
    discounted_at = now()
  WHERE l.id = line.id;
  UPDATE public.bill b SET total_paise = (
    SELECT sum(x.amount_paise - x.discount_paise)::int FROM public.bill_line x WHERE x.bill_id = b.id
  ) WHERE b.id = line.bill_id
  RETURNING b.total_paise INTO total;
  RETURN total;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.apply_discount(uuid, uuid, int, int, text) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.apply_discount(uuid, uuid, int, int, text) TO authenticated;--> statement-breakpoint

-- Takes a line's discount off an unpaid bill: a preset one by whoever applies presets there, an
-- Other one only by Finance or the Super Admin. The bill's new total.
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
    discounted_by = NULL, discounted_at = NULL
  WHERE l.id = line.id;
  UPDATE public.bill b SET total_paise = (
    SELECT sum(x.amount_paise - x.discount_paise)::int FROM public.bill_line x WHERE x.bill_id = b.id
  ) WHERE b.id = line.bill_id
  RETURNING b.total_paise INTO total;
  RETURN total;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.remove_discount(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.remove_discount(uuid) TO authenticated;--> statement-breakpoint

-- Whoever writes it, a paid or cancelled bill keeps the discount it had.
CREATE OR REPLACE FUNCTION internal.bill_line_discount_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.bill b WHERE b.id = NEW.bill_id AND b.status = 'unpaid'
  ) THEN
    RAISE EXCEPTION 'Only an unpaid bill is discounted' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.bill_line_discount_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER bill_line_discount_guard
  BEFORE UPDATE OF discount_kind, discount_preset_id, discount_name, discount_percent,
    discount_paise, discount_reason, discounted_by, discounted_at
  ON public.bill_line
  FOR EACH ROW EXECUTE FUNCTION internal.bill_line_discount_guard();

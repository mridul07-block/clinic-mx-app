-- SET-02: the price master. Finance and the Super Admin keep it (prices.manage); Centre Managers
-- and the front desk read it (prices.view; decision C3: Centre Managers see list prices, never
-- patient bills). Physiotherapists see no prices. Nothing is deleted except a package type's
-- covered items, which are replaced when the type is edited. Every change is audited.

CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.price_item
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.package_type
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.package_type_item
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.discount_preset
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint

-- Whether the signed in person may read prices (prices.view in the permission map).
CREATE OR REPLACE FUNCTION internal.jwt_views_prices() RETURNS boolean
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT coalesce(
    internal.jwt_staff_role() IN ('super_admin', 'centre_manager', 'front_desk', 'finance'),
    false
  )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.jwt_views_prices() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.jwt_views_prices() TO authenticated;--> statement-breakpoint

-- Whether the signed in person may change prices (prices.manage).
CREATE OR REPLACE FUNCTION internal.jwt_manages_prices() RETURNS boolean
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT coalesce(internal.jwt_staff_role() IN ('super_admin', 'finance'), false)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.jwt_manages_prices() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.jwt_manages_prices() TO authenticated;--> statement-breakpoint

CREATE POLICY price_item_read ON public.price_item FOR SELECT TO authenticated
  USING ((SELECT internal.jwt_views_prices()));--> statement-breakpoint
CREATE POLICY price_item_insert ON public.price_item FOR INSERT TO authenticated
  WITH CHECK ((SELECT internal.jwt_manages_prices()));--> statement-breakpoint
CREATE POLICY price_item_update ON public.price_item FOR UPDATE TO authenticated
  USING ((SELECT internal.jwt_manages_prices()))
  WITH CHECK ((SELECT internal.jwt_manages_prices()));--> statement-breakpoint

CREATE POLICY package_type_read ON public.package_type FOR SELECT TO authenticated
  USING ((SELECT internal.jwt_views_prices()));--> statement-breakpoint
CREATE POLICY package_type_insert ON public.package_type FOR INSERT TO authenticated
  WITH CHECK ((SELECT internal.jwt_manages_prices()));--> statement-breakpoint
CREATE POLICY package_type_update ON public.package_type FOR UPDATE TO authenticated
  USING ((SELECT internal.jwt_manages_prices()))
  WITH CHECK ((SELECT internal.jwt_manages_prices()));--> statement-breakpoint

CREATE POLICY package_type_item_read ON public.package_type_item FOR SELECT TO authenticated
  USING ((SELECT internal.jwt_views_prices()));--> statement-breakpoint
CREATE POLICY package_type_item_insert ON public.package_type_item FOR INSERT TO authenticated
  WITH CHECK ((SELECT internal.jwt_manages_prices()));--> statement-breakpoint
CREATE POLICY package_type_item_delete ON public.package_type_item FOR DELETE TO authenticated
  USING ((SELECT internal.jwt_manages_prices()));--> statement-breakpoint

CREATE POLICY discount_preset_read ON public.discount_preset FOR SELECT TO authenticated
  USING ((SELECT internal.jwt_views_prices()));--> statement-breakpoint
CREATE POLICY discount_preset_insert ON public.discount_preset FOR INSERT TO authenticated
  WITH CHECK ((SELECT internal.jwt_manages_prices()));--> statement-breakpoint
CREATE POLICY discount_preset_update ON public.discount_preset FOR UPDATE TO authenticated
  USING ((SELECT internal.jwt_manages_prices()))
  WITH CHECK ((SELECT internal.jwt_manages_prices()));--> statement-breakpoint

-- Velyx support stays read only here too (IAM-08).
CREATE POLICY support_read_only_insert ON public.price_item AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.price_item AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.price_item AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_insert ON public.package_type AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.package_type AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.package_type AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_insert ON public.package_type_item AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.package_type_item AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.package_type_item AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_insert ON public.discount_preset AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.discount_preset AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.discount_preset AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint

-- The current price master (PRD section 7, "Current price master"; user decision 22 October
-- 2026). Laser and dry needling are added by Finance when the client sends them (decision 16).
-- DECISION #17: these are the amounts the patient pays; tax treatment on invoices is open.
SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint
INSERT INTO public.price_item (key, label, amount_paise) VALUES
  ('consultation', 'Consultation', 75000),
  ('senior_consultation', 'Senior consultation', 100000),
  ('rehabilitation_session', 'Rehabilitation session', 100000),
  ('advanced_rehabilitation_session', 'Advanced rehabilitation session', 150000),
  ('pemf', 'PEMF', 75000),
  ('radial_shockwave', 'Radial shockwave (RSW)', 75000),
  ('focused_shockwave', 'Focused shockwave (FSW)', 200000),
  ('zero_gravity_treadmill', 'Zero Gravity Treadmill', 200000)
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint
SELECT set_config('audit.actor', '', false);

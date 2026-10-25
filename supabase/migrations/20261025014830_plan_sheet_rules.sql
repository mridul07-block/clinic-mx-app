-- BIL-01: the plan and payment sheet (PRD J4.2; user decisions, 25 October 2026). The front desk
-- prices the recommended plan without clinical access: internal.plan_for_pricing gives only what
-- pricing needs from the episode's newest plan of care (how often, for how long, the planned
-- modalities by name, the treating physio and the review date; never the diagnosis, goals or
-- findings), to those who see bill amounts (`bills.view_amounts`): the Super Admin, Finance, and
-- the front desk at the episode's centre. The session types the sheet offers are a setting.
SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint
INSERT INTO public.setting (key, value, updated_by) VALUES
  ('billing.session_price_items', '["rehabilitation_session", "advanced_rehabilitation_session"]', 'system:migration')
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint
SELECT set_config('audit.actor', '', false);--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.plan_for_pricing(episode_id uuid)
RETURNS TABLE (
  plan_of_care_id uuid,
  sessions_per_week integer,
  weeks integer,
  review_date date,
  treating_physio text,
  modalities jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.id, p.sessions_per_week, p.weeks, p.review_date,
    (SELECT s.name FROM public.staff_user s WHERE s.id = p.treating_physio_id),
    coalesce(
      (SELECT jsonb_agg(jsonb_build_object('key', m.modality_key, 'name', coalesce(k.name, m.modality_key))
          ORDER BY coalesce(k.name, m.modality_key))
        FROM public.plan_modality m
        LEFT JOIN public.kb_modality k ON k.key = m.modality_key AND k.kb_version_id = c.kb_version_id
        WHERE m.plan_of_care_id = p.id),
      '[]'::jsonb)
  FROM public.plan_of_care p
  JOIN public.episode e ON e.id = p.episode_id
  JOIN public.consultation c ON c.id = p.consultation_id
  WHERE p.episode_id = plan_for_pricing.episode_id
    AND (
      internal.jwt_staff_role() IN ('super_admin', 'finance')
      OR (internal.jwt_staff_role() = 'front_desk' AND internal.jwt_sees_centre(e.centre_id))
    )
  ORDER BY p.version DESC
  LIMIT 1
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.plan_for_pricing(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.plan_for_pricing(uuid) TO authenticated;

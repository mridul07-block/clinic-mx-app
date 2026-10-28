-- AI-03: the AI preparation sheet and its suggestions (TAD section 7 step 7; PRD section 6 step 6:
-- "The physio keeps or dismisses each suggestion; nothing enters the record until the physio
-- confirms it"). Recommended defaults chosen under the user's standing approval, 28 October 2026
-- (docs/runbooks/ai-preparation-sheet.md). The server writes sheets and suggestions as
-- `system:ai`. Consultants read them for episodes at centres they see, as `ai_run`. The physio of
-- a live visit on the episode (Consultant tick) keeps or dismisses a suggestion, and only until a
-- consultation on the episode is signed; nothing else of a suggestion ever changes.

CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.ai_preparation_sheet
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON public.ai_suggestion
  FOR EACH ROW EXECUTE FUNCTION internal.audit_change();--> statement-breakpoint

CREATE POLICY ai_preparation_sheet_read ON public.ai_preparation_sheet FOR SELECT TO authenticated
  USING (
    (SELECT internal.jwt_consultant())
    AND EXISTS (
      SELECT 1 FROM public.episode e
      WHERE e.id = ai_preparation_sheet.episode_id AND internal.jwt_sees_centre(e.centre_id)
    )
  );--> statement-breakpoint
CREATE POLICY ai_suggestion_read ON public.ai_suggestion FOR SELECT TO authenticated
  USING (
    (SELECT internal.jwt_consultant())
    AND EXISTS (
      SELECT 1 FROM public.ai_preparation_sheet s
      JOIN public.episode e ON e.id = s.episode_id
      WHERE s.id = ai_suggestion.sheet_id AND internal.jwt_sees_centre(e.centre_id)
    )
  );--> statement-breakpoint

-- Whether the signed in staff member may keep or dismiss the sheet's suggestions: a consultant
-- who is the physio of a visit on the episode that still stands, while no consultation on the
-- episode is signed. SECURITY DEFINER: it reads visits and consultations the caller may not.
CREATE OR REPLACE FUNCTION internal.ai_sheet_disposer(p_sheet_id uuid) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(internal.jwt_consultant(), false)
    AND NOT coalesce(internal.jwt_support(), false)
    AND EXISTS (
      SELECT 1
      FROM public.ai_preparation_sheet s
      JOIN public.appointment a ON a.episode_id = s.episode_id
      WHERE s.id = p_sheet_id
        AND a.physio_id = internal.jwt_staff_id()
        AND a.status NOT IN ('cancelled', 'rescheduled', 'no_show')
        AND NOT EXISTS (
          SELECT 1 FROM public.consultation c
          WHERE c.episode_id = s.episode_id AND c.status = 'signed'
        )
    );
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.ai_sheet_disposer(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.ai_sheet_disposer(uuid) TO authenticated;--> statement-breakpoint

CREATE POLICY ai_suggestion_dispose ON public.ai_suggestion FOR UPDATE TO authenticated
  USING ((SELECT internal.ai_sheet_disposer(ai_suggestion.sheet_id)))
  WITH CHECK (
    (SELECT internal.ai_sheet_disposer(ai_suggestion.sheet_id))
    AND ai_suggestion.disposition IS NOT NULL
    AND ai_suggestion.disposed_by = (SELECT internal.jwt_staff_id())
  );--> statement-breakpoint

-- Velyx support stays read only (IAM-08).
CREATE POLICY support_read_only_insert ON public.ai_preparation_sheet AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.ai_preparation_sheet AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.ai_preparation_sheet AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_insert ON public.ai_suggestion AS RESTRICTIVE FOR INSERT
  TO authenticated WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_update ON public.ai_suggestion AS RESTRICTIVE FOR UPDATE
  TO authenticated USING (NOT (SELECT internal.jwt_support()))
  WITH CHECK (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
CREATE POLICY support_read_only_delete ON public.ai_suggestion AS RESTRICTIVE FOR DELETE
  TO authenticated USING (NOT (SELECT internal.jwt_support()));--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.ai_preparation_sheet FROM authenticated;--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.ai_suggestion FROM authenticated;--> statement-breakpoint
GRANT UPDATE (disposition, disposed_by, disposed_at) ON public.ai_suggestion TO authenticated;--> statement-breakpoint

SELECT set_config('audit.actor', 'system:migration', false);--> statement-breakpoint
INSERT INTO public.setting (key, value, updated_by) VALUES
  -- DECISION #3: top 3 plus 2 under Also consider is the documented default; the client confirms.
  ('ai.sheet_top_count', '3', 'system:migration'),
  ('ai.sheet_also_consider_count', '2', 'system:migration'),
  ('ai.sheet_retry_after_seconds', '60', 'system:migration')
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint
SELECT set_config('audit.actor', '', false);

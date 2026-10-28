-- AI-04: "Recheck with findings" (PRD J3.5; TAD section 7: steps 5 to 7 again "with the examination
-- results, only when tapped"). The latest recheck is its own run, kept beside the sheet's first
-- ranking, written only by the server as system:ai (staff write nothing here, ai_sheet_rules.sql);
-- the visit's consultant keeps or dismisses its suggestions as the sheet's. Recommended defaults
-- chosen under the user's standing approval, 29 October 2026 (docs/runbooks/ai-preparation-sheet.md).
ALTER TABLE "ai_preparation_sheet" ADD COLUMN "recheck_status" "ai_sheet_status";--> statement-breakpoint
ALTER TABLE "ai_preparation_sheet" ADD COLUMN "recheck_reason" text;--> statement-breakpoint
ALTER TABLE "ai_preparation_sheet" ADD COLUMN "recheck_ai_run_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_preparation_sheet" ADD COLUMN "recheck_findings" jsonb;--> statement-breakpoint
ALTER TABLE "ai_preparation_sheet" ADD COLUMN "recheck_by" uuid;--> statement-breakpoint
ALTER TABLE "ai_preparation_sheet" ADD COLUMN "recheck_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ai_preparation_sheet" ADD COLUMN "recheck_ready_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ai_preparation_sheet" ADD CONSTRAINT "ai_preparation_sheet_recheck_ai_run_id_ai_run_id_fk" FOREIGN KEY ("recheck_ai_run_id") REFERENCES "public"."ai_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_preparation_sheet" ADD CONSTRAINT "ai_preparation_sheet_recheck_by_staff_user_id_fk" FOREIGN KEY ("recheck_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_preparation_sheet" ADD CONSTRAINT "ai_preparation_sheet_recheck" CHECK (("ai_preparation_sheet"."recheck_status" is null) = ("ai_preparation_sheet"."recheck_findings" is null)
        and ("ai_preparation_sheet"."recheck_status" is null) = ("ai_preparation_sheet"."recheck_by" is null)
        and ("ai_preparation_sheet"."recheck_status" is null) = ("ai_preparation_sheet"."recheck_claimed_at" is null)
        and ("ai_preparation_sheet"."recheck_status" is null or ("ai_preparation_sheet"."recheck_status" = 'pending') = ("ai_preparation_sheet"."recheck_ready_at" is null))
        and ("ai_preparation_sheet"."recheck_status" is null or ("ai_preparation_sheet"."recheck_status" = 'unavailable') = ("ai_preparation_sheet"."recheck_reason" is not null))
        and ("ai_preparation_sheet"."recheck_reason" is null or "ai_preparation_sheet"."recheck_reason" in ('invalid_output', 'failed', 'timed_out', 'capped', 'blocked', 'not_configured', 'no_region', 'no_form', 'no_valid_suggestions')));
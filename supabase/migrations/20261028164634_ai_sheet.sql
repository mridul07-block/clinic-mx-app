CREATE TYPE "public"."ai_disposition" AS ENUM('kept', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."ai_sheet_status" AS ENUM('pending', 'ready', 'unavailable');--> statement-breakpoint
CREATE TYPE "public"."ai_suggestion_section" AS ENUM('top', 'also_consider');--> statement-breakpoint
CREATE TABLE "ai_preparation_sheet" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"episode_id" uuid NOT NULL,
	"kb_version_id" uuid NOT NULL,
	"status" "ai_sheet_status" NOT NULL,
	"unavailable_reason" text,
	"ai_run_id" uuid,
	"shortlist" jsonb NOT NULL,
	"case" jsonb,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ready_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_preparation_sheet_episode_id_unique" UNIQUE("episode_id"),
	CONSTRAINT "ai_preparation_sheet_reason" CHECK (("ai_preparation_sheet"."status" = 'unavailable') = ("ai_preparation_sheet"."unavailable_reason" is not null)
        and ("ai_preparation_sheet"."unavailable_reason" is null or "ai_preparation_sheet"."unavailable_reason" in ('invalid_output', 'failed', 'timed_out', 'capped', 'blocked', 'not_configured', 'no_region', 'no_form', 'no_valid_suggestions'))),
	CONSTRAINT "ai_preparation_sheet_ready" CHECK (("ai_preparation_sheet"."status" = 'pending') = ("ai_preparation_sheet"."ready_at" is null))
);
--> statement-breakpoint
ALTER TABLE "ai_preparation_sheet" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ai_suggestion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sheet_id" uuid NOT NULL,
	"ai_run_id" uuid NOT NULL,
	"condition_id" text NOT NULL,
	"region" "kb_region" NOT NULL,
	"row_number" integer NOT NULL,
	"rank" smallint NOT NULL,
	"section" "ai_suggestion_section" NOT NULL,
	"reason" text NOT NULL,
	"disposition" "ai_disposition",
	"disposed_by" uuid,
	"disposed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_suggestion_run_condition" UNIQUE("ai_run_id","condition_id"),
	CONSTRAINT "ai_suggestion_run_rank" UNIQUE("ai_run_id","rank"),
	CONSTRAINT "ai_suggestion_condition_id" CHECK ("ai_suggestion"."condition_id" ~ '^[A-Z]{3}-[0-9]{3}$'),
	CONSTRAINT "ai_suggestion_rank" CHECK ("ai_suggestion"."rank" >= 1),
	CONSTRAINT "ai_suggestion_reason" CHECK (length("ai_suggestion"."reason") between 1 and 160),
	CONSTRAINT "ai_suggestion_disposed" CHECK (("ai_suggestion"."disposition" is null) = ("ai_suggestion"."disposed_by" is null)
        and ("ai_suggestion"."disposition" is null) = ("ai_suggestion"."disposed_at" is null))
);
--> statement-breakpoint
ALTER TABLE "ai_suggestion" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_preparation_sheet" ADD CONSTRAINT "ai_preparation_sheet_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_preparation_sheet" ADD CONSTRAINT "ai_preparation_sheet_kb_version_id_kb_version_id_fk" FOREIGN KEY ("kb_version_id") REFERENCES "public"."kb_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_preparation_sheet" ADD CONSTRAINT "ai_preparation_sheet_ai_run_id_ai_run_id_fk" FOREIGN KEY ("ai_run_id") REFERENCES "public"."ai_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_suggestion" ADD CONSTRAINT "ai_suggestion_sheet_id_ai_preparation_sheet_id_fk" FOREIGN KEY ("sheet_id") REFERENCES "public"."ai_preparation_sheet"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_suggestion" ADD CONSTRAINT "ai_suggestion_ai_run_id_ai_run_id_fk" FOREIGN KEY ("ai_run_id") REFERENCES "public"."ai_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_suggestion" ADD CONSTRAINT "ai_suggestion_disposed_by_staff_user_id_fk" FOREIGN KEY ("disposed_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_suggestion_sheet_idx" ON "ai_suggestion" USING btree ("sheet_id");
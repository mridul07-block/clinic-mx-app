CREATE TYPE "public"."ai_run_status" AS ENUM('ok', 'invalid_output', 'failed', 'timed_out', 'capped', 'blocked', 'not_configured');--> statement-breakpoint
CREATE TYPE "public"."ai_task" AS ENUM('rank_diagnoses', 'recheck_with_findings', 'assistant_reply', 'tag_feedback');--> statement-breakpoint
CREATE TABLE "ai_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "ai_task" NOT NULL,
	"episode_id" uuid,
	"kb_version_id" uuid,
	"model" text,
	"provider" text,
	"prompt_version" text NOT NULL,
	"input_hash" text NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output" jsonb,
	"status" "ai_run_status" NOT NULL,
	"attempts" smallint NOT NULL,
	"latency_ms" integer NOT NULL,
	"cost_micro_usd" bigint,
	"tokens_in" integer,
	"tokens_out" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_run_input_hash" CHECK ("ai_run"."input_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "ai_run_attempts" CHECK ("ai_run"."attempts" between 0 and 2),
	CONSTRAINT "ai_run_latency" CHECK ("ai_run"."latency_ms" >= 0),
	CONSTRAINT "ai_run_cost" CHECK ("ai_run"."cost_micro_usd" is null or "ai_run"."cost_micro_usd" >= 0),
	CONSTRAINT "ai_run_clinical_version" CHECK ("ai_run"."kind" not in ('rank_diagnoses', 'recheck_with_findings') or "ai_run"."kb_version_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "ai_run" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_run" ADD CONSTRAINT "ai_run_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_run" ADD CONSTRAINT "ai_run_kb_version_id_kb_version_id_fk" FOREIGN KEY ("kb_version_id") REFERENCES "public"."kb_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_run_created_at_idx" ON "ai_run" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_run_episode_idx" ON "ai_run" USING btree ("episode_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_open_ai_spend_cap_key" ON "task" USING btree ("kind") WHERE "task"."kind" = 'ai.spend_cap' and "task"."status" = 'open';
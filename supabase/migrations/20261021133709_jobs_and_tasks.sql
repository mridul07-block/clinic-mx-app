CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."task_priority" AS ENUM('urgent', 'high', 'normal');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TABLE "job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"idempotency_key" text,
	"last_error" text,
	"claimed_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "job_attempts_not_negative" CHECK ("job"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "job" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "task" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"priority" "task_priority" DEFAULT 'normal' NOT NULL,
	"status" "task_status" DEFAULT 'open' NOT NULL,
	"assignee_role" "staff_role",
	"assignee_staff_user_id" uuid,
	"due_at" timestamp with time zone,
	"decision" text,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_has_assignee" CHECK ("task"."assignee_role" is not null or "task"."assignee_staff_user_id" is not null),
	CONSTRAINT "task_closed_with_decision" CHECK ("task"."status" <> 'closed' or ("task"."decision" is not null and "task"."closed_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "task" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_assignee_staff_user_id_staff_user_id_fk" FOREIGN KEY ("assignee_staff_user_id") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_closed_by_staff_user_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_due_idx" ON "job" USING btree ("run_at") WHERE "job"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "task_open_role_idx" ON "task" USING btree ("assignee_role") WHERE "task"."status" = 'open';
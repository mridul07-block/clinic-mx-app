-- PAT-10 review: the follow ups after discharge, fixed at discharge. Rules in
-- follow_up_schedule_rules.sql.
CREATE TABLE "follow_up_schedule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"episode_id" uuid NOT NULL,
	"follow_up" text NOT NULL,
	"due_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "follow_up_schedule_interval" CHECK ("follow_up_schedule"."follow_up" ~ '^[0-9]+_(week|month)$')
);
--> statement-breakpoint
ALTER TABLE "follow_up_schedule" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "follow_up_schedule" ADD CONSTRAINT "follow_up_schedule_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "follow_up_schedule_episode_interval" ON "follow_up_schedule" USING btree ("episode_id","follow_up");
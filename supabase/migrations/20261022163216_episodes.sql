CREATE TYPE "public"."discharge_reason" AS ENUM('goals_achieved', 'independent_management', 'referred_on', 'patient_choice', 'financial_or_logistical', 'lost_to_follow_up', 'other');--> statement-breakpoint
CREATE TYPE "public"."episode_status" AS ENUM('intake_pending', 'awaiting_consultation', 'on_hold', 'plan_proposed', 'active', 'under_review', 'discharged', 'lost_to_follow_up');--> statement-breakpoint
CREATE TABLE "episode" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"centre_id" uuid NOT NULL,
	"body_region" "screening_region",
	"status" "episode_status" DEFAULT 'intake_pending' NOT NULL,
	"paused_from" "episode_status",
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"discharge_reason" "discharge_reason",
	"discharge_note" text,
	"linked_episode_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "episode_discharged_closed" CHECK (("episode"."status" = 'discharged') = ("episode"."closed_at" is not null and "episode"."discharge_reason" is not null)),
	CONSTRAINT "episode_other_note" CHECK ("episode"."discharge_reason" is distinct from 'other' or btrim(coalesce("episode"."discharge_note", '')) <> ''),
	CONSTRAINT "episode_paused_from" CHECK (("episode"."status" in ('on_hold', 'lost_to_follow_up')) = ("episode"."paused_from" is not null))
);
--> statement-breakpoint
ALTER TABLE "episode" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "episode" ADD CONSTRAINT "episode_patient_id_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patient"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode" ADD CONSTRAINT "episode_centre_id_centre_id_fk" FOREIGN KEY ("centre_id") REFERENCES "public"."centre"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode" ADD CONSTRAINT "episode_linked_episode_id_episode_id_fk" FOREIGN KEY ("linked_episode_id") REFERENCES "public"."episode"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "episode_patient_idx" ON "episode" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "episode_centre_status_idx" ON "episode" USING btree ("centre_id","status");
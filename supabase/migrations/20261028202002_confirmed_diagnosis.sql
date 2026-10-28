-- AI-05: the diagnosis confirmed at review or discharge, the learning label (PRD section 6). Its
-- rules are in confirmed_diagnosis_rules.sql.
CREATE TYPE "public"."confirmed_diagnosis_stage" AS ENUM('review', 'discharge');--> statement-breakpoint
CREATE TABLE "confirmed_diagnosis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"episode_id" uuid NOT NULL,
	"source_diagnosis_id" uuid NOT NULL,
	"kb_version_id" uuid NOT NULL,
	"condition_id" text NOT NULL,
	"stage" "confirmed_diagnosis_stage" NOT NULL,
	"confirmed_by" uuid NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "confirmed_diagnosis" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "confirmed_diagnosis" ADD CONSTRAINT "confirmed_diagnosis_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmed_diagnosis" ADD CONSTRAINT "confirmed_diagnosis_source_diagnosis_id_diagnosis_id_fk" FOREIGN KEY ("source_diagnosis_id") REFERENCES "public"."diagnosis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmed_diagnosis" ADD CONSTRAINT "confirmed_diagnosis_kb_version_id_kb_version_id_fk" FOREIGN KEY ("kb_version_id") REFERENCES "public"."kb_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmed_diagnosis" ADD CONSTRAINT "confirmed_diagnosis_confirmed_by_staff_user_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmed_diagnosis" ADD CONSTRAINT "confirmed_diagnosis_condition_fkey" FOREIGN KEY ("kb_version_id","condition_id") REFERENCES "public"."kb_condition"("kb_version_id","condition_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "confirmed_diagnosis_episode_idx" ON "confirmed_diagnosis" USING btree ("episode_id","confirmed_at");
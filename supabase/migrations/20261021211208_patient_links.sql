CREATE TYPE "public"."patient_link_purpose" AS ENUM('health_form', 'consent', 'questionnaire', 'feedback', 'my_plan');--> statement-breakpoint
CREATE TABLE "patient_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"purpose" "patient_link_purpose" NOT NULL,
	"appointment_id" uuid,
	"episode_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patient_link_one_subject" CHECK (num_nonnulls("patient_link"."appointment_id", "patient_link"."episode_id") = 1),
	CONSTRAINT "patient_link_subject_fits" CHECK (("patient_link"."purpose" <> 'health_form' or "patient_link"."appointment_id" is not null)
        and ("patient_link"."purpose" not in ('questionnaire', 'my_plan') or "patient_link"."episode_id" is not null)),
	CONSTRAINT "patient_link_window" CHECK ("patient_link"."expires_at" > "patient_link"."created_at")
);
--> statement-breakpoint
ALTER TABLE "patient_link" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "patient_link_patient_idx" ON "patient_link" USING btree ("patient_id","purpose");
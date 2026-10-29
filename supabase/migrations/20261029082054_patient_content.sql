CREATE TYPE "public"."patient_content_source" AS ENUM('clinician', 'ai');--> statement-breakpoint
CREATE TYPE "public"."patient_content_status" AS ENUM('draft', 'approved', 'superseded');--> statement-breakpoint
CREATE TABLE "kb_patient_content" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"condition_id" text NOT NULL,
	"kb_version_id" uuid NOT NULL,
	"explanation" text NOT NULL,
	"roadmap" text NOT NULL,
	"home_advice" text NOT NULL,
	"warning_signs" text NOT NULL,
	"source" "patient_content_source" NOT NULL,
	"status" "patient_content_status" DEFAULT 'draft' NOT NULL,
	"written_by" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_patient_content_condition" CHECK ("kb_patient_content"."condition_id" ~ '^[A-Z]{2,4}-[0-9]{3}$'),
	CONSTRAINT "kb_patient_content_approval" CHECK (("kb_patient_content"."status" = 'draft') = ("kb_patient_content"."approved_by" is null and "kb_patient_content"."approved_at" is null)),
	CONSTRAINT "kb_patient_content_lengths" CHECK (length(trim("kb_patient_content"."explanation")) between 1 and 4000
        and length(trim("kb_patient_content"."roadmap")) between 1 and 4000
        and length(trim("kb_patient_content"."home_advice")) between 1 and 4000
        and length(trim("kb_patient_content"."warning_signs")) between 1 and 4000)
);
--> statement-breakpoint
ALTER TABLE "kb_patient_content" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "kb_patient_content" ADD CONSTRAINT "kb_patient_content_kb_version_id_kb_version_id_fk" FOREIGN KEY ("kb_version_id") REFERENCES "public"."kb_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_patient_content" ADD CONSTRAINT "kb_patient_content_written_by_staff_user_id_fk" FOREIGN KEY ("written_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_patient_content" ADD CONSTRAINT "kb_patient_content_approved_by_staff_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "kb_patient_content_one_draft" ON "kb_patient_content" USING btree ("condition_id") WHERE "kb_patient_content"."status" = 'draft';--> statement-breakpoint
CREATE UNIQUE INDEX "kb_patient_content_one_approved" ON "kb_patient_content" USING btree ("condition_id") WHERE "kb_patient_content"."status" = 'approved';--> statement-breakpoint
CREATE INDEX "kb_patient_content_condition_idx" ON "kb_patient_content" USING btree ("condition_id","created_at");
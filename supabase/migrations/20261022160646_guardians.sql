CREATE TYPE "public"."guardian_relationship" AS ENUM('mother', 'father', 'legal_guardian', 'other_relative');--> statement-breakpoint
CREATE TABLE "guardian" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"name" text NOT NULL,
	"relationship" "guardian_relationship" NOT NULL,
	"phone" text NOT NULL,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guardian_phone_e164" CHECK ("guardian"."phone" ~ '^\+91[1-9][0-9]{9}$'),
	CONSTRAINT "guardian_name_present" CHECK (btrim("guardian"."name") <> '')
);
--> statement-breakpoint
ALTER TABLE "guardian" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "guardian" ADD CONSTRAINT "guardian_patient_id_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patient"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guardian_patient_idx" ON "guardian" USING btree ("patient_id");
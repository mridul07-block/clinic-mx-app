CREATE TABLE "patient_report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"appointment_id" uuid,
	"file_path" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patient_report_file_path_unique" UNIQUE("file_path"),
	CONSTRAINT "patient_report_content_type" CHECK ("patient_report"."content_type" in ('image/jpeg', 'image/png', 'application/pdf')),
	CONSTRAINT "patient_report_size" CHECK ("patient_report"."size_bytes" > 0)
);
--> statement-breakpoint
ALTER TABLE "patient_report" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "appointment" DROP CONSTRAINT "appointment_arrived";--> statement-breakpoint
ALTER TABLE "appointment" ADD COLUMN "checked_in_by" uuid;--> statement-breakpoint
ALTER TABLE "patient_report" ADD CONSTRAINT "patient_report_patient_id_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patient"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_report" ADD CONSTRAINT "patient_report_appointment_id_appointment_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_report" ADD CONSTRAINT "patient_report_uploaded_by_staff_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "patient_report_patient_idx" ON "patient_report" USING btree ("patient_id","created_at");--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_checked_in_by_staff_user_id_fk" FOREIGN KEY ("checked_in_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- NOT VALID: enforced for every write from now on; patients checked in before INT-02 have no
-- record of who checked them in.
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_arrived" CHECK (("appointment"."status" <> 'checked_in' or "appointment"."arrived_at" is not null) and ("appointment"."arrived_at" is null) = ("appointment"."checked_in_by" is null)) NOT VALID;
ALTER TABLE "patient_report" ALTER COLUMN "uploaded_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "patient_report" ADD COLUMN "patient_link_id" uuid;--> statement-breakpoint
ALTER TABLE "patient_report" ADD CONSTRAINT "patient_report_patient_link_id_patient_link_id_fk" FOREIGN KEY ("patient_link_id") REFERENCES "public"."patient_link"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_report" ADD CONSTRAINT "patient_report_uploader" CHECK (("patient_report"."uploaded_by" is null) <> ("patient_report"."patient_link_id" is null));
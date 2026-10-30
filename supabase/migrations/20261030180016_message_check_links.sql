ALTER TABLE "patient_link" DROP CONSTRAINT "patient_link_subject_fits";--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "patient_link_id" uuid;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "source_key" text;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_patient_link_id_patient_link_id_fk" FOREIGN KEY ("patient_link_id") REFERENCES "public"."patient_link"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_patient_link_idx" ON "message" USING btree ("patient_link_id") WHERE "message"."patient_link_id" is not null;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_source_key_unique" UNIQUE("source_key");--> statement-breakpoint
ALTER TABLE "patient_link" ADD CONSTRAINT "patient_link_subject_fits" CHECK (("patient_link"."purpose" <> 'health_form' or "patient_link"."appointment_id" is not null)
        and ("patient_link"."purpose" not in ('questionnaire', 'my_plan', 'follow_up', 'review') or "patient_link"."episode_id" is not null));
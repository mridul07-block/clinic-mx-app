ALTER TABLE "intake_response" ADD COLUMN "carried_from_id" uuid;--> statement-breakpoint
ALTER TABLE "intake_response" ADD COLUMN "details_changed" boolean;--> statement-breakpoint
ALTER TABLE "intake_response" ADD CONSTRAINT "intake_response_carried_from_id_intake_response_id_fk" FOREIGN KEY ("carried_from_id") REFERENCES "public"."intake_response"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "intake_response_patient_submitted" ON "intake_response" USING btree ("patient_id","submitted_at");--> statement-breakpoint
ALTER TABLE "intake_response" ADD CONSTRAINT "intake_response_details_review" CHECK (("intake_response"."carried_from_id" is null) = ("intake_response"."details_changed" is null));
-- AI-05: similar confirmed cases. The sheet keeps the cases it sent (structured fields only, no IDs;
-- null on a sheet made before them), and each episode's latest submitted form is found by index.
ALTER TABLE "ai_preparation_sheet" ADD COLUMN "similar" jsonb;--> statement-breakpoint
CREATE INDEX "intake_response_episode_submitted" ON "intake_response" USING btree ("episode_id","submitted_at");
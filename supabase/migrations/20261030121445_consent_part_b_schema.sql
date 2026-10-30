ALTER TABLE "consent_record" ADD COLUMN "shown_text" text;--> statement-breakpoint
CREATE UNIQUE INDEX "task_open_part_b_declined_key" ON "task" USING btree ("episode_id") WHERE "task"."kind" = 'consent.part_b_declined' and "task"."status" <> 'closed';--> statement-breakpoint
CREATE INDEX "consent_record_episode_idx" ON "consent_record" USING btree ("episode_id","stage","statement_key");
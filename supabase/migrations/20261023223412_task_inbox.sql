ALTER TABLE "task" ADD COLUMN "taken_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "centre_id" uuid;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "patient_id" uuid;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "episode_id" uuid;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_centre_id_centre_id_fk" FOREIGN KEY ("centre_id") REFERENCES "public"."centre"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_patient_id_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patient"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_open_assignee_idx" ON "task" USING btree ("assignee_staff_user_id") WHERE "task"."status" = 'open';--> statement-breakpoint
CREATE INDEX "task_closed_at_idx" ON "task" USING btree ("closed_at");
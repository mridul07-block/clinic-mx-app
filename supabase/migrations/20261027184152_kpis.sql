ALTER TABLE "episode" ADD COLUMN "plan_proposed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "episode" ADD COLUMN "activated_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "episode_plan_proposed_idx" ON "episode" USING btree ("plan_proposed_at");--> statement-breakpoint
CREATE INDEX "episode_closed_idx" ON "episode" USING btree ("closed_at");
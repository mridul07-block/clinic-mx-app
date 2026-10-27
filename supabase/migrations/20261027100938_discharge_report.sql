ALTER TABLE "episode" ADD COLUMN "discharge_goals" jsonb;--> statement-breakpoint
ALTER TABLE "episode" ADD COLUMN "discharge_ongoing_needs" text;--> statement-breakpoint
ALTER TABLE "episode" ADD COLUMN "discharge_recommendations" text;--> statement-breakpoint
ALTER TABLE "episode" ADD CONSTRAINT "episode_discharge_report" CHECK ("episode"."status" = 'discharged' or ("episode"."discharge_goals" is null and "episode"."discharge_ongoing_needs" is null and "episode"."discharge_recommendations" is null));
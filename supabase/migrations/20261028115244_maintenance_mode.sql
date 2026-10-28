ALTER TABLE "episode" ADD COLUMN "discharge_return_plan" text;--> statement-breakpoint
ALTER TABLE "episode" ADD COLUMN "discharge_flare_plan" text;--> statement-breakpoint
ALTER TABLE "episode" ADD CONSTRAINT "episode_discharge_plans" CHECK ("episode"."status" = 'discharged' or ("episode"."discharge_return_plan" is null and "episode"."discharge_flare_plan" is null));
ALTER TABLE "plan_of_care" ADD COLUMN "investigations_advised" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_of_care" ADD COLUMN "referral_advised" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "generation_key" text;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_generation_key_unique" UNIQUE("generation_key");
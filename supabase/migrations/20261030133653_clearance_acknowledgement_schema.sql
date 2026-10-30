ALTER TABLE "consent_record" DROP CONSTRAINT "consent_record_stage";--> statement-breakpoint
ALTER TABLE "clearance" ADD COLUMN "patient_plan" text;--> statement-breakpoint
ALTER TABLE "clearance" ADD COLUMN "warning_signs" text;--> statement-breakpoint
ALTER TABLE "clearance" ADD COLUMN "residual_risk" text;--> statement-breakpoint
ALTER TABLE "consent_record" ADD CONSTRAINT "consent_record_stage" CHECK ("consent_record"."stage" in ('A', 'B', 'C'));
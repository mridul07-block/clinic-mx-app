CREATE TYPE "public"."questionnaire_licence" AS ENUM('unconfirmed', 'free', 'licensed');--> statement-breakpoint
ALTER TABLE "kb_questionnaire" ADD COLUMN "definition" jsonb;--> statement-breakpoint
ALTER TABLE "kb_questionnaire" ADD COLUMN "licence" "questionnaire_licence" DEFAULT 'unconfirmed' NOT NULL;--> statement-breakpoint
ALTER TABLE "kb_questionnaire" ADD COLUMN "signed_off" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "kb_questionnaire" ADD CONSTRAINT "kb_questionnaire_sign_off" CHECK (not "kb_questionnaire"."signed_off" or ("kb_questionnaire"."definition" is not null and "kb_questionnaire"."licence" <> 'unconfirmed'));
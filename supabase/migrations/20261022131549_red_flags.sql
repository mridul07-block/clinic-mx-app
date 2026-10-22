CREATE TYPE "public"."kb_red_flag_row_kind" AS ENUM('presentation', 'screening_note');--> statement-breakpoint
CREATE TYPE "public"."red_flag_triage" AS ENUM('immediate_emergency', 'urgent_medical_referral', 'urgent_imaging', 'specialist_referral', 'monitor_with_caution');--> statement-breakpoint
CREATE TYPE "public"."screening_region" AS ENUM('back', 'neck', 'shoulder', 'elbow', 'wrist_hand', 'hip', 'knee', 'foot_ankle');--> statement-breakpoint
CREATE TABLE "kb_red_flag_presentation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kb_version_id" uuid NOT NULL,
	"region" "kb_region" NOT NULL,
	"row_number" integer NOT NULL,
	"kind" "kb_red_flag_row_kind" NOT NULL,
	"presentation" text NOT NULL,
	"features" text,
	"action" text,
	"why" text,
	CONSTRAINT "kb_red_flag_presentation_row_key" UNIQUE("kb_version_id","region","row_number"),
	CONSTRAINT "kb_red_flag_presentation_kind" CHECK ("kb_red_flag_presentation"."kind" = 'screening_note' or ("kb_red_flag_presentation"."features" is not null and "kb_red_flag_presentation"."action" is not null))
);
--> statement-breakpoint
ALTER TABLE "kb_red_flag_presentation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "kb_red_flag_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kb_version_id" uuid NOT NULL,
	"rule_key" text NOT NULL,
	"name" text NOT NULL,
	"regions" "screening_region"[] DEFAULT '{}'::screening_region[] NOT NULL,
	"trigger" jsonb NOT NULL,
	"triage" "red_flag_triage" NOT NULL,
	"action" text NOT NULL,
	"source" text NOT NULL,
	"signed_off" boolean NOT NULL,
	CONSTRAINT "kb_red_flag_rule_version_key" UNIQUE("kb_version_id","rule_key"),
	CONSTRAINT "kb_red_flag_rule_key" CHECK ("kb_red_flag_rule"."rule_key" ~ '^[a-z][a-z0-9_.]*$')
);
--> statement-breakpoint
ALTER TABLE "kb_red_flag_rule" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "kb_red_flag_presentation" ADD CONSTRAINT "kb_red_flag_presentation_kb_version_id_kb_version_id_fk" FOREIGN KEY ("kb_version_id") REFERENCES "public"."kb_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_red_flag_rule" ADD CONSTRAINT "kb_red_flag_rule_kb_version_id_kb_version_id_fk" FOREIGN KEY ("kb_version_id") REFERENCES "public"."kb_version"("id") ON DELETE no action ON UPDATE no action;
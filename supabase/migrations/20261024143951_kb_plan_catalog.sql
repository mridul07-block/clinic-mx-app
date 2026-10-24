CREATE TABLE "kb_modality" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kb_version_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"precautions" jsonb NOT NULL,
	"signed_off" boolean NOT NULL,
	"sort" integer NOT NULL,
	CONSTRAINT "kb_modality_version_key" UNIQUE("kb_version_id","key"),
	CONSTRAINT "kb_modality_key" CHECK ("kb_modality"."key" ~ '^[a-z][a-z0-9_]*$')
);
--> statement-breakpoint
ALTER TABLE "kb_modality" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "kb_questionnaire" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kb_version_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"regions" "kb_region"[] DEFAULT '{}'::kb_region[] NOT NULL,
	"use_for" text NOT NULL,
	"sort" integer NOT NULL,
	CONSTRAINT "kb_questionnaire_version_key" UNIQUE("kb_version_id","key"),
	CONSTRAINT "kb_questionnaire_key" CHECK ("kb_questionnaire"."key" ~ '^[a-z][a-z0-9_]*$')
);
--> statement-breakpoint
ALTER TABLE "kb_questionnaire" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "kb_modality" ADD CONSTRAINT "kb_modality_kb_version_id_kb_version_id_fk" FOREIGN KEY ("kb_version_id") REFERENCES "public"."kb_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_questionnaire" ADD CONSTRAINT "kb_questionnaire_kb_version_id_kb_version_id_fk" FOREIGN KEY ("kb_version_id") REFERENCES "public"."kb_version"("id") ON DELETE no action ON UPDATE no action;
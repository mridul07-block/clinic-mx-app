CREATE TYPE "public"."template_approval_status" AS ENUM('pending', 'approved', 'rejected', 'paused', 'disabled');--> statement-breakpoint
CREATE TABLE "whatsapp_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"version" smallint NOT NULL,
	"language" text NOT NULL,
	"meta_name" text NOT NULL,
	"meta_id" text NOT NULL,
	"category" text NOT NULL,
	"status" "template_approval_status" DEFAULT 'pending' NOT NULL,
	"reason" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_template_meta_id_unique" UNIQUE("meta_id"),
	CONSTRAINT "whatsapp_template_version" UNIQUE("key","version","language"),
	CONSTRAINT "whatsapp_template_meta_name" UNIQUE("meta_name","language"),
	CONSTRAINT "whatsapp_template_version_positive" CHECK ("whatsapp_template"."version" >= 1),
	CONSTRAINT "whatsapp_template_meta_name_format" CHECK ("whatsapp_template"."meta_name" = "whatsapp_template"."key" || '_v' || "whatsapp_template"."version"),
	CONSTRAINT "whatsapp_template_key" CHECK ("whatsapp_template"."key" ~ '^[a-z][a-z0-9_]*$'),
	CONSTRAINT "whatsapp_template_language" CHECK ("whatsapp_template"."language" ~ '^[a-z]{2,3}(_[A-Z]{2})?$'),
	CONSTRAINT "whatsapp_template_meta_id" CHECK ("whatsapp_template"."meta_id" ~ '^[0-9]+$')
);
--> statement-breakpoint
ALTER TABLE "whatsapp_template" ENABLE ROW LEVEL SECURITY;
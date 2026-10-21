CREATE TABLE "setting" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "setting_key_format" CHECK ("setting"."key" ~ '^[a-z]+[.][a-z0-9_]+$')
);
--> statement-breakpoint
ALTER TABLE "setting" ENABLE ROW LEVEL SECURITY;
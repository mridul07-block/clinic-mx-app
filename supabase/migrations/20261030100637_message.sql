CREATE TYPE "public"."message_direction" AS ENUM('outbound');--> statement-breakpoint
CREATE TYPE "public"."message_kind" AS ENUM('template', 'test');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('queued', 'sent', 'failed', 'skipped');--> statement-breakpoint
CREATE TABLE "message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid,
	"to_phone" text NOT NULL,
	"kind" "message_kind" NOT NULL,
	"direction" "message_direction" DEFAULT 'outbound' NOT NULL,
	"template_key" text NOT NULL,
	"template_version" smallint NOT NULL,
	"language" text NOT NULL,
	"variables" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "message_status" DEFAULT 'queued' NOT NULL,
	"wa_message_id" text,
	"error_code" text,
	"error_title" text,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"status_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_wa_message_id_unique" UNIQUE("wa_message_id"),
	CONSTRAINT "message_to_phone" CHECK ("message"."to_phone" ~ '^\+[1-9][0-9]{7,14}$'),
	CONSTRAINT "message_sent" CHECK (("message"."status" = 'sent') = ("message"."wa_message_id" is not null and "message"."sent_at" is not null)),
	CONSTRAINT "message_test" CHECK ("message"."kind" <> 'test' or "message"."patient_id" is null),
	CONSTRAINT "message_attempts" CHECK ("message"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "message" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_patient_id_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patient"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_created_at_idx" ON "message" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "message_patient_idx" ON "message" USING btree ("patient_id");
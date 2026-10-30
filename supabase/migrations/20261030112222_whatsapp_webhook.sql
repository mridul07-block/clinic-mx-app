-- WA-02: the WhatsApp webhook (TAD section 6). Inbound messages and delivery statuses join
-- `message`; the raw body Meta signed is kept in `whatsapp_event` until handled, then for
-- `whatsapp.event_retention_days`. The new enum values are used only from the next migration
-- (Postgres does not allow a value in the transaction that added it).
ALTER TYPE "public"."message_direction" ADD VALUE 'inbound';--> statement-breakpoint
ALTER TYPE "public"."message_kind" ADD VALUE 'text';--> statement-breakpoint
ALTER TYPE "public"."message_kind" ADD VALUE 'reply';--> statement-breakpoint
ALTER TYPE "public"."message_kind" ADD VALUE 'flow';--> statement-breakpoint
ALTER TYPE "public"."message_kind" ADD VALUE 'other';--> statement-breakpoint
ALTER TYPE "public"."message_status" ADD VALUE 'delivered';--> statement-breakpoint
ALTER TYPE "public"."message_status" ADD VALUE 'read';--> statement-breakpoint
ALTER TYPE "public"."message_status" ADD VALUE 'received';--> statement-breakpoint
CREATE TABLE "whatsapp_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "whatsapp_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "message" DROP CONSTRAINT "message_sent";--> statement-breakpoint
ALTER TABLE "message" ALTER COLUMN "to_phone" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "message" ALTER COLUMN "template_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "message" ALTER COLUMN "template_version" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "message" ALTER COLUMN "language" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "from_phone" text;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "body" text;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "reply_id" text;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "reply_payload" jsonb;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "context_wa_id" text;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "read_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "whatsapp_event_processed_at_idx" ON "whatsapp_event" USING btree ("processed_at");--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_from_phone" CHECK ("message"."from_phone" ~ '^\+[1-9][0-9]{7,14}$');
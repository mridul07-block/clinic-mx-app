-- WA-03: the conversation router. Inbound messages get a route; the router's own replies are
-- outbound messages of kind `session`. The new enum value is used only from the next migration.
CREATE TYPE "public"."message_route" AS ENUM('emergency', 'menu', 'talk', 'book', 'reschedule', 'confirm', 'booking_flow', 'reschedule_flow', 'assistant');--> statement-breakpoint
ALTER TYPE "public"."message_kind" ADD VALUE 'session' BEFORE 'text';--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "route" "message_route";--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "routed_at" timestamp with time zone;
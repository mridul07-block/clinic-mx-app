-- WA-04: the WhatsApp Flow a person has open; its id is the Flow token.
CREATE TABLE "whatsapp_flow_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" text NOT NULL,
	"kind" text NOT NULL,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"appointment_id" uuid,
	CONSTRAINT "whatsapp_flow_session_phone" CHECK ("whatsapp_flow_session"."phone" ~ '^\+[1-9][0-9]{7,14}$'),
	CONSTRAINT "whatsapp_flow_session_kind" CHECK ("whatsapp_flow_session"."kind" in ('booking')),
	CONSTRAINT "whatsapp_flow_session_expiry" CHECK ("whatsapp_flow_session"."expires_at" > "whatsapp_flow_session"."created_at")
);
--> statement-breakpoint
ALTER TABLE "whatsapp_flow_session" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "whatsapp_flow_session" ADD CONSTRAINT "whatsapp_flow_session_appointment_id_appointment_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "whatsapp_flow_session_created_at_idx" ON "whatsapp_flow_session" USING btree ("created_at");
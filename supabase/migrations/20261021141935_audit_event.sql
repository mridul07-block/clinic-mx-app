CREATE TYPE "public"."audit_action" AS ENUM('insert', 'update', 'delete', 'view');--> statement-breakpoint
CREATE TABLE "audit_event" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor" text NOT NULL,
	"action" "audit_action" NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	CONSTRAINT "audit_event_actor_format" CHECK ("audit_event"."actor" ~ '^(staff|patient):[0-9a-f-]{36}$|^system:[a-z0-9._-]+$')
);
--> statement-breakpoint
ALTER TABLE "audit_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "audit_event_entity_idx" ON "audit_event" USING btree ("entity","entity_id","at");--> statement-breakpoint
CREATE INDEX "audit_event_actor_idx" ON "audit_event" USING btree ("actor","at");
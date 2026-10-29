CREATE TYPE "public"."data_request_kind" AS ENUM('export', 'correction', 'deletion');--> statement-breakpoint
CREATE TYPE "public"."data_request_status" AS ENUM('open', 'done', 'declined');--> statement-breakpoint
CREATE TABLE "data_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"kind" "data_request_kind" NOT NULL,
	"received_on" date NOT NULL,
	"due_on" date NOT NULL,
	"details" text NOT NULL,
	"status" "data_request_status" DEFAULT 'open' NOT NULL,
	"outcome" text,
	"recorded_by" uuid NOT NULL,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_request_due_after_received" CHECK ("data_request"."due_on" >= "data_request"."received_on"),
	CONSTRAINT "data_request_details_length" CHECK (char_length("data_request"."details") BETWEEN 1 AND 2000),
	CONSTRAINT "data_request_closed" CHECK (("data_request"."status" = 'open') = ("data_request"."closed_at" IS NULL)
        AND ("data_request"."status" = 'open') = ("data_request"."closed_by" IS NULL)
        AND ("data_request"."status" = 'open' OR char_length(coalesce("data_request"."outcome", '')) BETWEEN 1 AND 2000))
);
--> statement-breakpoint
ALTER TABLE "data_request" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "data_request" ADD CONSTRAINT "data_request_patient_id_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patient"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_request" ADD CONSTRAINT "data_request_recorded_by_staff_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_request" ADD CONSTRAINT "data_request_closed_by_staff_user_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "data_request_open_idx" ON "data_request" USING btree ("status","due_on");--> statement-breakpoint
CREATE INDEX "data_request_patient_idx" ON "data_request" USING btree ("patient_id");
CREATE TABLE "intake_response" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"patient_link_id" uuid NOT NULL,
	"form_version" text NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"done_screens" text[] DEFAULT '{}'::text[] NOT NULL,
	"submitted_at" timestamp with time zone,
	"assisted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "intake_response_appointment_id_unique" UNIQUE("appointment_id")
);
--> statement-breakpoint
ALTER TABLE "intake_response" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "intake_response" ADD CONSTRAINT "intake_response_appointment_id_appointment_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_response" ADD CONSTRAINT "intake_response_patient_id_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patient"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_response" ADD CONSTRAINT "intake_response_assisted_by_staff_user_id_fk" FOREIGN KEY ("assisted_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;
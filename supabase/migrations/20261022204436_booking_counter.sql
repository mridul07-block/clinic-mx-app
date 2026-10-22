CREATE TABLE "booking_counter" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"reschedules" integer DEFAULT 0 NOT NULL,
	"no_shows" integer DEFAULT 0 NOT NULL,
	"lifted_at" timestamp with time zone,
	"lifted_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_counter_patient_id_unique" UNIQUE("patient_id"),
	CONSTRAINT "booking_counter_counts" CHECK ("booking_counter"."reschedules" >= 0 and "booking_counter"."no_shows" >= 0),
	CONSTRAINT "booking_counter_lifted" CHECK (("booking_counter"."lifted_at" is null) = ("booking_counter"."lifted_by" is null))
);
--> statement-breakpoint
ALTER TABLE "booking_counter" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "booking_counter" ADD CONSTRAINT "booking_counter_patient_id_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patient"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_counter" ADD CONSTRAINT "booking_counter_lifted_by_staff_user_id_fk" FOREIGN KEY ("lifted_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;
CREATE TABLE "plan_booking" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"episode_id" uuid NOT NULL,
	"centre_id" uuid NOT NULL,
	"physio_id" uuid NOT NULL,
	"appointment_type_id" uuid NOT NULL,
	"from_date" date NOT NULL,
	"weekdays" integer[] NOT NULL,
	"time" text NOT NULL,
	"booked_by" uuid NOT NULL,
	"booked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_booking_time" CHECK ("plan_booking"."time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "plan_booking_weekdays" CHECK (cardinality("plan_booking"."weekdays") between 1 and 7 and "plan_booking"."weekdays" <@ array[1,2,3,4,5,6,7])
);
--> statement-breakpoint
ALTER TABLE "plan_booking" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "appointment" ADD COLUMN "plan_booking_id" uuid;--> statement-breakpoint
ALTER TABLE "plan_booking" ADD CONSTRAINT "plan_booking_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_booking" ADD CONSTRAINT "plan_booking_centre_id_centre_id_fk" FOREIGN KEY ("centre_id") REFERENCES "public"."centre"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_booking" ADD CONSTRAINT "plan_booking_physio_id_staff_user_id_fk" FOREIGN KEY ("physio_id") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_booking" ADD CONSTRAINT "plan_booking_appointment_type_id_appointment_type_id_fk" FOREIGN KEY ("appointment_type_id") REFERENCES "public"."appointment_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_booking" ADD CONSTRAINT "plan_booking_booked_by_staff_user_id_fk" FOREIGN KEY ("booked_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_booking_episode_idx" ON "plan_booking" USING btree ("episode_id","booked_at");--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_plan_booking_id_plan_booking_id_fk" FOREIGN KEY ("plan_booking_id") REFERENCES "public"."plan_booking"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointment_plan_booking_idx" ON "appointment" USING btree ("plan_booking_id");
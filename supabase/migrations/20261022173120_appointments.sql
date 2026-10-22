CREATE TYPE "public"."appointment_status" AS ENUM('booked', 'confirmed', 'checked_in', 'in_progress', 'completed', 'cancelled', 'rescheduled', 'no_show');--> statement-breakpoint
CREATE TYPE "public"."booking_channel" AS ENUM('whatsapp', 'front_desk');--> statement-breakpoint
ALTER TYPE "public"."centre_sequence_kind" ADD VALUE 'appointment';--> statement-breakpoint
CREATE TABLE "appointment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"patient_id" uuid NOT NULL,
	"centre_id" uuid NOT NULL,
	"physio_id" uuid NOT NULL,
	"appointment_type_id" uuid NOT NULL,
	"episode_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "appointment_status" DEFAULT 'booked' NOT NULL,
	"channel" "booking_channel" NOT NULL,
	"booked_by" uuid,
	"machine" text,
	"machine_unit" integer,
	"confirmed_at" timestamp with time zone,
	"arrived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointment_number_unique" UNIQUE("number"),
	CONSTRAINT "appointment_span" CHECK ("appointment"."ends_at" > "appointment"."starts_at"),
	CONSTRAINT "appointment_front_desk_booked_by" CHECK ("appointment"."channel" <> 'front_desk' or "appointment"."booked_by" is not null),
	CONSTRAINT "appointment_machine" CHECK ("appointment"."machine" is null or "appointment"."machine" in ('zero_gravity_treadmill')),
	CONSTRAINT "appointment_machine_unit" CHECK (("appointment"."machine" is null) = ("appointment"."machine_unit" is null) and ("appointment"."machine_unit" is null or "appointment"."machine_unit" >= 1))
);
--> statement-breakpoint
ALTER TABLE "appointment" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "slot_hold" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"holder" text NOT NULL,
	"centre_id" uuid NOT NULL,
	"physio_id" uuid NOT NULL,
	"appointment_type_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"machine" text,
	"machine_unit" integer,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slot_hold_holder_unique" UNIQUE("holder"),
	CONSTRAINT "slot_hold_span" CHECK ("slot_hold"."ends_at" > "slot_hold"."starts_at"),
	CONSTRAINT "slot_hold_machine" CHECK ("slot_hold"."machine" is null or "slot_hold"."machine" in ('zero_gravity_treadmill')),
	CONSTRAINT "slot_hold_machine_unit" CHECK (("slot_hold"."machine" is null) = ("slot_hold"."machine_unit" is null) and ("slot_hold"."machine_unit" is null or "slot_hold"."machine_unit" >= 1))
);
--> statement-breakpoint
ALTER TABLE "slot_hold" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- SCH-04 (decision G6): appointment IDs start with the centre's prefix. Added empty, filled for
-- the centres already there (the three clinics MVH, MVK and MVW; any other uses its code), then
-- required.
ALTER TABLE "centre" ADD COLUMN "appointment_prefix" text;--> statement-breakpoint
DO $$
BEGIN
  PERFORM set_config('audit.actor', 'system:migration', false);
  UPDATE public.centre SET appointment_prefix = CASE code
    WHEN 'HSR' THEN 'MVH' WHEN 'KOR' THEN 'MVK' WHEN 'WFD' THEN 'MVW' ELSE code END
  WHERE appointment_prefix IS NULL;
  PERFORM set_config('audit.actor', '', false);
END
$$;--> statement-breakpoint
ALTER TABLE "centre" ALTER COLUMN "appointment_prefix" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "centre" ADD COLUMN "treadmills" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "appointment_type" ADD COLUMN "needs_consultant" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "appointment_type" ADD COLUMN "machine" text;--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_patient_id_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patient"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_centre_id_centre_id_fk" FOREIGN KEY ("centre_id") REFERENCES "public"."centre"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_physio_id_staff_user_id_fk" FOREIGN KEY ("physio_id") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_appointment_type_id_appointment_type_id_fk" FOREIGN KEY ("appointment_type_id") REFERENCES "public"."appointment_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_booked_by_staff_user_id_fk" FOREIGN KEY ("booked_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot_hold" ADD CONSTRAINT "slot_hold_centre_id_centre_id_fk" FOREIGN KEY ("centre_id") REFERENCES "public"."centre"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot_hold" ADD CONSTRAINT "slot_hold_physio_id_staff_user_id_fk" FOREIGN KEY ("physio_id") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot_hold" ADD CONSTRAINT "slot_hold_appointment_type_id_appointment_type_id_fk" FOREIGN KEY ("appointment_type_id") REFERENCES "public"."appointment_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointment_centre_physio_start_idx" ON "appointment" USING btree ("centre_id","physio_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointment_patient_start_idx" ON "appointment" USING btree ("patient_id","starts_at");--> statement-breakpoint
CREATE INDEX "slot_hold_physio_start_idx" ON "slot_hold" USING btree ("physio_id","starts_at");--> statement-breakpoint
CREATE INDEX "slot_hold_expires_idx" ON "slot_hold" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "centre" ADD CONSTRAINT "centre_appointment_prefix_unique" UNIQUE("appointment_prefix");--> statement-breakpoint
ALTER TABLE "centre" ADD CONSTRAINT "centre_appointment_prefix_letters" CHECK ("centre"."appointment_prefix" ~ '^[A-Z]{2,4}$');--> statement-breakpoint
ALTER TABLE "centre" ADD CONSTRAINT "centre_treadmills" CHECK ("centre"."treadmills" >= 0);--> statement-breakpoint
ALTER TABLE "appointment_type" ADD CONSTRAINT "appointment_type_machine" CHECK ("appointment_type"."machine" is null or "appointment_type"."machine" in ('zero_gravity_treadmill'));
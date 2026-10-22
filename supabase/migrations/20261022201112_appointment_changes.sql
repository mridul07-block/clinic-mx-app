CREATE TYPE "public"."appointment_change_reason" AS ENUM('patient', 'clinic');--> statement-breakpoint
ALTER TABLE "appointment" ADD COLUMN "change_reason" "appointment_change_reason";--> statement-breakpoint
ALTER TABLE "appointment" ADD COLUMN "changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "appointment" ADD COLUMN "changed_by" uuid;--> statement-breakpoint
ALTER TABLE "appointment" ADD COLUMN "rescheduled_from_id" uuid;--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_changed_by_staff_user_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_rescheduled_from_id_appointment_id_fk" FOREIGN KEY ("rescheduled_from_id") REFERENCES "public"."appointment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_rescheduled_from_id_unique" UNIQUE("rescheduled_from_id");--> statement-breakpoint
-- NOT VALID: enforced for every write from now on; rows cancelled before SCH-08 carry no reason
-- and are never changed again (appointment_status_guard).
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_change" CHECK (("appointment"."status" in ('cancelled', 'rescheduled')) = ("appointment"."change_reason" is not null and "appointment"."changed_at" is not null and "appointment"."changed_by" is not null) and ("appointment"."change_reason" is null) = ("appointment"."changed_at" is null) and ("appointment"."change_reason" is null) = ("appointment"."changed_by" is null)) NOT VALID;

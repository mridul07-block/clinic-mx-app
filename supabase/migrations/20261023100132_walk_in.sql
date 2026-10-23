-- INT-12: walk ins are booked and checked in in one action, recorded as their own channel
-- (user decision, 23 October 2026). Every staff booking (Front desk or Walk in) records who made it.
ALTER TYPE "public"."booking_channel" ADD VALUE 'walk_in';--> statement-breakpoint
ALTER TABLE "appointment" DROP CONSTRAINT "appointment_front_desk_booked_by";--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_staff_booked_by" CHECK ("appointment"."channel" = 'whatsapp' or "appointment"."booked_by" is not null);
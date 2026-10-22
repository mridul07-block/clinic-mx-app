ALTER TABLE "appointment" ADD COLUMN "no_show_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "appointment" ADD COLUMN "no_show_by" uuid;--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_no_show_by_staff_user_id_fk" FOREIGN KEY ("no_show_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- NOT VALID: enforced for every write from now on; a row set to No show before INT-11 has no
-- record of who marked it.
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_no_show" CHECK (("appointment"."status" = 'no_show') = ("appointment"."no_show_at" is not null) and ("appointment"."no_show_at" is null) = ("appointment"."no_show_by" is null)) NOT VALID;

CREATE TABLE "kiosk_device" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"centre_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stopped_at" timestamp with time zone,
	"stopped_by" uuid,
	"current_link_id" uuid,
	"current_since" timestamp with time zone,
	CONSTRAINT "kiosk_device_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "kiosk_device_name" CHECK (length(trim("kiosk_device"."name")) between 1 and 60),
	CONSTRAINT "kiosk_device_token_hash" CHECK ("kiosk_device"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "kiosk_device_stopped" CHECK (("kiosk_device"."stopped_at" is null) = ("kiosk_device"."stopped_by" is null)
        and ("kiosk_device"."stopped_at" is null or "kiosk_device"."current_link_id" is null)),
	CONSTRAINT "kiosk_device_current" CHECK (("kiosk_device"."current_link_id" is null) = ("kiosk_device"."current_since" is null))
);
--> statement-breakpoint
ALTER TABLE "kiosk_device" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "kiosk_device" ADD CONSTRAINT "kiosk_device_centre_id_centre_id_fk" FOREIGN KEY ("centre_id") REFERENCES "public"."centre"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kiosk_device" ADD CONSTRAINT "kiosk_device_created_by_staff_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kiosk_device" ADD CONSTRAINT "kiosk_device_stopped_by_staff_user_id_fk" FOREIGN KEY ("stopped_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kiosk_device" ADD CONSTRAINT "kiosk_device_current_link_id_patient_link_id_fk" FOREIGN KEY ("current_link_id") REFERENCES "public"."patient_link"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kiosk_device_centre_idx" ON "kiosk_device" USING btree ("centre_id");
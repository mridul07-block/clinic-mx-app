-- WhatsApp templates per WhatsApp Business Account, and the centres' coordinates (user decisions,
-- 1 November 2026), ahead of the code that uses them (docs/runbooks/local-gate.md).
-- - An approval counts only on the account it was given on: staging moved to Branmart's account and
--   kept sending a confirmation approved on the old one (Meta 132001). Rows recorded before have no
--   account and count on none. The old uniques stay until the code that names them as conflict
--   targets is replaced; their drop ships with that code.
-- - A centre's latitude and longitude, both or neither, for the map in the booking confirmation.
ALTER TABLE "centre" ADD COLUMN "latitude" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "centre" ADD COLUMN "longitude" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "whatsapp_template" ADD COLUMN "business_account_id" text;--> statement-breakpoint
ALTER TABLE "whatsapp_template" ADD CONSTRAINT "whatsapp_template_account_version" UNIQUE("business_account_id","key","version","language");--> statement-breakpoint
ALTER TABLE "whatsapp_template" ADD CONSTRAINT "whatsapp_template_account_meta_name" UNIQUE("business_account_id","meta_name","language");--> statement-breakpoint
ALTER TABLE "centre" ADD CONSTRAINT "centre_coordinates" CHECK (("centre"."latitude" is null) = ("centre"."longitude" is null)
        and "centre"."latitude" between -90 and 90 and "centre"."longitude" between -180 and 180);--> statement-breakpoint
ALTER TABLE "whatsapp_template" ADD CONSTRAINT "whatsapp_template_business_account" CHECK ("whatsapp_template"."business_account_id" ~ '^[0-9]+$');
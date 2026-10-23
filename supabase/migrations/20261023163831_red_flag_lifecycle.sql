ALTER TABLE "red_flag_alert" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "red_flag_alert" ADD COLUMN "referred_to" text;--> statement-breakpoint
ALTER TABLE "red_flag_alert" ADD COLUMN "referred_by" uuid;--> statement-breakpoint
ALTER TABLE "red_flag_alert" ADD COLUMN "referred_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "red_flag_alert" ADD COLUMN "closed_by" uuid;--> statement-breakpoint
ALTER TABLE "red_flag_alert" ADD CONSTRAINT "red_flag_alert_referred_by_staff_user_id_fk" FOREIGN KEY ("referred_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "red_flag_alert" ADD CONSTRAINT "red_flag_alert_closed_by_staff_user_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "red_flag_alert_status_idx" ON "red_flag_alert" USING btree ("status","display");
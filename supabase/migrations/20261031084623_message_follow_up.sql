CREATE TABLE "message_follow_up" (
	"id" uuid PRIMARY KEY NOT NULL,
	"followed_up_by" uuid NOT NULL,
	"followed_up_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "message_follow_up" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "message_follow_up" ADD CONSTRAINT "message_follow_up_id_message_id_fk" FOREIGN KEY ("id") REFERENCES "public"."message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_follow_up" ADD CONSTRAINT "message_follow_up_followed_up_by_staff_user_id_fk" FOREIGN KEY ("followed_up_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_failed_idx" ON "message" USING btree ("status_at") WHERE "message"."status" = 'failed' and "message"."direction" = 'outbound' and "message"."patient_id" is not null;
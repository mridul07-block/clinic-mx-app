CREATE TYPE "public"."leave_status" AS ENUM('requested', 'approved', 'declined', 'cancelled');--> statement-breakpoint
CREATE TABLE "roster" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_user_id" uuid NOT NULL,
	"centre_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"weekly" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roster_version_key" UNIQUE("staff_user_id","centre_id","effective_from"),
	CONSTRAINT "roster_weekly_week" CHECK (jsonb_typeof("roster"."weekly") = 'array' and jsonb_array_length("roster"."weekly") = 7)
);
--> statement-breakpoint
ALTER TABLE "roster" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "staff_leave" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_user_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"all_day" boolean NOT NULL,
	"note" text,
	"status" "leave_status" NOT NULL,
	"requested_by" uuid NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decline_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_leave_span" CHECK ("staff_leave"."ends_at" > "staff_leave"."starts_at"),
	CONSTRAINT "staff_leave_note" CHECK ("staff_leave"."note" is null or length("staff_leave"."note") <= 200),
	CONSTRAINT "staff_leave_decided" CHECK (("staff_leave"."status" <> 'requested' or "staff_leave"."decided_by" is null)
        and ("staff_leave"."status" not in ('approved', 'declined') or "staff_leave"."decided_by" is not null)
        and ("staff_leave"."decided_by" is null) = ("staff_leave"."decided_at" is null)),
	CONSTRAINT "staff_leave_declined" CHECK (("staff_leave"."status" = 'declined') = ("staff_leave"."decline_reason" is not null))
);
--> statement-breakpoint
ALTER TABLE "staff_leave" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "roster" ADD CONSTRAINT "roster_staff_user_id_staff_user_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster" ADD CONSTRAINT "roster_centre_id_centre_id_fk" FOREIGN KEY ("centre_id") REFERENCES "public"."centre"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster" ADD CONSTRAINT "roster_created_by_staff_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_leave" ADD CONSTRAINT "staff_leave_staff_user_id_staff_user_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_leave" ADD CONSTRAINT "staff_leave_requested_by_staff_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_leave" ADD CONSTRAINT "staff_leave_decided_by_staff_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "roster_centre_idx" ON "roster" USING btree ("centre_id");--> statement-breakpoint
CREATE INDEX "staff_leave_staff_idx" ON "staff_leave" USING btree ("staff_user_id","starts_at");
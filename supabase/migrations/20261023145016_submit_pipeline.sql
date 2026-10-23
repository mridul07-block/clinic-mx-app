CREATE TYPE "public"."alert_display" AS ENUM('emergency', 'review', 'information');--> statement-breakpoint
CREATE TYPE "public"."notification_kind" AS ENUM('health_form_submitted', 'red_flag_emergency');--> statement-breakpoint
CREATE TYPE "public"."red_flag_alert_status" AS ENUM('raised', 'reviewed', 'referred', 'closed');--> statement-breakpoint
CREATE TABLE "notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_user_id" uuid NOT NULL,
	"kind" "notification_kind" NOT NULL,
	"appointment_id" uuid,
	"episode_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "notification_once" UNIQUE("staff_user_id","kind","appointment_id")
);
--> statement-breakpoint
ALTER TABLE "notification" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "precaution" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"episode_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"source" text NOT NULL,
	"intake_response_id" uuid,
	"form_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "precaution_episode_key" UNIQUE("episode_id","key"),
	CONSTRAINT "precaution_source" CHECK ("precaution"."source" in ('health_form'))
);
--> statement-breakpoint
ALTER TABLE "precaution" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "red_flag_alert" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"episode_id" uuid NOT NULL,
	"appointment_id" uuid,
	"kb_version_id" uuid NOT NULL,
	"rule_key" text NOT NULL,
	"name" text NOT NULL,
	"triage" "red_flag_triage" NOT NULL,
	"display" "alert_display" NOT NULL,
	"action" text NOT NULL,
	"signed_off" boolean NOT NULL,
	"status" "red_flag_alert_status" DEFAULT 'raised' NOT NULL,
	"raised_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_by" uuid,
	"decision" text,
	"closed_at" timestamp with time zone,
	CONSTRAINT "red_flag_alert_episode_rule" UNIQUE("episode_id","rule_key")
);
--> statement-breakpoint
ALTER TABLE "red_flag_alert" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "intake_response" ADD COLUMN "episode_id" uuid;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_staff_user_id_staff_user_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_appointment_id_appointment_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "precaution" ADD CONSTRAINT "precaution_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "precaution" ADD CONSTRAINT "precaution_intake_response_id_intake_response_id_fk" FOREIGN KEY ("intake_response_id") REFERENCES "public"."intake_response"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "red_flag_alert" ADD CONSTRAINT "red_flag_alert_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "red_flag_alert" ADD CONSTRAINT "red_flag_alert_appointment_id_appointment_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "red_flag_alert" ADD CONSTRAINT "red_flag_alert_kb_version_id_kb_version_id_fk" FOREIGN KEY ("kb_version_id") REFERENCES "public"."kb_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "red_flag_alert" ADD CONSTRAINT "red_flag_alert_reviewed_by_staff_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_staff_idx" ON "notification" USING btree ("staff_user_id","created_at");--> statement-breakpoint
CREATE INDEX "red_flag_alert_episode_idx" ON "red_flag_alert" USING btree ("episode_id");--> statement-breakpoint
ALTER TABLE "intake_response" ADD CONSTRAINT "intake_response_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode"("id") ON DELETE no action ON UPDATE no action;
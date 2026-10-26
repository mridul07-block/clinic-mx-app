CREATE TYPE "public"."session_status" AS ENUM('draft', 'signed');--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"episode_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"centre_id" uuid NOT NULL,
	"physio_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"kb_version_id" uuid NOT NULL,
	"plan_of_care_id" uuid,
	"note" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"pain_rest" smallint,
	"pain_activity" smallint,
	"pain_after" smallint,
	"status" "session_status" DEFAULT 'draft' NOT NULL,
	"signed_by" uuid,
	"signed_at" timestamp with time zone,
	"package_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_appointment_id_unique" UNIQUE("appointment_id"),
	CONSTRAINT "session_signed" CHECK (("session"."status" = 'signed') = ("session"."signed_at" is not null) and ("session"."signed_at" is null) = ("session"."signed_by" is null)),
	CONSTRAINT "session_signed_pain" CHECK ("session"."status" = 'draft' or ("session"."pain_rest" is not null and "session"."pain_activity" is not null and "session"."pain_after" is not null)),
	CONSTRAINT "session_pain_range" CHECK ("session"."pain_rest" between 0 and 10 and "session"."pain_activity" between 0 and 10 and "session"."pain_after" between 0 and 10),
	CONSTRAINT "session_number" CHECK ("session"."number" >= 1)
);
--> statement-breakpoint
ALTER TABLE "session" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_appointment_id_appointment_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_patient_id_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patient"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_centre_id_centre_id_fk" FOREIGN KEY ("centre_id") REFERENCES "public"."centre"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_physio_id_staff_user_id_fk" FOREIGN KEY ("physio_id") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_kb_version_id_kb_version_id_fk" FOREIGN KEY ("kb_version_id") REFERENCES "public"."kb_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_plan_of_care_id_plan_of_care_id_fk" FOREIGN KEY ("plan_of_care_id") REFERENCES "public"."plan_of_care"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_signed_by_staff_user_id_fk" FOREIGN KEY ("signed_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_package_id_package_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."package"("id") ON DELETE no action ON UPDATE no action;
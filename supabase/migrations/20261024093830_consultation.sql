CREATE TYPE "public"."consultation_status" AS ENUM('draft', 'signed');--> statement-breakpoint
CREATE TABLE "consultation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"episode_id" uuid NOT NULL,
	"physio_id" uuid NOT NULL,
	"kb_version_id" uuid NOT NULL,
	"sections" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "consultation_status" DEFAULT 'draft' NOT NULL,
	"signed_by" uuid,
	"signed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consultation_appointment_id_unique" UNIQUE("appointment_id"),
	CONSTRAINT "consultation_signed" CHECK (("consultation"."status" = 'signed') = ("consultation"."signed_at" is not null) and ("consultation"."signed_at" is null) = ("consultation"."signed_by" is null))
);
--> statement-breakpoint
ALTER TABLE "consultation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "consultation" ADD CONSTRAINT "consultation_appointment_id_appointment_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultation" ADD CONSTRAINT "consultation_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultation" ADD CONSTRAINT "consultation_physio_id_staff_user_id_fk" FOREIGN KEY ("physio_id") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultation" ADD CONSTRAINT "consultation_kb_version_id_kb_version_id_fk" FOREIGN KEY ("kb_version_id") REFERENCES "public"."kb_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultation" ADD CONSTRAINT "consultation_signed_by_staff_user_id_fk" FOREIGN KEY ("signed_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;
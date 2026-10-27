CREATE TYPE "public"."kb_readiness_kind" AS ENUM('measure', 'check');--> statement-breakpoint
CREATE TYPE "public"."clearance_status" AS ENUM('rehabilitation_complete', 'return_to_training', 'return_to_sport');--> statement-breakpoint
CREATE TYPE "public"."criterion_result" AS ENUM('met', 'not_met', 'not_assessed');--> statement-breakpoint
CREATE TYPE "public"."readiness_mark_kind" AS ENUM('check', 'override');--> statement-breakpoint
CREATE TABLE "kb_readiness_criterion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kb_version_id" uuid NOT NULL,
	"region" "kb_region" NOT NULL,
	"key" text NOT NULL,
	"position" integer NOT NULL,
	"kind" "kb_readiness_kind" NOT NULL,
	"measure_key" text,
	"text" text NOT NULL,
	"section" text NOT NULL,
	"rule" jsonb NOT NULL,
	"from_verdict" boolean NOT NULL,
	"row_number" integer NOT NULL,
	CONSTRAINT "kb_readiness_criterion_version_key" UNIQUE("kb_version_id","key"),
	CONSTRAINT "kb_readiness_criterion_key" CHECK ("kb_readiness_criterion"."key" ~ '^[a-z_]+[.][a-z0-9_.]+$'),
	CONSTRAINT "kb_readiness_criterion_measure" CHECK (("kb_readiness_criterion"."kind" = 'measure') = ("kb_readiness_criterion"."measure_key" is not null))
);
--> statement-breakpoint
ALTER TABLE "kb_readiness_criterion" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "clearance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"episode_id" uuid NOT NULL,
	"status" "clearance_status" NOT NULL,
	"region" "kb_region" NOT NULL,
	"kb_version_id" uuid NOT NULL,
	"criteria" jsonb NOT NULL,
	"signed_by" uuid NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clearance_episode_status" UNIQUE("episode_id","status")
);
--> statement-breakpoint
ALTER TABLE "clearance" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "readiness_mark" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"episode_id" uuid NOT NULL,
	"kb_version_id" uuid NOT NULL,
	"criterion_key" text NOT NULL,
	"kind" "readiness_mark_kind" NOT NULL,
	"result" "criterion_result",
	"reason" text,
	"marked_by" uuid NOT NULL,
	"marked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "readiness_mark_shape" CHECK (("readiness_mark"."kind" = 'check' and "readiness_mark"."result" is not null and "readiness_mark"."reason" is null)
        or ("readiness_mark"."kind" = 'override' and "readiness_mark"."result" is null
          and length(trim("readiness_mark"."reason")) between 1 and 1000))
);
--> statement-breakpoint
ALTER TABLE "readiness_mark" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "readiness_recording" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"episode_id" uuid NOT NULL,
	"kb_version_id" uuid NOT NULL,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "readiness_recording" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "measure" DROP CONSTRAINT "measure_taken_in";--> statement-breakpoint
ALTER TABLE "measure" ADD COLUMN "readiness_recording_id" uuid;--> statement-breakpoint
ALTER TABLE "kb_readiness_criterion" ADD CONSTRAINT "kb_readiness_criterion_kb_version_id_kb_version_id_fk" FOREIGN KEY ("kb_version_id") REFERENCES "public"."kb_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clearance" ADD CONSTRAINT "clearance_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clearance" ADD CONSTRAINT "clearance_kb_version_id_kb_version_id_fk" FOREIGN KEY ("kb_version_id") REFERENCES "public"."kb_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clearance" ADD CONSTRAINT "clearance_signed_by_staff_user_id_fk" FOREIGN KEY ("signed_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_mark" ADD CONSTRAINT "readiness_mark_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_mark" ADD CONSTRAINT "readiness_mark_kb_version_id_kb_version_id_fk" FOREIGN KEY ("kb_version_id") REFERENCES "public"."kb_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_mark" ADD CONSTRAINT "readiness_mark_marked_by_staff_user_id_fk" FOREIGN KEY ("marked_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_recording" ADD CONSTRAINT "readiness_recording_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_recording" ADD CONSTRAINT "readiness_recording_kb_version_id_kb_version_id_fk" FOREIGN KEY ("kb_version_id") REFERENCES "public"."kb_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_recording" ADD CONSTRAINT "readiness_recording_recorded_by_staff_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "readiness_mark_episode_idx" ON "readiness_mark" USING btree ("episode_id","criterion_key","marked_at");--> statement-breakpoint
ALTER TABLE "measure" ADD CONSTRAINT "measure_readiness_recording_id_readiness_recording_id_fk" FOREIGN KEY ("readiness_recording_id") REFERENCES "public"."readiness_recording"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "measure_readiness_recording_idx" ON "measure" USING btree ("readiness_recording_id");--> statement-breakpoint
ALTER TABLE "measure" ADD CONSTRAINT "measure_taken_in" CHECK (num_nonnulls("measure"."consultation_id", "measure"."session_id", "measure"."final_test_id", "measure"."readiness_recording_id") = 1);
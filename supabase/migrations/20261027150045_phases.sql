CREATE TYPE "public"."phase_mark_result" AS ENUM('met', 'not_yet');--> statement-breakpoint
CREATE TYPE "public"."phase_move_kind" AS ENUM('progress', 'override');--> statement-breakpoint
CREATE TABLE "kb_phase" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kb_version_id" uuid NOT NULL,
	"region" "kb_region" NOT NULL,
	"number" integer NOT NULL,
	"name" text NOT NULL,
	"timing" text NOT NULL,
	"goal" text NOT NULL,
	"content" text NOT NULL,
	"markers" text NOT NULL,
	"row_number" integer NOT NULL,
	CONSTRAINT "kb_phase_version_region_number" UNIQUE("kb_version_id","region","number"),
	CONSTRAINT "kb_phase_number" CHECK ("kb_phase"."number" >= 0)
);
--> statement-breakpoint
ALTER TABLE "kb_phase" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "kb_phase_criterion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kb_version_id" uuid NOT NULL,
	"region" "kb_region" NOT NULL,
	"phase" integer NOT NULL,
	"position" integer NOT NULL,
	"key" text NOT NULL,
	"text" text NOT NULL,
	"names_pain_limit" boolean NOT NULL,
	"row_number" integer NOT NULL,
	CONSTRAINT "kb_phase_criterion_version_key" UNIQUE("kb_version_id","key"),
	CONSTRAINT "kb_phase_criterion_key" CHECK ("kb_phase_criterion"."key" ~ '^[a-z_]+[.]phase[0-9]+[.][a-z0-9_]+$')
);
--> statement-breakpoint
ALTER TABLE "kb_phase_criterion" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "phase_mark" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"episode_id" uuid NOT NULL,
	"kb_version_id" uuid NOT NULL,
	"criterion_key" text NOT NULL,
	"result" "phase_mark_result" NOT NULL,
	"marked_by" uuid NOT NULL,
	"marked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "phase_mark" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "phase_move" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"episode_id" uuid NOT NULL,
	"kb_version_id" uuid NOT NULL,
	"region" "kb_region" NOT NULL,
	"from_phase" integer NOT NULL,
	"to_phase" integer NOT NULL,
	"kind" "phase_move_kind" NOT NULL,
	"reason" text,
	"moved_by" uuid NOT NULL,
	"moved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "phase_move_episode_moved_at" UNIQUE("episode_id","moved_at"),
	CONSTRAINT "phase_move_shape" CHECK ("phase_move"."from_phase" >= 0 and "phase_move"."to_phase" >= 0 and (
        ("phase_move"."kind" = 'progress' and "phase_move"."to_phase" = "phase_move"."from_phase" + 1
          and "phase_move"."reason" is null)
        or ("phase_move"."kind" = 'override' and "phase_move"."to_phase" <> "phase_move"."from_phase"
          and length(trim("phase_move"."reason")) between 1 and 1000)))
);
--> statement-breakpoint
ALTER TABLE "phase_move" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "kb_phase" ADD CONSTRAINT "kb_phase_kb_version_id_kb_version_id_fk" FOREIGN KEY ("kb_version_id") REFERENCES "public"."kb_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_phase_criterion" ADD CONSTRAINT "kb_phase_criterion_kb_version_id_kb_version_id_fk" FOREIGN KEY ("kb_version_id") REFERENCES "public"."kb_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_phase_criterion" ADD CONSTRAINT "kb_phase_criterion_phase_fk" FOREIGN KEY ("kb_version_id","region","phase") REFERENCES "public"."kb_phase"("kb_version_id","region","number") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phase_mark" ADD CONSTRAINT "phase_mark_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phase_mark" ADD CONSTRAINT "phase_mark_kb_version_id_kb_version_id_fk" FOREIGN KEY ("kb_version_id") REFERENCES "public"."kb_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phase_mark" ADD CONSTRAINT "phase_mark_marked_by_staff_user_id_fk" FOREIGN KEY ("marked_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phase_move" ADD CONSTRAINT "phase_move_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phase_move" ADD CONSTRAINT "phase_move_kb_version_id_kb_version_id_fk" FOREIGN KEY ("kb_version_id") REFERENCES "public"."kb_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phase_move" ADD CONSTRAINT "phase_move_moved_by_staff_user_id_fk" FOREIGN KEY ("moved_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "phase_mark_episode_idx" ON "phase_mark" USING btree ("episode_id","marked_at");--> statement-breakpoint
CREATE INDEX "phase_move_episode_idx" ON "phase_move" USING btree ("episode_id","moved_at");
CREATE TABLE "exercise" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"default_dose" text NOT NULL,
	"video_path" text,
	"video_type" text,
	"video_bytes" integer,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone,
	"replaced_by" uuid,
	CONSTRAINT "exercise_name" CHECK (length(trim("exercise"."name")) between 1 and 120),
	CONSTRAINT "exercise_default_dose" CHECK (length(trim("exercise"."default_dose")) between 1 and 120),
	CONSTRAINT "exercise_video" CHECK (("exercise"."video_path" is null) = ("exercise"."video_type" is null)
        and ("exercise"."video_path" is null) = ("exercise"."video_bytes" is null)
        and ("exercise"."video_type" is null or "exercise"."video_type" in ('video/mp4', 'video/webm'))
        and ("exercise"."video_bytes" is null or "exercise"."video_bytes" > 0)),
	CONSTRAINT "exercise_replaced" CHECK ("exercise"."replaced_by" is null or "exercise"."retired_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "exercise" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "exercise" ADD CONSTRAINT "exercise_created_by_staff_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise" ADD CONSTRAINT "exercise_replaced_by_exercise_id_fk" FOREIGN KEY ("replaced_by") REFERENCES "public"."exercise"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exercise_active_name_idx" ON "exercise" USING btree ("name") WHERE "exercise"."retired_at" is null;
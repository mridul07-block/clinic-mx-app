CREATE TABLE "baseline_measure" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"episode_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"kb_version_id" uuid NOT NULL,
	"measure_key" text NOT NULL,
	"consultation_id" uuid,
	"not_tested_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "baseline_measure_episode_key" UNIQUE("episode_id","measure_key"),
	CONSTRAINT "baseline_measure_source" CHECK ("baseline_measure"."consultation_id" is null or "baseline_measure"."not_tested_reason" is null),
	CONSTRAINT "baseline_measure_reason" CHECK ("baseline_measure"."not_tested_reason" is null or length(trim("baseline_measure"."not_tested_reason")) between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "baseline_measure" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "measure" ALTER COLUMN "consultation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "measure" ADD COLUMN "session_id" uuid;--> statement-breakpoint
ALTER TABLE "baseline_measure" ADD CONSTRAINT "baseline_measure_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baseline_measure" ADD CONSTRAINT "baseline_measure_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baseline_measure" ADD CONSTRAINT "baseline_measure_kb_version_id_kb_version_id_fk" FOREIGN KEY ("kb_version_id") REFERENCES "public"."kb_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baseline_measure" ADD CONSTRAINT "baseline_measure_consultation_id_consultation_id_fk" FOREIGN KEY ("consultation_id") REFERENCES "public"."consultation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measure" ADD CONSTRAINT "measure_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "measure_session_idx" ON "measure" USING btree ("session_id");--> statement-breakpoint
ALTER TABLE "measure" ADD CONSTRAINT "measure_taken_in" CHECK (num_nonnulls("measure"."consultation_id", "measure"."session_id") = 1);
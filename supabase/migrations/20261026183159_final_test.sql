CREATE TABLE "final_test" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"episode_id" uuid NOT NULL,
	"kb_version_id" uuid NOT NULL,
	"not_tested" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"signed_by" uuid NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "final_test_episode_id_unique" UNIQUE("episode_id")
);
--> statement-breakpoint
ALTER TABLE "final_test" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "measure" DROP CONSTRAINT "measure_taken_in";--> statement-breakpoint
ALTER TABLE "measure" ADD COLUMN "final_test_id" uuid;--> statement-breakpoint
ALTER TABLE "final_test" ADD CONSTRAINT "final_test_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "final_test" ADD CONSTRAINT "final_test_kb_version_id_kb_version_id_fk" FOREIGN KEY ("kb_version_id") REFERENCES "public"."kb_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "final_test" ADD CONSTRAINT "final_test_signed_by_staff_user_id_fk" FOREIGN KEY ("signed_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measure" ADD CONSTRAINT "measure_final_test_id_final_test_id_fk" FOREIGN KEY ("final_test_id") REFERENCES "public"."final_test"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "measure_final_test_idx" ON "measure" USING btree ("final_test_id");--> statement-breakpoint
ALTER TABLE "measure" ADD CONSTRAINT "measure_taken_in" CHECK (num_nonnulls("measure"."consultation_id", "measure"."session_id", "measure"."final_test_id") = 1);
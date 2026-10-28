CREATE TABLE "exercise_tick" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"episode_id" uuid NOT NULL,
	"plan_of_care_id" uuid NOT NULL,
	"exercise_index" smallint NOT NULL,
	"exercise" text NOT NULL,
	"day" date NOT NULL,
	"patient_link_id" uuid NOT NULL,
	"ticked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exercise_tick_index" CHECK ("exercise_tick"."exercise_index" between 0 and 29)
);
--> statement-breakpoint
ALTER TABLE "exercise_tick" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "exercise_tick" ADD CONSTRAINT "exercise_tick_patient_id_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patient"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_tick" ADD CONSTRAINT "exercise_tick_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_tick" ADD CONSTRAINT "exercise_tick_plan_of_care_id_plan_of_care_id_fk" FOREIGN KEY ("plan_of_care_id") REFERENCES "public"."plan_of_care"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_tick" ADD CONSTRAINT "exercise_tick_patient_link_id_patient_link_id_fk" FOREIGN KEY ("patient_link_id") REFERENCES "public"."patient_link"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "exercise_tick_once_a_day" ON "exercise_tick" USING btree ("plan_of_care_id","exercise_index","day");--> statement-breakpoint
CREATE INDEX "exercise_tick_episode_day_idx" ON "exercise_tick" USING btree ("episode_id","day");
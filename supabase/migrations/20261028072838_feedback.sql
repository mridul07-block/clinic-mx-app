CREATE TYPE "public"."feedback_survey_key" AS ENUM('post_consultation');--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"survey_key" "feedback_survey_key" NOT NULL,
	"survey_version" integer NOT NULL,
	"patient_link_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"episode_id" uuid NOT NULL,
	"appointment_id" uuid,
	"consultation_id" uuid,
	"centre_id" uuid NOT NULL,
	"physio_id" uuid,
	"answers" jsonb NOT NULL,
	"comment" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_patient_link_id_unique" UNIQUE("patient_link_id"),
	CONSTRAINT "feedback_answers" CHECK (jsonb_typeof("feedback"."answers") = 'object'),
	CONSTRAINT "feedback_comment" CHECK ("feedback"."comment" is null or length("feedback"."comment") between 1 and 1000),
	CONSTRAINT "feedback_post_consultation" CHECK ("feedback"."survey_key" <> 'post_consultation' or ("feedback"."appointment_id" is not null and "feedback"."consultation_id" is not null and "feedback"."physio_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "feedback" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_patient_link_id_patient_link_id_fk" FOREIGN KEY ("patient_link_id") REFERENCES "public"."patient_link"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_patient_id_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patient"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_appointment_id_appointment_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_consultation_id_consultation_id_fk" FOREIGN KEY ("consultation_id") REFERENCES "public"."consultation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_centre_id_centre_id_fk" FOREIGN KEY ("centre_id") REFERENCES "public"."centre"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_physio_id_staff_user_id_fk" FOREIGN KEY ("physio_id") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_one_per_consultation" ON "feedback" USING btree ("consultation_id");--> statement-breakpoint
CREATE INDEX "feedback_centre_idx" ON "feedback" USING btree ("centre_id","submitted_at");--> statement-breakpoint
CREATE INDEX "feedback_physio_idx" ON "feedback" USING btree ("physio_id","submitted_at");
CREATE TABLE "questionnaire_result" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_link_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"episode_id" uuid NOT NULL,
	"centre_id" uuid NOT NULL,
	"kb_version_id" uuid NOT NULL,
	"instrument_key" text NOT NULL,
	"instrument_version" text NOT NULL,
	"raw_answers" jsonb NOT NULL,
	"score" numeric(7, 1),
	"answered" integer NOT NULL,
	"missing" integer NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "questionnaire_result_counts" CHECK ("questionnaire_result"."answered" >= 0 and "questionnaire_result"."missing" >= 0),
	CONSTRAINT "questionnaire_result_answers" CHECK (jsonb_typeof("questionnaire_result"."raw_answers") = 'object')
);
--> statement-breakpoint
ALTER TABLE "questionnaire_result" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "questionnaire_result" ADD CONSTRAINT "questionnaire_result_patient_link_id_patient_link_id_fk" FOREIGN KEY ("patient_link_id") REFERENCES "public"."patient_link"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questionnaire_result" ADD CONSTRAINT "questionnaire_result_patient_id_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patient"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questionnaire_result" ADD CONSTRAINT "questionnaire_result_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questionnaire_result" ADD CONSTRAINT "questionnaire_result_centre_id_centre_id_fk" FOREIGN KEY ("centre_id") REFERENCES "public"."centre"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questionnaire_result" ADD CONSTRAINT "questionnaire_result_kb_version_id_kb_version_id_fk" FOREIGN KEY ("kb_version_id") REFERENCES "public"."kb_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "questionnaire_result_once_per_link" ON "questionnaire_result" USING btree ("patient_link_id","instrument_key");--> statement-breakpoint
CREATE INDEX "questionnaire_result_episode_idx" ON "questionnaire_result" USING btree ("episode_id","instrument_key","submitted_at");
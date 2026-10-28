-- PAT-05: the day after first treatment check, once per episode: its visit and physio and one
-- answer of the three (Better, Same, Still sore), nothing more.
CREATE UNIQUE INDEX "feedback_one_first_treatment_per_episode" ON "feedback" USING btree ("episode_id") WHERE "feedback"."survey_key" = 'first_treatment';--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_first_treatment" CHECK ("feedback"."survey_key" <> 'first_treatment' or ("feedback"."appointment_id" is not null
        and "feedback"."consultation_id" is null and "feedback"."physio_id" is not null
        and "feedback"."score" is null and "feedback"."comment" is null
        and "feedback"."answers" ->> 'since_first_treatment' in ('better', 'same', 'still_sore')
        and "feedback"."answers" - 'since_first_treatment' = '{}'::jsonb));
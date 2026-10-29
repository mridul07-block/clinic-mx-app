-- PAT-10: a follow up after discharge is answered once per interval, one answer of the three;
-- its link is tied to the episode.
ALTER TABLE "patient_link" DROP CONSTRAINT "patient_link_subject_fits";--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_one_follow_up_per_interval" ON "feedback" USING btree ("episode_id",("answers" ->> 'follow_up')) WHERE "feedback"."survey_key" = 'follow_up';--> statement-breakpoint
ALTER TABLE "patient_link" ADD CONSTRAINT "patient_link_subject_fits" CHECK (("patient_link"."purpose" <> 'health_form' or "patient_link"."appointment_id" is not null)
        and ("patient_link"."purpose" not in ('questionnaire', 'my_plan', 'follow_up') or "patient_link"."episode_id" is not null));--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_follow_up" CHECK ("feedback"."survey_key" <> 'follow_up' or ("feedback"."appointment_id" is null
        and "feedback"."consultation_id" is null and "feedback"."score" is null and "feedback"."comment" is null
        and "feedback"."answers" ->> 'since_discharge' in ('doing_well', 'some_pain', 'injured_again')
        and "feedback"."answers" ->> 'follow_up' ~ '^[0-9]+_(week|month)$'
        and "feedback"."answers" - 'since_discharge' - 'follow_up' = '{}'::jsonb));
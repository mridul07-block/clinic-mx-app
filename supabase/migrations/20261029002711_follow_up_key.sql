-- PAT-10: the follow up link purpose and survey key, on their own (new enum values are used
-- only after their transaction commits). Rules in follow_up_rules.sql.
ALTER TYPE "public"."patient_link_purpose" ADD VALUE 'follow_up';--> statement-breakpoint
ALTER TYPE "public"."feedback_survey_key" ADD VALUE 'follow_up';
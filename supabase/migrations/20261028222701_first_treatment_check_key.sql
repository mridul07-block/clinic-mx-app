-- PAT-05: the day after first treatment check's survey key, on its own (a new enum value is
-- used only after its transaction commits). Rules in first_treatment_check_rules.sql.
ALTER TYPE "public"."feedback_survey_key" ADD VALUE 'first_treatment';
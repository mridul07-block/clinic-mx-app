CREATE TYPE "public"."body_side" AS ENUM('left', 'right');--> statement-breakpoint
CREATE TYPE "public"."clinical_stage" AS ENUM('acute', 'subacute', 'chronic', 'reactive', 'degenerative');--> statement-breakpoint
CREATE TYPE "public"."intervention_kind" AS ENUM('exercise', 'manual_therapy', 'movement_retraining', 'technology_assisted');--> statement-breakpoint
CREATE TYPE "public"."irritability" AS ENUM('high', 'moderate', 'low');--> statement-breakpoint
CREATE TYPE "public"."measure_limb" AS ENUM('involved', 'uninvolved');--> statement-breakpoint
CREATE TYPE "public"."plan_of_care_status" AS ENUM('active');--> statement-breakpoint
CREATE TYPE "public"."special_test_result_value" AS ENUM('positive', 'negative', 'not_tested');--> statement-breakpoint
CREATE TABLE "addendum" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"consultation_id" uuid NOT NULL,
	"episode_id" uuid NOT NULL,
	"text" text NOT NULL,
	"author_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "addendum_text" CHECK (length(trim("addendum"."text")) between 1 and 5000)
);
--> statement-breakpoint
ALTER TABLE "addendum" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "diagnosis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"consultation_id" uuid NOT NULL,
	"episode_id" uuid NOT NULL,
	"kb_version_id" uuid NOT NULL,
	"condition_id" text NOT NULL,
	"movement_dx" text NOT NULL,
	"irritability" "irritability" NOT NULL,
	"stage" "clinical_stage" NOT NULL,
	"category_code" text,
	"provisional" boolean NOT NULL,
	CONSTRAINT "diagnosis_consultation_id_unique" UNIQUE("consultation_id")
);
--> statement-breakpoint
ALTER TABLE "diagnosis" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "measure" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"episode_id" uuid NOT NULL,
	"consultation_id" uuid NOT NULL,
	"kb_version_id" uuid NOT NULL,
	"measure_key" text NOT NULL,
	"limb" "measure_limb",
	"side" "body_side",
	"value" numeric NOT NULL,
	"unit" text NOT NULL,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "measure" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "plan_modality" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_of_care_id" uuid NOT NULL,
	"modality_key" text NOT NULL,
	"reason" text NOT NULL,
	"parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "plan_modality_plan_key" UNIQUE("plan_of_care_id","modality_key")
);
--> statement-breakpoint
ALTER TABLE "plan_modality" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "plan_of_care" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"episode_id" uuid NOT NULL,
	"consultation_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"goals" jsonb NOT NULL,
	"interventions" "intervention_kind"[] DEFAULT '{}'::intervention_kind[] NOT NULL,
	"sessions_per_week" integer,
	"weeks" integer,
	"home_programme" jsonb NOT NULL,
	"review_date" date NOT NULL,
	"questionnaires" text[] DEFAULT '{}'::text[] NOT NULL,
	"treating_physio_id" uuid NOT NULL,
	"status" "plan_of_care_status" DEFAULT 'active' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_of_care_episode_version_key" UNIQUE("episode_id","version"),
	CONSTRAINT "plan_of_care_version" CHECK ("plan_of_care"."version" >= 1),
	CONSTRAINT "plan_of_care_frequency" CHECK (("plan_of_care"."sessions_per_week" is null or "plan_of_care"."sessions_per_week" between 1 and 7) and ("plan_of_care"."weeks" is null or "plan_of_care"."weeks" between 1 and 52))
);
--> statement-breakpoint
ALTER TABLE "plan_of_care" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "special_test_result" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"episode_id" uuid NOT NULL,
	"consultation_id" uuid NOT NULL,
	"kb_version_id" uuid NOT NULL,
	"test_key" text NOT NULL,
	"result" "special_test_result_value" NOT NULL,
	"interpretation" text NOT NULL,
	CONSTRAINT "special_test_result_consultation_key" UNIQUE("consultation_id","test_key")
);
--> statement-breakpoint
ALTER TABLE "special_test_result" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "appointment" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "addendum" ADD CONSTRAINT "addendum_consultation_id_consultation_id_fk" FOREIGN KEY ("consultation_id") REFERENCES "public"."consultation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addendum" ADD CONSTRAINT "addendum_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addendum" ADD CONSTRAINT "addendum_author_id_staff_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnosis" ADD CONSTRAINT "diagnosis_consultation_id_consultation_id_fk" FOREIGN KEY ("consultation_id") REFERENCES "public"."consultation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnosis" ADD CONSTRAINT "diagnosis_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnosis" ADD CONSTRAINT "diagnosis_kb_version_id_kb_version_id_fk" FOREIGN KEY ("kb_version_id") REFERENCES "public"."kb_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnosis" ADD CONSTRAINT "diagnosis_condition_fkey" FOREIGN KEY ("kb_version_id","condition_id") REFERENCES "public"."kb_condition"("kb_version_id","condition_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measure" ADD CONSTRAINT "measure_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measure" ADD CONSTRAINT "measure_consultation_id_consultation_id_fk" FOREIGN KEY ("consultation_id") REFERENCES "public"."consultation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measure" ADD CONSTRAINT "measure_kb_version_id_kb_version_id_fk" FOREIGN KEY ("kb_version_id") REFERENCES "public"."kb_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measure" ADD CONSTRAINT "measure_created_by_staff_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_modality" ADD CONSTRAINT "plan_modality_plan_of_care_id_plan_of_care_id_fk" FOREIGN KEY ("plan_of_care_id") REFERENCES "public"."plan_of_care"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_of_care" ADD CONSTRAINT "plan_of_care_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_of_care" ADD CONSTRAINT "plan_of_care_consultation_id_consultation_id_fk" FOREIGN KEY ("consultation_id") REFERENCES "public"."consultation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_of_care" ADD CONSTRAINT "plan_of_care_treating_physio_id_staff_user_id_fk" FOREIGN KEY ("treating_physio_id") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_of_care" ADD CONSTRAINT "plan_of_care_created_by_staff_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "special_test_result" ADD CONSTRAINT "special_test_result_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "special_test_result" ADD CONSTRAINT "special_test_result_consultation_id_consultation_id_fk" FOREIGN KEY ("consultation_id") REFERENCES "public"."consultation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "special_test_result" ADD CONSTRAINT "special_test_result_kb_version_id_kb_version_id_fk" FOREIGN KEY ("kb_version_id") REFERENCES "public"."kb_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "addendum_consultation_idx" ON "addendum" USING btree ("consultation_id","created_at");--> statement-breakpoint
CREATE INDEX "measure_episode_idx" ON "measure" USING btree ("episode_id","measure_key");
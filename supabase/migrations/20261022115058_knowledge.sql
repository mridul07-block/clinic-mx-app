CREATE TYPE "public"."kb_onset" AS ENUM('sudden', 'gradual', 'recurrent', 'subacute');--> statement-breakpoint
CREATE TYPE "public"."kb_red_flag_tier" AS ENUM('none', 'screen', 'conditional', 'red_flag', 'not_stated');--> statement-breakpoint
CREATE TYPE "public"."kb_region" AS ENUM('shoulder', 'elbow', 'forearm_wrist', 'hip', 'knee', 'foot_ankle', 'cervical', 'lumbar_sij', 'bone_stress');--> statement-breakpoint
CREATE TYPE "public"."kb_sex_predominance" AS ENUM('male', 'female', 'equal');--> statement-breakpoint
CREATE TYPE "public"."kb_version_status" AS ENUM('draft', 'approved');--> statement-breakpoint
CREATE TABLE "kb_condition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kb_version_id" uuid NOT NULL,
	"condition_id" text NOT NULL,
	"name" text NOT NULL,
	"synonyms" text[] DEFAULT '{}'::text[] NOT NULL,
	"home_region" "kb_region" NOT NULL,
	CONSTRAINT "kb_condition_version_condition_key" UNIQUE("kb_version_id","condition_id"),
	CONSTRAINT "kb_condition_id" CHECK ("kb_condition"."condition_id" ~ '^[A-Z]{3}-[0-9]{3}$'),
	CONSTRAINT "kb_condition_name" CHECK (length(trim("kb_condition"."name")) >= 1)
);
--> statement-breakpoint
ALTER TABLE "kb_condition" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "kb_condition_listing" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kb_version_id" uuid NOT NULL,
	"condition_id" text NOT NULL,
	"region" "kb_region" NOT NULL,
	"row_number" integer NOT NULL,
	"name" text NOT NULL,
	"subregion" text NOT NULL,
	"age_min" integer,
	"age_max" integer,
	"age_text" text,
	"onsets" "kb_onset"[] DEFAULT '{}'::kb_onset[] NOT NULL,
	"onset_text" text,
	"sex" "kb_sex_predominance",
	"sex_text" text,
	"activity_tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"activity_text" text,
	"red_flag_tier" "kb_red_flag_tier" NOT NULL,
	"red_flag_text" text,
	"risk_class" text,
	"symptoms" text,
	"discriminating_question" text,
	"tests_imaging" text,
	"biomechanical_cause" text,
	"details" jsonb NOT NULL,
	CONSTRAINT "kb_condition_listing_row_key" UNIQUE("kb_version_id","region","row_number"),
	CONSTRAINT "kb_condition_listing_age" CHECK ("kb_condition_listing"."age_min" is null or "kb_condition_listing"."age_max" is null or "kb_condition_listing"."age_min" <= "kb_condition_listing"."age_max")
);
--> statement-breakpoint
ALTER TABLE "kb_condition_listing" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "kb_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer NOT NULL,
	"status" "kb_version_status" DEFAULT 'draft' NOT NULL,
	"notes" text,
	"source" jsonb NOT NULL,
	"report" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_version_number_unique" UNIQUE("number"),
	CONSTRAINT "kb_version_number" CHECK ("kb_version"."number" >= 1),
	CONSTRAINT "kb_version_approved" CHECK (("kb_version"."status" = 'approved') = ("kb_version"."approved_by" is not null and "kb_version"."approved_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "kb_version" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "kb_condition" ADD CONSTRAINT "kb_condition_kb_version_id_kb_version_id_fk" FOREIGN KEY ("kb_version_id") REFERENCES "public"."kb_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_condition_listing" ADD CONSTRAINT "kb_condition_listing_kb_version_id_kb_version_id_fk" FOREIGN KEY ("kb_version_id") REFERENCES "public"."kb_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_condition_listing" ADD CONSTRAINT "kb_condition_listing_condition_fkey" FOREIGN KEY ("kb_version_id","condition_id") REFERENCES "public"."kb_condition"("kb_version_id","condition_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_version" ADD CONSTRAINT "kb_version_approved_by_staff_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kb_condition_listing_condition_idx" ON "kb_condition_listing" USING btree ("kb_version_id","condition_id");
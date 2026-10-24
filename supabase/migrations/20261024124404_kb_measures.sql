CREATE TYPE "public"."kb_measure_kind" AS ENUM('lsi', 'deficit', 'reference', 'marker', 'grade');--> statement-breakpoint
CREATE TABLE "kb_measure" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kb_version_id" uuid NOT NULL,
	"region" "kb_region" NOT NULL,
	"key" text NOT NULL,
	"section" text NOT NULL,
	"name" text NOT NULL,
	"unit" text NOT NULL,
	"kind" "kb_measure_kind" NOT NULL,
	"inverted" boolean NOT NULL,
	"rule" jsonb NOT NULL,
	"direction" text,
	"note" text,
	"row_number" integer NOT NULL,
	CONSTRAINT "kb_measure_version_key" UNIQUE("kb_version_id","key"),
	CONSTRAINT "kb_measure_key" CHECK ("kb_measure"."key" ~ '^[a-z_]+[.][a-z0-9_.]+$')
);
--> statement-breakpoint
ALTER TABLE "kb_measure" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "kb_special_test" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kb_version_id" uuid NOT NULL,
	"region" "kb_region" NOT NULL,
	"key" text NOT NULL,
	"category" text NOT NULL,
	"test" text NOT NULL,
	"targets" text NOT NULL,
	"positive_finding" text NOT NULL,
	"clinical_note" text NOT NULL,
	"row_number" integer NOT NULL,
	CONSTRAINT "kb_special_test_version_key" UNIQUE("kb_version_id","key"),
	CONSTRAINT "kb_special_test_key" CHECK ("kb_special_test"."key" ~ '^[a-z_]+[.][a-z0-9_.]+$')
);
--> statement-breakpoint
ALTER TABLE "kb_special_test" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "kb_measure" ADD CONSTRAINT "kb_measure_kb_version_id_kb_version_id_fk" FOREIGN KEY ("kb_version_id") REFERENCES "public"."kb_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_special_test" ADD CONSTRAINT "kb_special_test_kb_version_id_kb_version_id_fk" FOREIGN KEY ("kb_version_id") REFERENCES "public"."kb_version"("id") ON DELETE no action ON UPDATE no action;
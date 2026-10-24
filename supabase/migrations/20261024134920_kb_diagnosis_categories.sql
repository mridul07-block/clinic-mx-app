CREATE TABLE "kb_diagnosis_category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kb_version_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"sort" integer NOT NULL,
	CONSTRAINT "kb_diagnosis_category_version_code_key" UNIQUE("kb_version_id","code"),
	CONSTRAINT "kb_diagnosis_category_code" CHECK ("kb_diagnosis_category"."code" ~ '^[a-z][a-z0-9_]*$')
);
--> statement-breakpoint
ALTER TABLE "kb_diagnosis_category" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "kb_condition" ADD COLUMN "category_code" text;--> statement-breakpoint
ALTER TABLE "kb_diagnosis_category" ADD CONSTRAINT "kb_diagnosis_category_kb_version_id_kb_version_id_fk" FOREIGN KEY ("kb_version_id") REFERENCES "public"."kb_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_condition" ADD CONSTRAINT "kb_condition_category_fkey" FOREIGN KEY ("kb_version_id","category_code") REFERENCES "public"."kb_diagnosis_category"("kb_version_id","code") ON DELETE no action ON UPDATE no action;
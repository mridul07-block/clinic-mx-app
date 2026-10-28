-- AI-08: the monthly knowledge base report, one per month, kept as built. Its rules are in
-- kb_report_rules.sql.
CREATE TABLE "kb_report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"month" text NOT NULL,
	"kb_version_id" uuid,
	"body" jsonb NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_report_month_unique" UNIQUE("month"),
	CONSTRAINT "kb_report_month" CHECK ("kb_report"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
ALTER TABLE "kb_report" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "kb_report" ADD CONSTRAINT "kb_report_kb_version_id_kb_version_id_fk" FOREIGN KEY ("kb_version_id") REFERENCES "public"."kb_version"("id") ON DELETE no action ON UPDATE no action;
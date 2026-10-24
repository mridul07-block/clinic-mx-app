CREATE TYPE "public"."document_kind" AS ENUM('consultation_summary', 'invoice_receipt', 'referral_letter', 'discharge_report');--> statement-breakpoint
CREATE TABLE "document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "document_kind" NOT NULL,
	"patient_id" uuid NOT NULL,
	"episode_id" uuid,
	"centre_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"file_path" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_file_path_unique" UNIQUE("file_path"),
	CONSTRAINT "document_version_key" UNIQUE("kind","source_id","version"),
	CONSTRAINT "document_version_positive" CHECK ("document"."version" >= 1),
	CONSTRAINT "document_size" CHECK ("document"."size_bytes" > 0)
);
--> statement-breakpoint
ALTER TABLE "document" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "staff_user" ADD COLUMN "credentials" text;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_patient_id_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patient"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_centre_id_centre_id_fk" FOREIGN KEY ("centre_id") REFERENCES "public"."centre"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_patient_idx" ON "document" USING btree ("patient_id","created_at");
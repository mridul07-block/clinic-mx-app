CREATE TABLE "consent_record" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"appointment_id" uuid,
	"episode_id" uuid,
	"patient_link_id" uuid,
	"stage" text NOT NULL,
	"statement_key" text NOT NULL,
	"statement_version" integer NOT NULL,
	"accepted" boolean NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"signature_kind" text,
	"signature_file" text,
	"typed_name" text,
	"signer" text NOT NULL,
	"modality" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consent_record_stage" CHECK ("consent_record"."stage" in ('A', 'B')),
	CONSTRAINT "consent_record_signer" CHECK ("consent_record"."signer" in ('patient', 'guardian')),
	CONSTRAINT "consent_record_signature" CHECK (case when "consent_record"."accepted" then
        ("consent_record"."signature_kind" = 'drawn' and "consent_record"."signature_file" is not null and "consent_record"."typed_name" is null)
        or ("consent_record"."signature_kind" = 'typed' and "consent_record"."typed_name" is not null and "consent_record"."signature_file" is null)
      else "consent_record"."signature_kind" is null and "consent_record"."signature_file" is null and "consent_record"."typed_name" is null end)
);
--> statement-breakpoint
ALTER TABLE "consent_record" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "consent_record" ADD CONSTRAINT "consent_record_patient_id_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patient"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_record" ADD CONSTRAINT "consent_record_appointment_id_appointment_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_record" ADD CONSTRAINT "consent_record_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consent_record_appointment_idx" ON "consent_record" USING btree ("appointment_id","statement_key","created_at");
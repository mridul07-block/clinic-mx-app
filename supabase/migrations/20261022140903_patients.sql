CREATE TYPE "public"."centre_sequence_kind" AS ENUM('op_number');--> statement-breakpoint
CREATE TYPE "public"."patient_sex" AS ENUM('female', 'male', 'other');--> statement-breakpoint
CREATE TABLE "centre_sequence" (
	"centre_id" uuid NOT NULL,
	"kind" "centre_sequence_kind" NOT NULL,
	"last_value" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "centre_sequence_centre_id_kind_pk" PRIMARY KEY("centre_id","kind"),
	CONSTRAINT "centre_sequence_positive" CHECK ("centre_sequence"."last_value" >= 0)
);
--> statement-breakpoint
ALTER TABLE "centre_sequence" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "patient" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"date_of_birth" date,
	"sex" "patient_sex",
	"occupation" text,
	"op_number" text NOT NULL,
	"registered_centre_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patient_op_number_unique" UNIQUE("op_number"),
	CONSTRAINT "patient_phone_e164" CHECK ("patient"."phone" ~ '^\+91[1-9][0-9]{9}$'),
	CONSTRAINT "patient_name_present" CHECK (btrim("patient"."name") <> '')
);
--> statement-breakpoint
ALTER TABLE "patient" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- SCH-01: centre codes start every OP number. Added empty, filled for the centres already there
-- (the three clinics by name, any other from the letters of its name), then required.
ALTER TABLE "centre" ADD COLUMN "code" text;--> statement-breakpoint
DO $$
DECLARE
  row record;
  letters text;
  candidate text;
  suffix int;
BEGIN
  PERFORM set_config('audit.actor', 'system:migration', false);
  UPDATE public.centre SET code = CASE name
    WHEN 'HSR Layout' THEN 'HSR' WHEN 'Koramangala' THEN 'KOR' WHEN 'Whitefield' THEN 'WFD' END
  WHERE code IS NULL;
  FOR row IN SELECT id, name FROM public.centre WHERE code IS NULL ORDER BY created_at LOOP
    letters := rpad(upper(regexp_replace(row.name, '[^A-Za-z]', '', 'g')), 3, 'X');
    candidate := left(letters, 3);
    suffix := 0;
    -- Taken: the first two letters and AA, AB and on (676 to try).
    WHILE EXISTS (SELECT 1 FROM public.centre WHERE code = candidate) LOOP
      candidate := left(letters, 2) || chr(65 + suffix / 26) || chr(65 + suffix % 26);
      suffix := suffix + 1;
    END LOOP;
    UPDATE public.centre SET code = candidate WHERE id = row.id;
  END LOOP;
  PERFORM set_config('audit.actor', '', false);
END $$;--> statement-breakpoint
ALTER TABLE "centre" ALTER COLUMN "code" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "centre_sequence" ADD CONSTRAINT "centre_sequence_centre_id_centre_id_fk" FOREIGN KEY ("centre_id") REFERENCES "public"."centre"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient" ADD CONSTRAINT "patient_registered_centre_id_centre_id_fk" FOREIGN KEY ("registered_centre_id") REFERENCES "public"."centre"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "patient_phone_idx" ON "patient" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "patient_name_idx" ON "patient" USING btree (lower("name"));--> statement-breakpoint
-- Links made before SCH-01 point at no patient row, so the key checks new links only.
ALTER TABLE "patient_link" ADD CONSTRAINT "patient_link_patient_id_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patient"("id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "centre" ADD CONSTRAINT "centre_code_unique" UNIQUE("code");--> statement-breakpoint
ALTER TABLE "centre" ADD CONSTRAINT "centre_code_letters" CHECK ("centre"."code" ~ '^[A-Z]{2,4}$');
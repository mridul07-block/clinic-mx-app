CREATE TABLE "appointment_type" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"minutes" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointment_type_key_unique" UNIQUE("key"),
	CONSTRAINT "appointment_type_key" CHECK ("appointment_type"."key" ~ '^[a-z][a-z0-9_]*$'),
	CONSTRAINT "appointment_type_name" CHECK (length(trim("appointment_type"."name")) between 1 and 60),
	CONSTRAINT "appointment_type_minutes" CHECK ("appointment_type"."minutes" > 0)
);
--> statement-breakpoint
ALTER TABLE "appointment_type" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "physio_appointment_length" (
	"staff_user_id" uuid NOT NULL,
	"appointment_type_id" uuid NOT NULL,
	"minutes" integer NOT NULL,
	CONSTRAINT "physio_appointment_length_staff_user_id_appointment_type_id_pk" PRIMARY KEY("staff_user_id","appointment_type_id"),
	CONSTRAINT "physio_appointment_length_minutes" CHECK ("physio_appointment_length"."minutes" > 0)
);
--> statement-breakpoint
ALTER TABLE "physio_appointment_length" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "physio_appointment_length" ADD CONSTRAINT "physio_appointment_length_staff_user_id_staff_user_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "physio_appointment_length" ADD CONSTRAINT "physio_appointment_length_appointment_type_id_appointment_type_id_fk" FOREIGN KEY ("appointment_type_id") REFERENCES "public"."appointment_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "appointment_type_name_lower_key" ON "appointment_type" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "physio_appointment_length_type_idx" ON "physio_appointment_length" USING btree ("appointment_type_id");
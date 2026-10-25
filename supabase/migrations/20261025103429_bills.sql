CREATE TYPE "public"."bill_kind" AS ENUM('consultation', 'package');--> statement-breakpoint
CREATE TYPE "public"."bill_status" AS ENUM('unpaid', 'paid', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."centre_sequence_kind" ADD VALUE 'bill';--> statement-breakpoint
CREATE TABLE "bill" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"kind" "bill_kind" NOT NULL,
	"status" "bill_status" DEFAULT 'unpaid' NOT NULL,
	"patient_id" uuid NOT NULL,
	"episode_id" uuid,
	"centre_id" uuid NOT NULL,
	"appointment_id" uuid,
	"plan_choice_id" uuid,
	"total_paise" integer NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	CONSTRAINT "bill_number_unique" UNIQUE("number"),
	CONSTRAINT "bill_source" CHECK (case "bill"."kind"
        when 'consultation' then "bill"."appointment_id" is not null and "bill"."plan_choice_id" is null
        else "bill"."plan_choice_id" is not null and "bill"."appointment_id" is null
      end),
	CONSTRAINT "bill_total" CHECK ("bill"."total_paise" >= 0),
	CONSTRAINT "bill_cancelled" CHECK (("bill"."status" = 'cancelled') = ("bill"."cancelled_at" is not null and "bill"."cancel_reason" is not null))
);
--> statement-breakpoint
ALTER TABLE "bill" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "bill_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bill_id" uuid NOT NULL,
	"price_item_id" uuid,
	"package_type_id" uuid,
	"description" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_paise" integer NOT NULL,
	"amount_paise" integer NOT NULL,
	CONSTRAINT "bill_line_item" CHECK (("bill_line"."price_item_id" is null) <> ("bill_line"."package_type_id" is null)),
	CONSTRAINT "bill_line_quantity" CHECK ("bill_line"."quantity" > 0),
	CONSTRAINT "bill_line_amount" CHECK ("bill_line"."amount_paise" = "bill_line"."quantity" * "bill_line"."unit_paise")
);
--> statement-breakpoint
ALTER TABLE "bill_line" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bill" ADD CONSTRAINT "bill_patient_id_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patient"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill" ADD CONSTRAINT "bill_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill" ADD CONSTRAINT "bill_centre_id_centre_id_fk" FOREIGN KEY ("centre_id") REFERENCES "public"."centre"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill" ADD CONSTRAINT "bill_appointment_id_appointment_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill" ADD CONSTRAINT "bill_plan_choice_id_plan_choice_id_fk" FOREIGN KEY ("plan_choice_id") REFERENCES "public"."plan_choice"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill" ADD CONSTRAINT "bill_created_by_staff_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_line" ADD CONSTRAINT "bill_line_bill_id_bill_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bill"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_line" ADD CONSTRAINT "bill_line_price_item_id_price_item_id_fk" FOREIGN KEY ("price_item_id") REFERENCES "public"."price_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_line" ADD CONSTRAINT "bill_line_package_type_id_package_type_id_fk" FOREIGN KEY ("package_type_id") REFERENCES "public"."package_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bill_episode_idx" ON "bill" USING btree ("episode_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "bill_live_consultation_key" ON "bill" USING btree ("appointment_id") WHERE "bill"."kind" = 'consultation' and "bill"."status" <> 'cancelled';--> statement-breakpoint
CREATE UNIQUE INDEX "bill_choice_key" ON "bill" USING btree ("plan_choice_id");--> statement-breakpoint
CREATE INDEX "bill_line_bill_idx" ON "bill_line" USING btree ("bill_id");
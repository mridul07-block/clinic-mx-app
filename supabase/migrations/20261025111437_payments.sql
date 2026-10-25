CREATE TYPE "public"."payment_method" AS ENUM('upi', 'card', 'cash');--> statement-breakpoint
CREATE TABLE "payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bill_id" uuid NOT NULL,
	"method" "payment_method" NOT NULL,
	"amount_paise" integer NOT NULL,
	"reference" text,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone_at" timestamp with time zone,
	"undone_by" uuid,
	"undo_reason" text,
	CONSTRAINT "payment_amount" CHECK ("payment"."amount_paise" > 0),
	CONSTRAINT "payment_reference" CHECK ("payment"."reference" is null or length("payment"."reference") <= 40),
	CONSTRAINT "payment_undone" CHECK (("payment"."undone_at" is null) = ("payment"."undone_by" is null) and ("payment"."undone_at" is null) = ("payment"."undo_reason" is null))
);
--> statement-breakpoint
ALTER TABLE "payment" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_bill_id_bill_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bill"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_recorded_by_staff_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_undone_by_staff_user_id_fk" FOREIGN KEY ("undone_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_live_key" ON "payment" USING btree ("bill_id") WHERE "payment"."undone_at" is null;
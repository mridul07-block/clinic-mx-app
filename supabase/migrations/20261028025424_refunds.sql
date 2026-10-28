CREATE TABLE "refund_credit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"bill_id" uuid NOT NULL,
	"amount_paise" integer NOT NULL,
	"method" "payment_method" NOT NULL,
	"reference" text,
	"reason" text NOT NULL,
	"approved_by" uuid NOT NULL,
	"approved_by_name" text NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refund_credit_amount" CHECK ("refund_credit"."amount_paise" > 0),
	CONSTRAINT "refund_credit_reference" CHECK ("refund_credit"."reference" is null or length("refund_credit"."reference") <= 40),
	CONSTRAINT "refund_credit_reason" CHECK (length(trim("refund_credit"."reason")) between 1 and 300)
);
--> statement-breakpoint
ALTER TABLE "refund_credit" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "refund_credit" ADD CONSTRAINT "refund_credit_payment_id_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_credit" ADD CONSTRAINT "refund_credit_bill_id_bill_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bill"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_credit" ADD CONSTRAINT "refund_credit_approved_by_staff_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "refund_credit_payment_idx" ON "refund_credit" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "refund_credit_approved_idx" ON "refund_credit" USING btree ("approved_at");
CREATE TABLE "package" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"episode_id" uuid NOT NULL,
	"centre_id" uuid NOT NULL,
	"package_type_id" uuid NOT NULL,
	"bill_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sessions_total" integer NOT NULL,
	"sessions_used" integer DEFAULT 0 NOT NULL,
	"reschedules_left" integer NOT NULL,
	"paid_at" timestamp with time zone NOT NULL,
	"valid_until" date NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	CONSTRAINT "package_payment_id_unique" UNIQUE("payment_id"),
	CONSTRAINT "package_sessions" CHECK ("package"."sessions_total" >= 1 and "package"."sessions_used" between 0 and "package"."sessions_total"),
	CONSTRAINT "package_reschedules" CHECK ("package"."reschedules_left" >= 0),
	CONSTRAINT "package_cancelled" CHECK (("package"."cancelled_at" is null) = ("package"."cancel_reason" is null))
);
--> statement-breakpoint
ALTER TABLE "package" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "package" ADD CONSTRAINT "package_patient_id_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patient"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package" ADD CONSTRAINT "package_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package" ADD CONSTRAINT "package_centre_id_centre_id_fk" FOREIGN KEY ("centre_id") REFERENCES "public"."centre"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package" ADD CONSTRAINT "package_package_type_id_package_type_id_fk" FOREIGN KEY ("package_type_id") REFERENCES "public"."package_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package" ADD CONSTRAINT "package_bill_id_bill_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bill"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package" ADD CONSTRAINT "package_payment_id_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "package_live_key" ON "package" USING btree ("bill_id") WHERE "package"."cancelled_at" is null;--> statement-breakpoint
CREATE INDEX "package_episode_idx" ON "package" USING btree ("episode_id");--> statement-breakpoint
CREATE INDEX "package_patient_idx" ON "package" USING btree ("patient_id");
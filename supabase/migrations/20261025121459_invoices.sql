ALTER TYPE "public"."centre_sequence_kind" ADD VALUE 'invoice';--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "invoice_number" text;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_invoice_number_unique" UNIQUE("invoice_number");
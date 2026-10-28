ALTER TABLE "bill_line" ADD COLUMN "discounted_by_name" text;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "charged_lines" jsonb;
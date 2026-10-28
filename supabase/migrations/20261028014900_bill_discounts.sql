ALTER TABLE "bill_line" ADD COLUMN "discount_kind" "discount_kind";--> statement-breakpoint
ALTER TABLE "bill_line" ADD COLUMN "discount_preset_id" uuid;--> statement-breakpoint
ALTER TABLE "bill_line" ADD COLUMN "discount_name" text;--> statement-breakpoint
ALTER TABLE "bill_line" ADD COLUMN "discount_percent" integer;--> statement-breakpoint
ALTER TABLE "bill_line" ADD COLUMN "discount_paise" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bill_line" ADD COLUMN "discount_reason" text;--> statement-breakpoint
ALTER TABLE "bill_line" ADD COLUMN "discounted_by" uuid;--> statement-breakpoint
ALTER TABLE "bill_line" ADD COLUMN "discounted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bill_line" ADD CONSTRAINT "bill_line_discount_preset_id_discount_preset_id_fk" FOREIGN KEY ("discount_preset_id") REFERENCES "public"."discount_preset"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_line" ADD CONSTRAINT "bill_line_discounted_by_staff_user_id_fk" FOREIGN KEY ("discounted_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_line" ADD CONSTRAINT "bill_line_discount" CHECK (case
        when "bill_line"."discount_kind" is null then "bill_line"."discount_paise" = 0
          and "bill_line"."discount_preset_id" is null and "bill_line"."discount_name" is null
          and "bill_line"."discount_percent" is null and "bill_line"."discount_reason" is null
          and "bill_line"."discounted_by" is null and "bill_line"."discounted_at" is null
        else "bill_line"."discount_paise" >= 1 and "bill_line"."discount_paise" < "bill_line"."amount_paise"
          and "bill_line"."discounted_by" is not null and "bill_line"."discounted_at" is not null
          and length(trim("bill_line"."discount_name")) between 1 and 60
          and ("bill_line"."discount_preset_id" is not null
            or length(trim("bill_line"."discount_reason")) between 1 and 300)
          and case "bill_line"."discount_kind"
            when 'percent' then "bill_line"."discount_percent" between 1 and 100
              and "bill_line"."discount_paise" = ("bill_line"."amount_paise"::bigint * "bill_line"."discount_percent" + 50) / 100
            else "bill_line"."discount_percent" is null
          end
      end);
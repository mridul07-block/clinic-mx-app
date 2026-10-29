ALTER TABLE "bill" DROP CONSTRAINT "bill_source";--> statement-breakpoint
CREATE UNIQUE INDEX "bill_live_session_key" ON "bill" USING btree ("appointment_id") WHERE "bill"."kind" = 'session' and "bill"."status" <> 'cancelled';--> statement-breakpoint
ALTER TABLE "bill" ADD CONSTRAINT "bill_source" CHECK (case "bill"."kind"
        when 'package' then "bill"."plan_choice_id" is not null and "bill"."appointment_id" is null
        else "bill"."appointment_id" is not null and "bill"."plan_choice_id" is null
      end);
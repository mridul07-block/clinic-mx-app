CREATE TYPE "public"."plan_choice_kind" AS ENUM('package', 'per_session', 'think_about_it', 'no_thanks');--> statement-breakpoint
CREATE TABLE "plan_choice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"episode_id" uuid NOT NULL,
	"plan_of_care_id" uuid NOT NULL,
	"choice" "plan_choice_kind" NOT NULL,
	"package_type_id" uuid,
	"session_price_item_id" uuid,
	"follow_up_at" timestamp with time zone,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_choice_details" CHECK (case "plan_choice"."choice"
        when 'package' then "plan_choice"."package_type_id" is not null and "plan_choice"."session_price_item_id" is not null
        when 'per_session' then "plan_choice"."package_type_id" is null and "plan_choice"."session_price_item_id" is not null
        else "plan_choice"."package_type_id" is null and "plan_choice"."session_price_item_id" is null
      end),
	CONSTRAINT "plan_choice_follow_up" CHECK (("plan_choice"."choice" = 'think_about_it') = ("plan_choice"."follow_up_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "plan_choice" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "plan_choice" ADD CONSTRAINT "plan_choice_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_choice" ADD CONSTRAINT "plan_choice_plan_of_care_id_plan_of_care_id_fk" FOREIGN KEY ("plan_of_care_id") REFERENCES "public"."plan_of_care"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_choice" ADD CONSTRAINT "plan_choice_package_type_id_package_type_id_fk" FOREIGN KEY ("package_type_id") REFERENCES "public"."package_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_choice" ADD CONSTRAINT "plan_choice_session_price_item_id_price_item_id_fk" FOREIGN KEY ("session_price_item_id") REFERENCES "public"."price_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_choice" ADD CONSTRAINT "plan_choice_recorded_by_staff_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_choice_episode_idx" ON "plan_choice" USING btree ("episode_id","recorded_at");
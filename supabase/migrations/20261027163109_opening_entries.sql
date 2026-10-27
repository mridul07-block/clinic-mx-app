CREATE TABLE "opening_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"episode_id" uuid NOT NULL,
	"centre_id" uuid NOT NULL,
	"physio_id" uuid NOT NULL,
	"sessions_left" integer NOT NULL,
	"valid_until" date NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opening_entry_patient_id_unique" UNIQUE("patient_id"),
	CONSTRAINT "opening_entry_episode_id_unique" UNIQUE("episode_id"),
	CONSTRAINT "opening_entry_sessions" CHECK ("opening_entry"."sessions_left" between 1 and 100)
);
--> statement-breakpoint
ALTER TABLE "opening_entry" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "package" ALTER COLUMN "package_type_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "package" ALTER COLUMN "bill_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "package" ALTER COLUMN "payment_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "package" ADD COLUMN "opening_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "opening_entry" ADD CONSTRAINT "opening_entry_patient_id_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patient"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_entry" ADD CONSTRAINT "opening_entry_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_entry" ADD CONSTRAINT "opening_entry_centre_id_centre_id_fk" FOREIGN KEY ("centre_id") REFERENCES "public"."centre"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_entry" ADD CONSTRAINT "opening_entry_physio_id_staff_user_id_fk" FOREIGN KEY ("physio_id") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_entry" ADD CONSTRAINT "opening_entry_created_by_staff_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_entry" ADD CONSTRAINT "opening_entry_updated_by_staff_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package" ADD CONSTRAINT "package_opening_entry_id_opening_entry_id_fk" FOREIGN KEY ("opening_entry_id") REFERENCES "public"."opening_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package" ADD CONSTRAINT "package_opening_entry_id_unique" UNIQUE("opening_entry_id");--> statement-breakpoint
ALTER TABLE "package" ADD CONSTRAINT "package_source" CHECK (("package"."opening_entry_id" is null) = ("package"."bill_id" is not null and "package"."payment_id" is not null and "package"."package_type_id" is not null));
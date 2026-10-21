CREATE TYPE "public"."staff_role" AS ENUM('super_admin', 'centre_manager', 'front_desk', 'physiotherapist', 'finance');--> statement-breakpoint
CREATE TABLE "centre" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"map_link" text,
	"phone" text,
	"colour" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "centre_name_unique" UNIQUE("name"),
	CONSTRAINT "centre_colour_hex" CHECK ("centre"."colour" ~ '^#[0-9A-F]{6}$')
);
--> statement-breakpoint
ALTER TABLE "centre" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "staff_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_user_id" uuid,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "staff_role" NOT NULL,
	"treats_patients" boolean DEFAULT false NOT NULL,
	"consultant" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"access_ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_user_auth_user_id_unique" UNIQUE("auth_user_id"),
	CONSTRAINT "staff_user_consultant_treats" CHECK (not "staff_user"."consultant" or "staff_user"."treats_patients"),
	CONSTRAINT "staff_user_physio_treats" CHECK ("staff_user"."role" <> 'physiotherapist' or "staff_user"."treats_patients")
);
--> statement-breakpoint
ALTER TABLE "staff_user" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "staff_user_centre" (
	"staff_user_id" uuid NOT NULL,
	"centre_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_user_centre_staff_user_id_centre_id_pk" PRIMARY KEY("staff_user_id","centre_id")
);
--> statement-breakpoint
ALTER TABLE "staff_user_centre" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "staff_user_centre" ADD CONSTRAINT "staff_user_centre_staff_user_id_staff_user_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."staff_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_user_centre" ADD CONSTRAINT "staff_user_centre_centre_id_centre_id_fk" FOREIGN KEY ("centre_id") REFERENCES "public"."centre"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_user_email_lower_key" ON "staff_user" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "staff_user_centre_centre_id_idx" ON "staff_user_centre" USING btree ("centre_id");
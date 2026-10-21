ALTER TYPE "public"."audit_action" ADD VALUE 'support_request';--> statement-breakpoint
CREATE TABLE "support_grant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"granted_by" uuid NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_grant_window" CHECK ("support_grant"."ends_at" > "support_grant"."starts_at"),
	CONSTRAINT "support_grant_reason" CHECK (length(trim("support_grant"."reason")) > 0)
);
--> statement-breakpoint
ALTER TABLE "support_grant" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "staff_user" ADD COLUMN "velyx_support" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "support_grant" ADD CONSTRAINT "support_grant_granted_by_staff_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_grant_ends_at_idx" ON "support_grant" USING btree ("ends_at");--> statement-breakpoint
ALTER TABLE "staff_user" ADD CONSTRAINT "staff_user_support_super_admin" CHECK (not "staff_user"."velyx_support" or ("staff_user"."role" = 'super_admin' and not "staff_user"."treats_patients"));
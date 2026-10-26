CREATE TABLE "reassessment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"episode_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"kb_version_id" uuid NOT NULL,
	"consultant_id" uuid NOT NULL,
	"not_tested" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"decision" text,
	"signed_by" uuid,
	"signed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reassessment_session_id_unique" UNIQUE("session_id"),
	CONSTRAINT "reassessment_signed" CHECK (("reassessment"."decision" is null) = ("reassessment"."signed_by" is null) and ("reassessment"."signed_by" is null) = ("reassessment"."signed_at" is null)),
	CONSTRAINT "reassessment_decision" CHECK ("reassessment"."decision" is null or length(trim("reassessment"."decision")) between 1 and 2000)
);
--> statement-breakpoint
ALTER TABLE "reassessment" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reassessment" ADD CONSTRAINT "reassessment_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episode"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reassessment" ADD CONSTRAINT "reassessment_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reassessment" ADD CONSTRAINT "reassessment_kb_version_id_kb_version_id_fk" FOREIGN KEY ("kb_version_id") REFERENCES "public"."kb_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reassessment" ADD CONSTRAINT "reassessment_consultant_id_staff_user_id_fk" FOREIGN KEY ("consultant_id") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reassessment" ADD CONSTRAINT "reassessment_signed_by_staff_user_id_fk" FOREIGN KEY ("signed_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "addendum" ALTER COLUMN "consultation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "addendum" ADD COLUMN "session_id" uuid;--> statement-breakpoint
ALTER TABLE "addendum" ADD CONSTRAINT "addendum_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "addendum_session_idx" ON "addendum" USING btree ("session_id","created_at");--> statement-breakpoint
ALTER TABLE "addendum" ADD CONSTRAINT "addendum_note" CHECK (num_nonnulls("addendum"."consultation_id", "addendum"."session_id") = 1);
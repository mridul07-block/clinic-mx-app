-- WA-03: the messages still queued for a number, so its replies are sent straight after its
-- message to us rather than at the next job tick (docs/runbooks/whatsapp.md, "Reply speed").
CREATE INDEX "message_queued_phone_idx" ON "message" USING btree ("to_phone","created_at") WHERE "message"."status" = 'queued' and "message"."direction" = 'outbound';

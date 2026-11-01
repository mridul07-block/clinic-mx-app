-- WhatsApp templates per WhatsApp Business Account, second part: the uniques without the account go,
-- now that the code records and finds versions by account (the first part added the account and its
-- uniques). The same version can then be on two accounts: a new number, or the clinic's at WA-12.
ALTER TABLE "whatsapp_template" DROP CONSTRAINT "whatsapp_template_version";--> statement-breakpoint
ALTER TABLE "whatsapp_template" DROP CONSTRAINT "whatsapp_template_meta_name";
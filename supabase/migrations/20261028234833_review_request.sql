-- PAT-09: each centre's Google review link, sent to every discharged patient. Rules in
-- review_request_rules.sql.
ALTER TABLE "centre" ADD COLUMN "review_link" text;
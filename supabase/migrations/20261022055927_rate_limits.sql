CREATE TABLE "rate_limit" (
	"bucket" text NOT NULL,
	"key_hash" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"hits" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "rate_limit_bucket_key_hash_window_start_pk" PRIMARY KEY("bucket","key_hash","window_start"),
	CONSTRAINT "rate_limit_key_hash" CHECK ("rate_limit"."key_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "rate_limit_hits" CHECK ("rate_limit"."hits" > 0)
);
--> statement-breakpoint
ALTER TABLE "rate_limit" ENABLE ROW LEVEL SECURITY;
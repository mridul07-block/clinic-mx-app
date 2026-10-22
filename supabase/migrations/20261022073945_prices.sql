CREATE TYPE "public"."discount_kind" AS ENUM('percent', 'flat');--> statement-breakpoint
CREATE TABLE "discount_preset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" "discount_kind" NOT NULL,
	"percent" integer,
	"amount_paise" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discount_preset_name" CHECK (length(trim(name)) between 1 and 60),
	CONSTRAINT "discount_preset_amount" CHECK (("discount_preset"."kind" = 'percent' and "discount_preset"."percent" between 1 and 100 and "discount_preset"."amount_paise" is null)
        or ("discount_preset"."kind" = 'flat' and "discount_preset"."amount_paise" > 0 and "discount_preset"."percent" is null))
);
--> statement-breakpoint
ALTER TABLE "discount_preset" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "package_type" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"sessions" integer NOT NULL,
	"price_paise" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "package_type_name" CHECK (length(trim(name)) between 1 and 60),
	CONSTRAINT "package_type_sessions" CHECK ("package_type"."sessions" >= 1),
	CONSTRAINT "package_type_price" CHECK ("package_type"."price_paise" > 0)
);
--> statement-breakpoint
ALTER TABLE "package_type" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "package_type_item" (
	"package_type_id" uuid NOT NULL,
	"price_item_id" uuid NOT NULL,
	CONSTRAINT "package_type_item_package_type_id_price_item_id_pk" PRIMARY KEY("package_type_id","price_item_id")
);
--> statement-breakpoint
ALTER TABLE "package_type_item" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "price_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"amount_paise" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_item_key_unique" UNIQUE("key"),
	CONSTRAINT "price_item_key" CHECK ("price_item"."key" ~ '^[a-z][a-z0-9_]*$'),
	CONSTRAINT "price_item_label" CHECK (length(trim(label)) between 1 and 60),
	CONSTRAINT "price_item_amount" CHECK ("price_item"."amount_paise" > 0)
);
--> statement-breakpoint
ALTER TABLE "price_item" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "package_type_item" ADD CONSTRAINT "package_type_item_package_type_id_package_type_id_fk" FOREIGN KEY ("package_type_id") REFERENCES "public"."package_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_type_item" ADD CONSTRAINT "package_type_item_price_item_id_price_item_id_fk" FOREIGN KEY ("price_item_id") REFERENCES "public"."price_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "discount_preset_name_lower_key" ON "discount_preset" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "package_type_name_lower_key" ON "package_type" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "package_type_item_price_item_idx" ON "package_type_item" USING btree ("price_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "price_item_label_lower_key" ON "price_item" USING btree (lower("label"));
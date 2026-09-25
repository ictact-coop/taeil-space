CREATE TYPE "public"."discount_kind" AS ENUM('percent', 'amount');--> statement-breakpoint
CREATE TABLE "discount_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"kind" "discount_kind" NOT NULL,
	"value" integer NOT NULL,
	"proof_required" boolean DEFAULT true NOT NULL,
	"proof_guide" text DEFAULT '' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discount_rules_value_range" CHECK (("discount_rules"."kind" = 'percent' and "discount_rules"."value" between 1 and 100) or ("discount_rules"."kind" = 'amount' and "discount_rules"."value" > 0))
);
--> statement-breakpoint
CREATE TABLE "fee_schedules" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"items" jsonb NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "extra_consents" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "discount_rules" ADD CONSTRAINT "discount_rules_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_schedules" ADD CONSTRAINT "fee_schedules_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fee_schedules_effective_idx" ON "fee_schedules" USING btree ("effective_from" DESC NULLS LAST,"id" DESC NULLS LAST);
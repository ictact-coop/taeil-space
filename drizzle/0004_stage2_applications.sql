CREATE TYPE "public"."attachment_kind" AS ENUM('event_plan', 'discount_proof', 'other');--> statement-breakpoint
CREATE TYPE "public"."scan_status" AS ENUM('clean', 'infected', 'unscanned', 'error');--> statement-breakpoint
CREATE TABLE "application_counters" (
	"month" text PRIMARY KEY NOT NULL,
	"last" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid,
	"upload_token_hash" text NOT NULL,
	"kind" "attachment_kind" NOT NULL,
	"original_name" text NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"sha256" text NOT NULL,
	"scan_status" "scan_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attachments_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "space_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"alt" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "space_photos_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "event_public" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "discount_rule_id" uuid;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "option_keys" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "access_token_hash" text;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_photos" ADD CONSTRAINT "space_photos_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_photos" ADD CONSTRAINT "space_photos_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachments_application_idx" ON "attachments" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "attachments_token_idx" ON "attachments" USING btree ("upload_token_hash");--> statement-breakpoint
CREATE INDEX "space_photos_space_idx" ON "space_photos" USING btree ("space_id","sort_order");--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_discount_rule_id_discount_rules_id_fk" FOREIGN KEY ("discount_rule_id") REFERENCES "public"."discount_rules"("id") ON DELETE no action ON UPDATE no action;
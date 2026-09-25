CREATE TYPE "public"."admin_role" AS ENUM('rental', 'accounting', 'system');--> statement-breakpoint
CREATE TYPE "public"."application_status" AS ENUM('draft', 'pending_payment', 'payment_expired', 'submitted', 'reviewing', 'revision_requested', 'closed_revision_expired', 'rejected', 'withdrawn', 'confirmed', 'cancel_requested', 'cancelled', 'refunded', 'completed');--> statement-breakpoint
CREATE TYPE "public"."audit_actor_type" AS ENUM('admin', 'system', 'applicant');--> statement-breakpoint
CREATE TYPE "public"."closure_rule_type" AS ENUM('weekly', 'annual', 'date_range', 'open_exception');--> statement-breakpoint
CREATE TYPE "public"."occupancy_kind" AS ENUM('pending_payment', 'held', 'confirmed', 'block');--> statement-breakpoint
CREATE TYPE "public"."org_reg_type" AS ENUM('unique_no', 'business_no');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('pg', 'bank_transfer', 'free');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('ready', 'paid', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."refund_basis" AS ENUM('rejected', 'revision_expired', 'withdrawn', 'cancelled', 'venue_fault', 'late_payment');--> statement-breakpoint
CREATE TYPE "public"."refund_status" AS ENUM('requested', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."schedule_block_kind" AS ENUM('event', 'maintenance', 'temporary');--> statement-breakpoint
CREATE TABLE "admin_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"mfa_verified" boolean DEFAULT false NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"login_id" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "admin_role" NOT NULL,
	"totp_secret_enc" text,
	"totp_pending_secret_enc" text,
	"totp_enabled_at" timestamp with time zone,
	"totp_last_step" bigint,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_users_login_id_unique" UNIQUE("login_id")
);
--> statement-breakpoint
CREATE TABLE "application_status_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"application_id" uuid NOT NULL,
	"from_status" "application_status",
	"to_status" "application_status" NOT NULL,
	"actor_type" "audit_actor_type" NOT NULL,
	"actor_id" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_no" text NOT NULL,
	"status" "application_status" DEFAULT 'draft' NOT NULL,
	"space_id" uuid NOT NULL,
	"organization_id" uuid,
	"org_name" text NOT NULL,
	"contact_name" text NOT NULL,
	"contact_phone" text NOT NULL,
	"contact_email" text NOT NULL,
	"event_title" text NOT NULL,
	"event_purpose" text NOT NULL,
	"expected_headcount" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"night_manager_name" text,
	"night_manager_phone" text,
	"price_snapshot" jsonb,
	"policy_snapshot" jsonb,
	"total_amount" integer,
	"consents" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"submitted_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"decision_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "applications_application_no_unique" UNIQUE("application_no"),
	CONSTRAINT "applications_range" CHECK ("applications"."starts_at" < "applications"."ends_at"),
	CONSTRAINT "applications_headcount_positive" CHECK ("applications"."expected_headcount" > 0)
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_type" "audit_actor_type" NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_windows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"opens_from" date NOT NULL,
	"opens_until" date NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_windows_range" CHECK ("booking_windows"."opens_from" <= "booking_windows"."opens_until")
);
--> statement-breakpoint
CREATE TABLE "closure_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "closure_rule_type" NOT NULL,
	"name" text NOT NULL,
	"public_message" text NOT NULL,
	"space_id" uuid,
	"weekday" smallint,
	"month" smallint,
	"day" smallint,
	"start_date" date,
	"end_date" date,
	"active_from" date,
	"active_until" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "closure_rules_shape" CHECK ((
        ("closure_rules"."type" = 'weekly' and "closure_rules"."weekday" between 0 and 6)
        or ("closure_rules"."type" = 'annual' and "closure_rules"."month" between 1 and 12 and "closure_rules"."day" between 1 and 31)
        or ("closure_rules"."type" in ('date_range', 'open_exception') and "closure_rules"."start_date" is not null and "closure_rules"."end_date" is not null and "closure_rules"."start_date" <= "closure_rules"."end_date")
      ))
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reg_type" "org_reg_type" NOT NULL,
	"reg_no" text NOT NULL,
	"latest_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_reg_no_unique" UNIQUE("reg_no")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"order_id" text NOT NULL,
	"method" "payment_method" NOT NULL,
	"amount" integer NOT NULL,
	"status" "payment_status" DEFAULT 'ready' NOT NULL,
	"provider_tx_id" text,
	"provider_raw" jsonb,
	"failure_reason" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "payments_amount_nonnegative" CHECK ("payments"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "policy_values" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"basis" "refund_basis" NOT NULL,
	"rate_percent" integer NOT NULL,
	"amount" integer NOT NULL,
	"status" "refund_status" DEFAULT 'requested' NOT NULL,
	"reason" text,
	"provider_raw" jsonb,
	"failure_reason" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"requested_by" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_amount_positive" CHECK ("refunds"."amount" > 0),
	CONSTRAINT "refunds_rate_range" CHECK ("refunds"."rate_percent" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "schedule_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "schedule_block_kind" NOT NULL,
	"space_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_blocks_range" CHECK ("schedule_blocks"."starts_at" < "schedule_blocks"."ends_at")
);
--> statement-breakpoint
CREATE TABLE "slot_occupancies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"during" "tstzrange" NOT NULL,
	"kind" "occupancy_kind" NOT NULL,
	"application_id" uuid,
	"schedule_block_id" uuid,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slot_occupancies_owner" CHECK ((
        ("slot_occupancies"."kind" = 'block' and "slot_occupancies"."schedule_block_id" is not null and "slot_occupancies"."application_id" is null)
        or ("slot_occupancies"."kind" <> 'block' and "slot_occupancies"."application_id" is not null and "slot_occupancies"."schedule_block_id" is null)
      )),
	CONSTRAINT "slot_occupancies_expiry" CHECK (("slot_occupancies"."kind" = 'pending_payment') = ("slot_occupancies"."expires_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "spaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"capacity" integer NOT NULL,
	"min_headcount" integer,
	"description" text DEFAULT '' NOT NULL,
	"equipment" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notice" text DEFAULT '' NOT NULL,
	"lead_days" integer,
	"slot_minutes" integer DEFAULT 60 NOT NULL,
	"min_duration_minutes" integer DEFAULT 60 NOT NULL,
	"buffer_before_minutes" integer DEFAULT 0 NOT NULL,
	"buffer_after_minutes" integer DEFAULT 0 NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spaces_code_unique" UNIQUE("code"),
	CONSTRAINT "spaces_capacity_positive" CHECK ("spaces"."capacity" > 0),
	CONSTRAINT "spaces_slot_positive" CHECK ("spaces"."slot_minutes" > 0)
);
--> statement-breakpoint
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_admin_user_id_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_status_history" ADD CONSTRAINT "application_status_history_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_decided_by_admin_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_windows" ADD CONSTRAINT "booking_windows_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_windows" ADD CONSTRAINT "booking_windows_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closure_rules" ADD CONSTRAINT "closure_rules_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closure_rules" ADD CONSTRAINT "closure_rules_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_values" ADD CONSTRAINT "policy_values_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_requested_by_admin_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_blocks" ADD CONSTRAINT "schedule_blocks_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_blocks" ADD CONSTRAINT "schedule_blocks_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot_occupancies" ADD CONSTRAINT "slot_occupancies_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot_occupancies" ADD CONSTRAINT "slot_occupancies_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot_occupancies" ADD CONSTRAINT "slot_occupancies_schedule_block_id_schedule_blocks_id_fk" FOREIGN KEY ("schedule_block_id") REFERENCES "public"."schedule_blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_sessions_user_idx" ON "admin_sessions" USING btree ("admin_user_id");--> statement-breakpoint
CREATE INDEX "application_status_history_app_idx" ON "application_status_history" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "applications_status_idx" ON "applications" USING btree ("status");--> statement-breakpoint
CREATE INDEX "applications_org_idx" ON "applications" USING btree ("organization_id","starts_at");--> statement-breakpoint
CREATE INDEX "applications_space_idx" ON "applications" USING btree ("space_id","starts_at");--> statement-breakpoint
CREATE INDEX "audit_logs_target_idx" ON "audit_logs" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "payments_application_idx" ON "payments" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "policy_values_key_effective_idx" ON "policy_values" USING btree ("key","effective_from" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "refunds_status_idx" ON "refunds" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "slot_occupancies_application_uq" ON "slot_occupancies" USING btree ("application_id");
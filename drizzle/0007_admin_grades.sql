CREATE TABLE "admin_grades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_super" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_grades_code_unique" UNIQUE("code"),
	CONSTRAINT "admin_grades_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN "grade_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_grades_single_super_uq" ON "admin_grades" USING btree ("is_super") WHERE "admin_grades"."is_super";--> statement-breakpoint
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_grade_id_admin_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "public"."admin_grades"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- 기본 등급. 권한 키는 src/domain/auth/permissions.ts 참고. 이후 관리 화면(등급 관리)에서 바꿀 수 있다.
INSERT INTO "admin_grades" ("code", "name", "description", "permissions", "is_super", "sort_order") VALUES
  ('super', '시스템 최고 관리자', '모든 기능과 정책 설정, 계정·등급 관리, 감사 로그', '{}', true, 10),
  ('staff', '기념관 내부 임직원', '신청 조회·심사, 환불 처리, 휴관일·일정 차단·접수기간 관리, 정책 설정 조회',
    '{applications.view,applications.review,refunds.manage,calendar.view,schedule.manage,settings.view}', false, 20),
  ('club', '동아리 운영자', '대관 일정 확인. 필요한 권한은 등급 관리에서 더한다',
    '{calendar.view}', false, 30);
--> statement-breakpoint
-- 기존 역할 이관: 시스템 관리자 → 최고 관리자, 대관·회계 담당자 → 내부 임직원
UPDATE "admin_users" SET "grade_id" = (SELECT "id" FROM "admin_grades" WHERE "code" = CASE WHEN "admin_users"."role" = 'system' THEN 'super' ELSE 'staff' END);

ALTER TABLE "applicant_sessions" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "applicant_sessions" ADD COLUMN "application_ids" jsonb;--> statement-breakpoint
ALTER TABLE "applicant_sessions" ADD COLUMN "label" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "applicant_password_hash" text;--> statement-breakpoint
-- 기존 신청의 나의 대관 비밀번호를 0000으로(argon2id 해시). 신청자가 전화번호+0000으로 볼 수 있다
UPDATE "applications" SET "applicant_password_hash" = '$argon2id$v=19$m=19456,t=2,p=1$P9gb8Bt5TaQXs8LMtQ4MNg$Dv+w6p1YenjN8/1RNzN4b6FXr8NwyhgwKyJmGYWIjfg' WHERE "applicant_password_hash" IS NULL;--> statement-breakpoint
UPDATE "applicant_sessions" SET "label" = "email" WHERE "label" = '' AND "email" IS NOT NULL;
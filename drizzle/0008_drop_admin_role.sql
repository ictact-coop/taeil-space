ALTER TABLE "admin_users" ALTER COLUMN "grade_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_users" DROP COLUMN "role";--> statement-breakpoint
DROP TYPE "public"."admin_role";
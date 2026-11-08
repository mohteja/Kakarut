ALTER TYPE "public"."user_role" ADD VALUE 'hrd';--> statement-breakpoint
ALTER TABLE "memberships" DROP CONSTRAINT "memberships_cashier_branch_ck";--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_cashier_branch_ck" CHECK ("memberships"."role"::text NOT IN ('cashier','tim','kitchen','bar') OR "memberships"."branch_id" IS NOT NULL);
ALTER TYPE "public"."user_role" ADD VALUE 'tim';--> statement-breakpoint
ALTER TABLE "memberships" DROP CONSTRAINT "memberships_cashier_branch_ck";--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "latitude" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "longitude" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "radius_absen_m" integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_cashier_branch_ck" CHECK ("memberships"."role" IN ('owner','admin') OR "memberships"."branch_id" IS NOT NULL);
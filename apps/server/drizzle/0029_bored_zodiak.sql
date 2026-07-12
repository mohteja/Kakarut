CREATE TYPE "public"."branch_tipe" AS ENUM('store', 'central_kitchen');--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "tipe" "branch_tipe" DEFAULT 'store' NOT NULL;
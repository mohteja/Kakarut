CREATE TYPE "public"."produksi_di" AS ENUM('ck', 'cabang');--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE 'kitchen';--> statement-breakpoint
ALTER TABLE "ingredients" ADD COLUMN "produksi_di" "produksi_di" DEFAULT 'ck' NOT NULL;
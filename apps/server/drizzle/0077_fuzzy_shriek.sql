CREATE TYPE "public"."divisi_produksi" AS ENUM('kitchen', 'bar');--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE 'bar';--> statement-breakpoint
ALTER TABLE "ingredients" ADD COLUMN "divisi_produksi" "divisi_produksi" DEFAULT 'kitchen' NOT NULL;
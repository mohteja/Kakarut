CREATE TYPE "public"."metode_bayar" AS ENUM('tunai', 'qris', 'transfer');--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "metode_bayar" "metode_bayar" DEFAULT 'tunai' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "uang_diterima" numeric(14, 2);
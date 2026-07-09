CREATE TYPE "public"."pengadaan" AS ENUM('produksi', 'beli');--> statement-breakpoint
ALTER TABLE "ingredients" ADD COLUMN "pengadaan" "pengadaan" DEFAULT 'beli' NOT NULL;--> statement-breakpoint
ALTER TABLE "productions" ADD COLUMN "tipe" "pengadaan" DEFAULT 'produksi' NOT NULL;--> statement-breakpoint
ALTER TABLE "productions" ADD COLUMN "total_harga" numeric(14, 2);
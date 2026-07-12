CREATE TYPE "public"."dana_tipe" AS ENUM('cair', 'tambahan', 'kembali');--> statement-breakpoint
ALTER TABLE "faktur_dana" ADD COLUMN "tipe" "dana_tipe" DEFAULT 'cair' NOT NULL;
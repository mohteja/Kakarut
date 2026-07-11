ALTER TYPE "public"."konfirmasi_status" ADD VALUE 'ditolak';--> statement-breakpoint
ALTER TABLE "productions" ADD COLUMN "qty_dipesan" numeric(16, 6);--> statement-breakpoint
ALTER TABLE "productions" ADD COLUMN "alasan_tolak" text;
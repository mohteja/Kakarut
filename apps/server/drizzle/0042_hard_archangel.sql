ALTER TABLE "ingredients" ADD COLUMN "stok_minimum_toko" numeric(16, 6) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ingredients" ADD COLUMN "overhead_x" numeric(8, 4) DEFAULT 1 NOT NULL;
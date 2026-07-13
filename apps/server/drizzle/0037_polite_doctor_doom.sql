ALTER TABLE "productions" ADD COLUMN "rencana_id" uuid;--> statement-breakpoint
-- Backfill: permintaan "Tambah Stok dari Menu" lama (sebelum kolom ini) tetap
-- muncul di "Data Permintaan Stok". Ditandai lewat faktur_logs (aksi unik),
-- dikelompokkan per-faktur (rencana_id = faktur_id) karena tak ada penanda
-- batch bersama pada data lama.
UPDATE "productions" SET "rencana_id" = "faktur_id"
WHERE "faktur_id" IN (
  SELECT "faktur_id" FROM "faktur_logs" WHERE "aksi" = 'Permintaan tambah stok'
);
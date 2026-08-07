-- Refund ditautkan ke shift yang menanggungnya, sejajar dengan `sales.shift_id`.
--
-- Sebelumnya refund dicocokkan ke shift MURNI lewat jendela waktu
-- [opened_at, closed_at]. Refund yang dibuat saat TAK ADA shift terbuka —
-- owner/admin meninjau transaksi di luar jam buka, jalur yang memang
-- disengaja — jatuh di luar jendela shift mana pun, jadi uang tunai yang
-- keluar laci tak pernah dikurangkan dari kas harapan shift mana pun.
ALTER TABLE "sale_refunds" ADD COLUMN IF NOT EXISTS "shift_id" uuid;

DO $$ BEGIN
  ALTER TABLE "sale_refunds"
    ADD CONSTRAINT "sale_refunds_shift_id_shifts_id_fk"
    FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Backfill baris lama memakai aturan lama (jendela waktu), supaya rekap shift
-- yang sudah ditutup TIDAK bergeser oleh migrasi ini. Sesudah backfill,
-- `shift_id IS NULL` punya arti tunggal dan tegas: "tak ada shift terbuka saat
-- refund dibuat" — dan itulah yang dipakai aturan penyapuan di rekap.
UPDATE "sale_refunds" sr
SET "shift_id" = s."id"
FROM "shifts" s
WHERE s."company_id" = sr."company_id"
  AND s."branch_id" = sr."branch_id"
  AND sr."created_at" >= s."opened_at"
  AND (s."closed_at" IS NULL OR sr."created_at" <= s."closed_at")
  AND sr."shift_id" IS NULL;

CREATE INDEX IF NOT EXISTS "sale_refunds_shift_idx" ON "sale_refunds" ("shift_id");

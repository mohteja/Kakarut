ALTER TABLE "sale_refunds" ADD COLUMN "shift_id" uuid;--> statement-breakpoint
ALTER TABLE "sale_refunds" ADD CONSTRAINT "sale_refunds_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sale_refunds_shift_idx" ON "sale_refunds" USING btree ("shift_id");;--> statement-breakpoint
-- Backfill baris lama memakai aturan LAMA (jendela waktu). Dua alasan, keduanya
-- perlu: rekap shift yang SUDAH DITUTUP tidak boleh bergeser gara-gara migrasi
-- ini, dan invarian yang dipakai rekap — "shift_id NULL = tak ada shift terbuka
-- saat refund dibuat" — harus benar sejak baris pertama. Tanpa backfill ini,
-- seluruh refund lama ber-shift_id NULL akan tersapu ke shift yang salah.
UPDATE "sale_refunds" sr
SET "shift_id" = s."id"
FROM "shifts" s
WHERE s."company_id" = sr."company_id"
  AND s."branch_id" = sr."branch_id"
  AND sr."created_at" >= s."opened_at"
  AND (s."closed_at" IS NULL OR sr."created_at" <= s."closed_at")
  AND sr."shift_id" IS NULL;

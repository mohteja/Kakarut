-- Status pesanan (dikerjakan/selesai/batal) + penanda take away turun dari
-- KEPALA bill/penjualan ke SETIAP BARIS-nya.
--
-- Alasannya: satu bill bisa berisi banyak sajian yang selesai pada waktu
-- berbeda. Dengan status di kepala, dapur hanya bisa bilang "seluruh bill ini
-- selesai" — padahal yang mereka butuhkan adalah menandai satu per satu supaya
-- terlihat mana yang sudah keluar dan mana yang belum. Status kartu sekarang
-- DITURUNKAN dari baris-barisnya (semua selesai/batal → kartu selesai/batal),
-- jadi tidak ada lagi angka agregat yang bisa ketinggalan zaman.
--
-- BACKFILL WAJIB ADA DI SINI. Statement DROP COLUMN di bawah membuang kolom
-- kepala, jadi tanpa penyalinan ini setiap bill yang sedang dikerjakan dapur
-- dan setiap penjualan yang sudah ditandai akan diam-diam kembali ke default
-- 'dikerjakan' + take away = false. Pekerjaan dapur yang sedang berjalan
-- hilang, dan penanda penyajian yang sudah dikoreksi kasir ikut hilang.
-- Seluruh berkas ini berjalan dalam satu transaksi (migrator node-postgres),
-- jadi salinan dan DROP-nya berhasil bersama atau gagal bersama.
--
-- Urutannya: ADD COLUMN → SALIN dari kepala → DROP COLUMN kepala.
ALTER TABLE "open_bills" DROP CONSTRAINT "open_bills_pesanan_status_oleh_users_id_fk";
--> statement-breakpoint
ALTER TABLE "sales" DROP CONSTRAINT "sales_pesanan_status_oleh_users_id_fk";
--> statement-breakpoint
ALTER TABLE "open_bill_items" ADD COLUMN "pesanan_status" "pesanan_status" DEFAULT 'dikerjakan' NOT NULL;--> statement-breakpoint
ALTER TABLE "open_bill_items" ADD COLUMN "pesanan_status_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "open_bill_items" ADD COLUMN "pesanan_status_oleh" uuid;--> statement-breakpoint
ALTER TABLE "open_bill_items" ADD COLUMN "sajian_takeaway" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pesanan_logs" ADD COLUMN "item_nama" text;--> statement-breakpoint
ALTER TABLE "sale_items" ADD COLUMN "pesanan_status" "pesanan_status" DEFAULT 'dikerjakan' NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_items" ADD COLUMN "pesanan_status_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sale_items" ADD COLUMN "pesanan_status_oleh" uuid;--> statement-breakpoint
ALTER TABLE "sale_items" ADD COLUMN "sajian_takeaway" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "open_bill_items" AS obi SET
  "pesanan_status" = ob."pesanan_status",
  "pesanan_status_at" = ob."pesanan_status_at",
  "pesanan_status_oleh" = ob."pesanan_status_oleh",
  "sajian_takeaway" = ob."sajian_takeaway"
FROM "open_bills" AS ob
WHERE ob."id" = obi."bill_id";--> statement-breakpoint
UPDATE "sale_items" AS si SET
  "pesanan_status" = s."pesanan_status",
  "pesanan_status_at" = s."pesanan_status_at",
  "pesanan_status_oleh" = s."pesanan_status_oleh",
  "sajian_takeaway" = s."sajian_takeaway"
FROM "sales" AS s
WHERE s."id" = si."sale_id";--> statement-breakpoint
-- Baris yang MEMANG dibukukan bawa pulang harus tampil bawa pulang di papan.
--
-- Dulu ini backfill boot (`sajian_takeaway_awal`) yang membaca kolom kepala.
-- Kolomnya dibuang di bawah, jadi backfill-nya ikut dihapus dan aturannya
-- pindah ke sini — sekarang per baris, yang juga lebih tepat: satu bill bisa
-- berisi baris dine-in dan baris bawa pulang sekaligus (`dine_in_override`).
--
-- Hanya menyentuh baris yang masih memakai nilai bawaan, jadi ia tidak pernah
-- menimpa penanda yang sudah disalin dari kepala di atas.
UPDATE "sale_items" SET "sajian_takeaway" = true
 WHERE "sajian_takeaway" = false AND "is_dine_in" = false;--> statement-breakpoint
UPDATE "open_bill_items" SET "sajian_takeaway" = true
 WHERE "sajian_takeaway" = false AND "dine_in_override" = false;--> statement-breakpoint
ALTER TABLE "open_bill_items" ADD CONSTRAINT "open_bill_items_pesanan_status_oleh_users_id_fk" FOREIGN KEY ("pesanan_status_oleh") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_pesanan_status_oleh_users_id_fk" FOREIGN KEY ("pesanan_status_oleh") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "open_bill_items_status_idx" ON "open_bill_items" USING btree ("bill_id","pesanan_status");--> statement-breakpoint
CREATE INDEX "sale_items_status_idx" ON "sale_items" USING btree ("sale_id","pesanan_status");--> statement-breakpoint
ALTER TABLE "open_bills" DROP COLUMN "pesanan_status";--> statement-breakpoint
ALTER TABLE "open_bills" DROP COLUMN "pesanan_status_at";--> statement-breakpoint
ALTER TABLE "open_bills" DROP COLUMN "pesanan_status_oleh";--> statement-breakpoint
ALTER TABLE "open_bills" DROP COLUMN "sajian_takeaway";--> statement-breakpoint
ALTER TABLE "sales" DROP COLUMN "pesanan_status";--> statement-breakpoint
ALTER TABLE "sales" DROP COLUMN "pesanan_status_at";--> statement-breakpoint
ALTER TABLE "sales" DROP COLUMN "pesanan_status_oleh";--> statement-breakpoint
ALTER TABLE "sales" DROP COLUMN "sajian_takeaway";

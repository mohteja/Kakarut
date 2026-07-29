-- Satu area maksimal satu baris per laporan kebersihan.
--
-- Indeks ini menutup satu-satunya jalur yang bisa menggandakan checklist: dua
-- perangkat mem-PATCH laporan yang sama nyaris bersamaan. Membungkus PATCH
-- dalam transaksi TIDAK cukup — di READ COMMITTED, transaksi kedua menghapus 0
-- baris (yang pertama sudah menghapusnya) lalu tetap menyisipkan set
-- lengkapnya, jadi barisnya jadi dua kali lipat. Esok harinya laporan itu
-- terkunci (PATCH lintas-tanggal ditolak 409) sehingga angka gandanya membeku
-- selamanya di rekap owner.
--
-- DEDUP DULU, baru indeksnya dibuat: tanpa ini migrasi GAGAL di database mana
-- pun yang sudah terlanjur punya duplikat — dan karena migrasi dijalankan saat
-- boot, kegagalannya menjatuhkan server, bukan sekadar membatalkan rilis.
-- Seluruh berkas ini berjalan dalam satu transaksi, jadi dedup dan indeksnya
-- berhasil bersama atau gagal bersama.
--
-- Baris yang DIPERTAHANKAN adalah yang paling berisi: berfoto lebih dulu, lalu
-- yang bercatatan, lalu `id` terkecil sebagai pemutus imbang yang deterministik.
-- Duplikat dari balapan PATCH sebetulnya salinan identik, tapi urutan ini
-- membuat hasilnya tetap benar seandainya isinya ternyata berbeda.
--
-- `area_id` NULL (area masternya sudah dihapus) SENGAJA dilewati: Postgres
-- memperlakukan NULL sebagai saling berbeda, jadi laporan lama tetap boleh
-- punya banyak baris tanpa area dan tak ada satu pun yang perlu dibuang.
DELETE FROM "cleaning_report_items"
WHERE "id" IN (
  SELECT "id" FROM (
    SELECT "id", row_number() OVER (
      PARTITION BY "report_id", "area_id"
      ORDER BY ("foto_url" IS NOT NULL) DESC, ("catatan" IS NOT NULL) DESC, "id"
    ) AS rn
    FROM "cleaning_report_items"
    WHERE "area_id" IS NOT NULL
  ) t WHERE t.rn > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX "cleaning_report_items_report_area_uq" ON "cleaning_report_items" USING btree ("report_id","area_id");

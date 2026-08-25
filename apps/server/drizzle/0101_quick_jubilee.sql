ALTER TABLE "open_bills" ADD COLUMN "pernah_jadi_penjualan" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- ISI ULANG BARIS LAMA.
--
-- Tanpa baris ini, setiap bill yang sudah dibayar SEBELUM migrasi ini berdiri
-- dengan `pernah_jadi_penjualan = false` — dan sejak itu ia terbaca "dibatalkan"
-- oleh kedua pemakainya, persis cacat yang sedang diperbaiki. Bedanya cuma
-- pemicunya: bukan penghapusan penjualan, melainkan penerapan migrasinya
-- sendiri.
--
-- `sale_id IS NOT NULL` sumber kebenaran yang benar DI SAAT INI: ia baru
-- kehilangan artinya kalau penjualannya dihapus, dan yang sudah telanjur
-- terhapus memang tak bisa dipulihkan dari mana pun.
UPDATE "open_bills" SET "pernah_jadi_penjualan" = true WHERE "sale_id" IS NOT NULL;

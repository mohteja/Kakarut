ALTER TABLE "open_bill_items" ADD COLUMN "pesanan_masuk_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_items" ADD COLUMN "pesanan_masuk_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
-- Baris LAMA: `DEFAULT now()` mengisi seluruh riwayat dengan jam migrasi ini,
-- sehingga setiap pesanan lampau tampak diselesaikan SEBELUM ia dipesan —
-- durasinya negatif dan rata-rata per menu di laporan jadi omong kosong.
-- Diisi dari induknya, sedekat mungkin dengan kenyataan: waktu penjualan untuk
-- baris nota, waktu bill dibuka untuk baris bill.
--
-- Ketelitiannya memang terbatas untuk ronde kedua pada bill lama — datanya
-- tidak pernah direkam, jadi tak ada yang bisa memulihkannya. Yang penting:
-- angkanya masuk akal dan tak pernah negatif, bukan berpura-pura tepat.
UPDATE "sale_items" si SET "pesanan_masuk_at" = s."waktu"
  FROM "sales" s WHERE si."sale_id" = s."id";--> statement-breakpoint
UPDATE "open_bill_items" obi SET "pesanan_masuk_at" = b."created_at"
  FROM "open_bills" b WHERE obi."bill_id" = b."id";--> statement-breakpoint
-- Jaring pengaman: baris yang entah bagaimana selesai LEBIH DULU dari waktu
-- masuknya (jam server pernah mundur, atau data warisan yang tak konsisten)
-- disamakan saja, supaya tak ada durasi negatif yang lolos ke laporan.
UPDATE "sale_items" SET "pesanan_masuk_at" = "pesanan_status_at"
  WHERE "pesanan_status_at" IS NOT NULL AND "pesanan_status_at" < "pesanan_masuk_at";--> statement-breakpoint
UPDATE "open_bill_items" SET "pesanan_masuk_at" = "pesanan_status_at"
  WHERE "pesanan_status_at" IS NOT NULL AND "pesanan_status_at" < "pesanan_masuk_at";

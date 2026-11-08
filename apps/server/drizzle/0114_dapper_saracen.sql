CREATE TYPE "public"."jenis_menu" AS ENUM('makanan', 'minuman');--> statement-breakpoint
ALTER TABLE "menu_categories" ADD COLUMN "jenis" "jenis_menu" DEFAULT 'makanan' NOT NULL;--> statement-breakpoint
-- Kategori yang sudah ada ditebak dari namanya — pola yang sama dengan
-- `tebakJenisKategori` di packages/shared/src/pesanan.ts. Pemilik tinggal
-- mengoreksi yang salah di pengaturan Kategori Menu.
UPDATE "menu_categories" SET "jenis" = 'minuman'
WHERE "nama" ~* '\m(minum\w*|es|ice|iced|jus|juice|kopi|coffee|teh|tea|drink\w*|susu|milk|boba|soda|sirup|wedang|lemon\w*)\M';

-- Open bill mengunci harga jual per baris.
-- Kolom ditambah NULLABLE dulu, di-backfill dari katalog menu, baru dijadikan
-- NOT NULL — bill yang sedang terbuka saat rilis tidak menyimpan harga saat
-- dipesan (data itu memang tak pernah ada), jadi dikunci ke harga menu saat ini.
ALTER TABLE "open_bill_items" ADD COLUMN "harga_satuan" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "open_bill_items" ADD COLUMN "menu_nama" text;--> statement-breakpoint
UPDATE "open_bill_items" AS obi
SET "harga_satuan" = m."harga_jual", "menu_nama" = m."nama"
FROM "menus" AS m
WHERE m."id" = obi."menu_id";--> statement-breakpoint
UPDATE "open_bill_items" SET "harga_satuan" = 0 WHERE "harga_satuan" IS NULL;--> statement-breakpoint
UPDATE "open_bill_items" SET "menu_nama" = 'Menu' WHERE "menu_nama" IS NULL;--> statement-breakpoint
ALTER TABLE "open_bill_items" ALTER COLUMN "harga_satuan" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "open_bill_items" ALTER COLUMN "menu_nama" SET NOT NULL;

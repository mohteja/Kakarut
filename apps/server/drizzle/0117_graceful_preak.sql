CREATE TABLE "antrean_take_away" (
	"branch_id" uuid NOT NULL,
	"tanggal" date NOT NULL,
	"terakhir" integer NOT NULL,
	CONSTRAINT "antrean_take_away_branch_id_tanggal_pk" PRIMARY KEY("branch_id","tanggal")
);
--> statement-breakpoint
ALTER TABLE "open_bills" ADD COLUMN "nomor_antrean" integer;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "nomor_antrean" integer;--> statement-breakpoint
ALTER TABLE "antrean_take_away" ADD CONSTRAINT "antrean_take_away_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- "Kasir & Take Away" wajib ada di tiap cabang (permintaan pemilik 2026-11-11).
-- 1) Ganti nama "Ruang Tunggu" bawaan — hanya bila nama barunya belum dipakai.
UPDATE "meja" SET "nama" = 'Kasir & Take Away'
WHERE "tipe" = 'takeaway' AND "nama" = 'Ruang Tunggu'
  AND NOT EXISTS (
    SELECT 1 FROM "meja" m2 WHERE m2."branch_id" = "meja"."branch_id" AND m2."nama" = 'Kasir & Take Away'
  );--> statement-breakpoint
-- 2) Cabang tanpa meja take away AKTIF: hidupkan lagi yang dinonaktifkan (satu saja).
UPDATE "meja" SET "is_active" = true
WHERE "id" IN (
  SELECT DISTINCT ON (m."branch_id") m."id" FROM "meja" m
  WHERE m."tipe" = 'takeaway' AND m."is_active" = false
    AND NOT EXISTS (
      SELECT 1 FROM "meja" a WHERE a."branch_id" = m."branch_id" AND a."tipe" = 'takeaway' AND a."is_active"
    )
  ORDER BY m."branch_id", m."created_at", m."id"
);--> statement-breakpoint
-- 3) Cabang yang sama sekali tak punya: buatkan.
INSERT INTO "meja" ("company_id", "branch_id", "nama", "tipe", "pos_x", "pos_y")
SELECT b."company_id", b."id", 'Kasir & Take Away', 'takeaway', 20, 25
FROM "branches" b
WHERE NOT EXISTS (SELECT 1 FROM "meja" m WHERE m."branch_id" = b."id" AND m."tipe" = 'takeaway')
ON CONFLICT DO NOTHING;

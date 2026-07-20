import { sql } from "drizzle-orm";
import type { db as Db } from "../../db/client";

/**
 * Pindahkan RAK SIMPAN lama per bahan (kolom warisan `ingredients.storage_location_id`,
 * dulu diatur di form Bahan Baku) ke penugasan per cabang `storage_location_ingredients`
 * (kini sumber tunggal — diatur di Tempat Penyimpanan). Jalan sekali saat boot:
 * salin bila belum ada rak untuk bahan itu DI CABANG yang sama (jaga 1 bahan = 1
 * rak per cabang), lalu KOSONGKAN kolom warisan agar tak menyemai ulang setelah
 * user memindahkan rak. Idempoten (boot berikut: kolom sudah kosong → 0 baris).
 */
export async function backfillRakSimpanKeSli(database: typeof Db): Promise<number> {
  const ins = await database.execute(sql`
    INSERT INTO storage_location_ingredients (company_id, storage_location_id, ingredient_id)
    SELECT i.company_id, i.storage_location_id, i.id
    FROM ingredients i
    JOIN storage_locations home ON home.id = i.storage_location_id
    WHERE i.storage_location_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM storage_location_ingredients sli
        JOIN storage_locations sl ON sl.id = sli.storage_location_id
        WHERE sli.ingredient_id = i.id AND sl.branch_id = home.branch_id
      )
    ON CONFLICT DO NOTHING
  `);
  await database.execute(
    sql`UPDATE ingredients SET storage_location_id = NULL WHERE storage_location_id IS NOT NULL`,
  );
  return (ins as { rowCount?: number }).rowCount ?? 0;
}

/**
 * Pindahkan RAK SIMPAN lama per PERLENGKAPAN (kolom warisan
 * `supplies.storage_location_id`, dulu diatur di form Perlengkapan) ke penugasan
 * per cabang `storage_location_ingredients` (kini SATU TABEL untuk bahan &
 * perlengkapan — diatur di Tempat Penyimpanan). Mirror `backfillRakSimpanKeSli`:
 * salin bila belum ada rak untuk perlengkapan itu DI CABANG yang sama, lalu
 * KOSONGKAN kolom warisan. Idempoten.
 */
export async function backfillRakPerlengkapanKeSli(database: typeof Db): Promise<number> {
  const ins = await database.execute(sql`
    INSERT INTO storage_location_ingredients (company_id, storage_location_id, supply_id)
    SELECT s.company_id, s.storage_location_id, s.id
    FROM supplies s
    JOIN storage_locations home ON home.id = s.storage_location_id
    WHERE s.storage_location_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM storage_location_ingredients sli
        JOIN storage_locations sl ON sl.id = sli.storage_location_id
        WHERE sli.supply_id = s.id AND sl.branch_id = home.branch_id
      )
    ON CONFLICT DO NOTHING
  `);
  await database.execute(
    sql`UPDATE supplies SET storage_location_id = NULL WHERE storage_location_id IS NOT NULL`,
  );
  return (ins as { rowCount?: number }).rowCount ?? 0;
}

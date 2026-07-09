import { sql } from "drizzle-orm";
import { saldoStok, statusStok, type StokRowDto } from "@kakarut/shared";
import { db } from "../../db/client";

/**
 * Saldo stok per bahan untuk satu cabang, diturunkan (bukan disimpan):
 *   baseline = opname terakhir; produksi & terpakai = akumulasi SETELAH
 *   opname tsb; saldo = baseline + produksi − terpakai.
 */
export async function hitungSaldoCabang(
  companyId: string,
  branchId: string,
): Promise<StokRowDto[]> {
  const result = await db.execute(sql`
    SELECT
      i.id          AS ingredient_id,
      i.slug        AS slug,
      i.nama        AS nama,
      i.kategori    AS kategori,
      i.isi         AS isi,
      COALESCE(b.qty, 0) AS stok_awal,
      COALESCE(p.qty, 0) AS produksi,
      COALESCE(u.qty, 0) AS terpakai
    FROM ingredients i
    LEFT JOIN LATERAL (
      SELECT so.qty, so.created_at
      FROM stock_opnames so
      WHERE so.branch_id = ${branchId} AND so.ingredient_id = i.id
      ORDER BY so.created_at DESC
      LIMIT 1
    ) b ON TRUE
    LEFT JOIN LATERAL (
      SELECT SUM(pr.qty) AS qty
      FROM productions pr
      WHERE pr.branch_id = ${branchId} AND pr.ingredient_id = i.id
        AND (b.created_at IS NULL OR pr.waktu > b.created_at)
    ) p ON TRUE
    LEFT JOIN LATERAL (
      SELECT SUM(sc.qty) AS qty
      FROM sale_consumptions sc
      WHERE sc.branch_id = ${branchId} AND sc.ingredient_id = i.id
        AND (b.created_at IS NULL OR sc.waktu > b.created_at)
    ) u ON TRUE
    WHERE i.company_id = ${companyId} AND i.is_active
    ORDER BY i.nama
  `);

  return result.rows.map((r) => {
    const row = r as Record<string, unknown>;
    const stokAwal = Number(row.stok_awal);
    const produksi = Number(row.produksi);
    const terpakai = Number(row.terpakai);
    return {
      ingredient_id: String(row.ingredient_id),
      slug: String(row.slug),
      nama: String(row.nama),
      kategori: row.kategori as StokRowDto["kategori"],
      isi: Number(row.isi),
      stok_awal: stokAwal,
      produksi,
      terpakai,
      saldo: saldoStok(stokAwal, produksi, terpakai),
      status: statusStok(stokAwal, produksi, terpakai),
    };
  });
}

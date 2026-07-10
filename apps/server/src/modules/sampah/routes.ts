import { sql } from "drizzle-orm";
import { Hono } from "hono";
import type { SampahRow } from "@kakarut/shared";
import { db } from "../../db/client";
import type { AppEnv } from "../../middleware/auth";

/**
 * Tempat Sampah — daftar transaksi yang di-soft-delete (penjualan + pembelian +
 * produksi). Hanya catatan siapa yang menghapus; TIDAK bisa dikembalikan.
 * Gerbang owner/admin dipasang di app.ts.
 */
export const sampahRoutes = new Hono<AppEnv>().get("/", async (c) => {
  const auth = c.get("auth");
  const companyId = auth.company_id!;

  const penjualan = await db.execute(sql`
    SELECT
      s.id::text          AS key,
      s.nomor             AS label,
      s.total             AS total,
      s.waktu             AS waktu,
      s.deleted_at        AS dihapus_pada,
      pb.nama             AS dibuat_oleh,
      ph.nama             AS dihapus_oleh
    FROM sales s
    LEFT JOIN users pb ON pb.id = s.cashier_user_id
    LEFT JOIN users ph ON ph.id = s.deleted_by
    WHERE s.company_id = ${companyId} AND s.deleted_at IS NOT NULL
  `);

  const stokMasuk = await db.execute(sql`
    SELECT
      COALESCE(pr.faktur_id::text, pr.id::text)  AS key,
      pr.tipe                                    AS tipe,
      string_agg(DISTINCT ing.nama, ', ')        AS label,
      COALESCE(SUM(pr.total_harga), 0)           AS total,
      MIN(pr.waktu)                              AS waktu,
      MAX(pr.deleted_at)                         AS dihapus_pada,
      MAX(pb.nama)                               AS dibuat_oleh,
      MAX(ph.nama)                               AS dihapus_oleh
    FROM productions pr
    JOIN ingredients ing ON ing.id = pr.ingredient_id
    LEFT JOIN users pb ON pb.id = pr.user_id
    LEFT JOIN users ph ON ph.id = pr.deleted_by
    WHERE pr.company_id = ${companyId} AND pr.deleted_at IS NOT NULL
    GROUP BY COALESCE(pr.faktur_id::text, pr.id::text), pr.tipe
  `);

  const rows: SampahRow[] = [
    ...penjualan.rows.map((r) => {
      const o = r as Record<string, unknown>;
      return {
        jenis: "penjualan" as const,
        key: String(o.key),
        label: String(o.label ?? ""),
        total: Number(o.total ?? 0),
        waktu: new Date(o.waktu as string).toISOString(),
        dibuat_oleh: o.dibuat_oleh != null ? String(o.dibuat_oleh) : null,
        dihapus_oleh: o.dihapus_oleh != null ? String(o.dihapus_oleh) : null,
        dihapus_pada: new Date(o.dihapus_pada as string).toISOString(),
      };
    }),
    ...stokMasuk.rows.map((r) => {
      const o = r as Record<string, unknown>;
      return {
        jenis: o.tipe === "beli" ? ("pembelian" as const) : ("produksi" as const),
        key: String(o.key),
        label: String(o.label ?? ""),
        total: Number(o.total ?? 0),
        waktu: new Date(o.waktu as string).toISOString(),
        dibuat_oleh: o.dibuat_oleh != null ? String(o.dibuat_oleh) : null,
        dihapus_oleh: o.dihapus_oleh != null ? String(o.dihapus_oleh) : null,
        dihapus_pada: new Date(o.dihapus_pada as string).toISOString(),
      };
    }),
  ].sort((a, b) => (a.dihapus_pada < b.dihapus_pada ? 1 : -1));

  return c.json(rows);
});

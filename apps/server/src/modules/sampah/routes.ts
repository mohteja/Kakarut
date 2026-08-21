import { zValidator } from "../../lib/validator";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { SampahRow } from "@kakarut/shared";
import { db } from "../../db/client";
import { productions, sales } from "../../db/schema";
import type { AppEnv } from "../../middleware/auth";

const PulihkanBody = z.object({
  jenis: z.enum(["penjualan", "pembelian", "produksi"]),
  key: z.string(),
});

/**
 * Tempat Sampah — transaksi yang di-SOFT-DELETE (penjualan + pembelian +
 * produksi). Bisa DIPULIHKAN (stok/laporan otomatis terhitung lagi karena
 * semua agregasi memfilter deleted_at IS NULL). Gerbang owner/admin di app.ts.
 */
export const sampahRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
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
  })
  /**
   * PULIHKAN dari Tempat Sampah: batalkan soft-delete. Penjualan per id;
   * pembelian/produksi per faktur (semua baris ber-key sama). Stok & laporan
   * langsung terhitung lagi.
   */
  .post("/pulihkan", zValidator("json", PulihkanBody), async (c) => {
    const auth = c.get("auth");
    const { jenis, key } = c.req.valid("json");
    if (!/^[0-9a-f-]{36}$/i.test(key)) {
      throw new HTTPException(404, { message: "Data tidak ditemukan" });
    }
    if (jenis === "penjualan") {
      const [row] = await db
        .update(sales)
        .set({ deletedAt: null, deletedBy: null })
        .where(
          and(
            eq(sales.id, key),
            eq(sales.companyId, auth.company_id!),
            isNotNull(sales.deletedAt),
          ),
        )
        .returning({ id: sales.id });
      if (!row) throw new HTTPException(404, { message: "Data tidak ditemukan" });
      return c.json({ ok: true, jumlah_baris: 1 });
    }
    const tipe = jenis === "pembelian" ? ("beli" as const) : ("produksi" as const);
    const rows = await db
      .update(productions)
      .set({ deletedAt: null, deletedBy: null })
      .where(
        and(
          eq(productions.companyId, auth.company_id!),
          eq(productions.tipe, tipe),
          isNotNull(productions.deletedAt),
          sql`COALESCE(${productions.fakturId}::text, ${productions.id}::text) = ${key}`,
        ),
      )
      .returning({ id: productions.id });
    if (rows.length === 0) {
      throw new HTTPException(404, { message: "Data tidak ditemukan" });
    }
    return c.json({ ok: true, jumlah_baris: rows.length });
  })
  /**
   * KOSONGKAN Tempat Sampah: hapus PERMANEN semua transaksi yang sudah
   * di-soft-delete (penjualan + faktur produksi/beli). Tidak bisa dipulihkan.
   * Aman terhadap stok/laporan — baris ini memang sudah difilter keluar dari
   * semua agregasi (deleted_at IS NOT NULL). Anak baris ikut terhapus:
   * sale_items/sale_consumptions & production_consumptions lewat FK cascade;
   * faktur_dana & faktur_logs (tanpa FK) dibersihkan manual utk faktur yang
   * SELURUH barisnya ada di sampah.
   */
  .post("/kosongkan", async (c) => {
    const companyId = c.get("auth").company_id!;
    const hasil = await db.transaction(async (tx) => {
      const [hitung] = (
        await tx.execute(sql`
          SELECT
            (SELECT COUNT(*) FROM sales
              WHERE company_id = ${companyId} AND deleted_at IS NOT NULL) AS penjualan,
            (SELECT COUNT(DISTINCT COALESCE(faktur_id::text, id::text)) FROM productions
              WHERE company_id = ${companyId} AND deleted_at IS NOT NULL) AS faktur
        `)
      ).rows as { penjualan: number; faktur: number }[];
      // faktur yang SEMUA barisnya sudah di sampah → dana/log ikut dibersihkan
      const fakturTerhapus = sql`(
        SELECT faktur_id FROM productions
        WHERE company_id = ${companyId} AND faktur_id IS NOT NULL
        GROUP BY faktur_id
        HAVING COUNT(*) FILTER (WHERE deleted_at IS NULL) = 0
           AND COUNT(*) FILTER (WHERE deleted_at IS NOT NULL) > 0
      )`;
      await tx.execute(
        sql`DELETE FROM faktur_logs WHERE company_id = ${companyId} AND faktur_id IN ${fakturTerhapus}`,
      );
      await tx.execute(
        sql`DELETE FROM faktur_dana WHERE company_id = ${companyId} AND faktur_id IN ${fakturTerhapus}`,
      );
      await tx.execute(
        sql`DELETE FROM productions WHERE company_id = ${companyId} AND deleted_at IS NOT NULL`,
      );
      await tx.execute(
        sql`DELETE FROM sales WHERE company_id = ${companyId} AND deleted_at IS NOT NULL`,
      );
      return {
        penjualan: Number(hitung?.penjualan ?? 0),
        faktur: Number(hitung?.faktur ?? 0),
      };
    });
    return c.json({ ok: true, ...hasil });
  });

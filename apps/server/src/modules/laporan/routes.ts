import { and, desc, eq, gte, lte, sql, sum } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { LaporanHarian } from "@kakarut/shared";
import { db } from "../../db/client";
import { companies, ingredients, saleConsumptions, saleItems, sales } from "../../db/schema";
import { resolveBranchId, type AppEnv } from "../../middleware/auth";
import { tanggalDi } from "../../lib/time";
import { loadKatalog, toMenuDto } from "../menu/service";

export const laporanRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const auth = c.get("auth");
    const branchId = await resolveBranchId(c);
    const [company] = await db
      .select({ timezone: companies.timezone })
      .from(companies)
      .where(eq(companies.id, auth.company_id!));
    const tanggal = c.req.query("tanggal") ?? tanggalDi(company?.timezone ?? "Asia/Jakarta");

    const saleFilter = and(
      eq(sales.companyId, auth.company_id!),
      eq(sales.branchId, branchId),
      eq(sales.saleDate, tanggal),
    );

    const [agg] = await db
      .select({
        omzet: sum(sales.subtotal),
        pb1: sum(sales.pb1Amount),
        totalHpp: sum(sales.totalHpp),
        jumlah: sql<number>`count(*)::int`,
      })
      .from(sales)
      .where(saleFilter);

    const itemTerjual = await db
      .select({
        menu_nama: saleItems.menuNama,
        qty: sum(saleItems.qty),
        omzet: sum(saleItems.lineTotal),
      })
      .from(saleItems)
      .innerJoin(sales, eq(saleItems.saleId, sales.id))
      .where(saleFilter)
      .groupBy(saleItems.menuNama)
      .orderBy(desc(sum(saleItems.lineTotal)));

    const konsumsi = await db
      .select({
        nama: ingredients.nama,
        slug: ingredients.slug,
        qty: sum(saleConsumptions.qty),
      })
      .from(saleConsumptions)
      .innerJoin(sales, eq(saleConsumptions.saleId, sales.id))
      .innerJoin(ingredients, eq(saleConsumptions.ingredientId, ingredients.id))
      .where(saleFilter)
      .groupBy(ingredients.nama, ingredients.slug)
      .orderBy(desc(sum(saleConsumptions.qty)));

    const omzet = Number(agg?.omzet ?? 0);
    const totalHpp = Number(agg?.totalHpp ?? 0);
    const laporan: LaporanHarian = {
      tanggal,
      omzet,
      jumlah_transaksi: agg?.jumlah ?? 0,
      pb1_terkumpul: Number(agg?.pb1 ?? 0),
      total_hpp: totalHpp,
      estimasi_profit: omzet - totalHpp,
      item_terjual: itemTerjual.map((r) => ({
        menu_nama: r.menu_nama,
        qty: Number(r.qty ?? 0),
        omzet: Number(r.omzet ?? 0),
      })),
      konsumsi_bahan: konsumsi.map((r) => ({
        nama: r.nama,
        slug: r.slug,
        qty: Number(r.qty ?? 0),
      })),
    };
    return c.json(laporan);
  })
  /**
   * Kalkulator BEP: biaya tetap ÷ margin kontribusi rata-rata.
   * Margin diambil dari snapshot penjualan pada rentang tanggal; bila belum
   * ada penjualan, memakai rata-rata katalog (harga jual − HPP live).
   */
  .get("/bep", async (c) => {
    const auth = c.get("auth");
    const biayaTetap = Number(c.req.query("biaya_tetap"));
    if (!Number.isFinite(biayaTetap) || biayaTetap <= 0) {
      throw new HTTPException(400, { message: "Parameter biaya_tetap wajib berupa angka > 0" });
    }
    const branchId = await resolveBranchId(c);
    const sampai = c.req.query("sampai") ?? tanggalDi("Asia/Jakarta");
    const dari =
      c.req.query("dari") ??
      tanggalDi("Asia/Jakarta", new Date(Date.now() - 30 * 24 * 3600 * 1000));

    const [agg] = await db
      .select({
        qty: sum(saleItems.qty),
        omzet: sum(saleItems.lineTotal),
        hpp: sql<number>`COALESCE(SUM(${saleItems.hppSatuan} * ${saleItems.qty}), 0)`,
      })
      .from(saleItems)
      .innerJoin(sales, eq(saleItems.saleId, sales.id))
      .where(
        and(
          eq(sales.companyId, auth.company_id!),
          eq(sales.branchId, branchId),
          gte(sales.saleDate, dari),
          lte(sales.saleDate, sampai),
        ),
      );

    let totalQty = Number(agg?.qty ?? 0);
    let avgHarga: number;
    let avgMargin: number;
    let basis: "penjualan" | "katalog";

    if (totalQty > 0) {
      const omzet = Number(agg!.omzet ?? 0);
      const hpp = Number(agg!.hpp ?? 0);
      avgHarga = omzet / totalQty;
      avgMargin = (omzet - hpp) / totalQty;
      basis = "penjualan";
    } else {
      const katalog = await loadKatalog(db, auth.company_id!);
      const dtos = katalog.rows.filter((r) => r.isActive).map((r) => toMenuDto(r, katalog));
      if (dtos.length === 0) {
        throw new HTTPException(400, { message: "Belum ada menu untuk dihitung" });
      }
      avgHarga = dtos.reduce((a, d) => a + d.harga_jual, 0) / dtos.length;
      avgMargin = dtos.reduce((a, d) => a + (d.harga_jual - d.hpp), 0) / dtos.length;
      basis = "katalog";
      totalQty = 0;
    }

    if (avgMargin <= 0) {
      throw new HTTPException(400, { message: "Margin kontribusi ≤ 0 — BEP tidak tercapai" });
    }

    const porsiBep = Math.ceil(biayaTetap / avgMargin);
    return c.json({
      biaya_tetap: biayaTetap,
      basis,
      periode: { dari, sampai },
      rata_harga_jual: avgHarga,
      rata_margin_kontribusi: avgMargin,
      porsi_untuk_bep: porsiBep,
      omzet_untuk_bep: porsiBep * avgHarga,
      porsi_per_hari_30: Math.ceil(porsiBep / 30),
    });
  });

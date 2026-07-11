import { and, desc, eq, gte, isNull, lte, sql, sum } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { LaporanHarian, LaporanPembelian, MenuLaris } from "@kakarut/shared";
import { db } from "../../db/client";
import {
  companies,
  ingredients,
  menuCategories,
  menus,
  productions,
  saleConsumptions,
  saleItems,
  sales,
  suppliers,
} from "../../db/schema";
import type { Context } from "hono";
import { resolveBranchId, type AppEnv } from "../../middleware/auth";
import { tanggalDi } from "../../lib/time";
import { loadKatalog, toMenuDto } from "../menu/service";

/** Terima hanya tanggal format YYYY-MM-DD; selain itu undefined. */
const tglValid = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);

/**
 * Kondisi cabang untuk laporan: kasir selalu terkunci ke cabangnya; owner/admin
 * boleh memilih satu cabang via ?branch_id=<id>, atau "Semua cabang" via
 * ?branch_id=all (tanpa filter cabang → gabungan seluruh cabang perusahaan).
 */
async function branchCondLaporan(c: Context<AppEnv>) {
  const auth = c.get("auth");
  if (auth.role !== "cashier" && c.req.query("branch_id") === "all") return undefined;
  const branchId = await resolveBranchId(c);
  return eq(sales.branchId, branchId);
}

/** Sama seperti branchCondLaporan tetapi untuk tabel productions (jalur pembelian). */
async function branchCondPembelian(c: Context<AppEnv>) {
  const auth = c.get("auth");
  if (auth.role !== "cashier" && c.req.query("branch_id") === "all") return undefined;
  const branchId = await resolveBranchId(c);
  return eq(productions.branchId, branchId);
}

export const laporanRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const auth = c.get("auth");
    const branchCond = await branchCondLaporan(c);
    const [company] = await db
      .select({ timezone: companies.timezone })
      .from(companies)
      .where(eq(companies.id, auth.company_id!));
    const today = tanggalDi(company?.timezone ?? "Asia/Jakarta");
    const satuHari = tglValid(c.req.query("tanggal")); // kompatibilitas ?tanggal=
    const sampai = tglValid(c.req.query("sampai")) ?? satuHari ?? today;
    const dari = tglValid(c.req.query("dari")) ?? satuHari ?? sampai;

    const saleFilter = and(
      eq(sales.companyId, auth.company_id!),
      branchCond,
      gte(sales.saleDate, dari),
      lte(sales.saleDate, sampai),
      isNull(sales.deletedAt),
    );

    const [agg] = await db
      .select({
        omzet: sum(sales.subtotal),
        diskon: sum(sales.diskon),
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

    // rekap uang masuk per metode bayar (total = nilai yang benar-benar dibayar)
    const perMetode = await db
      .select({
        metode: sales.metodeBayar,
        jumlah: sql<number>`count(*)::int`,
        total: sum(sales.total),
      })
      .from(sales)
      .where(saleFilter)
      .groupBy(sales.metodeBayar)
      .orderBy(desc(sum(sales.total)));

    const omzet = Number(agg?.omzet ?? 0);
    const totalDiskon = Number(agg?.diskon ?? 0);
    const totalHpp = Number(agg?.totalHpp ?? 0);
    const laporan: LaporanHarian = {
      dari,
      sampai,
      omzet,
      jumlah_transaksi: agg?.jumlah ?? 0,
      per_metode: perMetode.map((r) => ({
        metode: r.metode,
        jumlah: r.jumlah,
        total: Number(r.total ?? 0),
      })),
      total_diskon: totalDiskon,
      pb1_terkumpul: Number(agg?.pb1 ?? 0),
      total_hpp: totalHpp,
      // laba mundur oleh diskon yang diberikan: omzet(kotor) − diskon − HPP
      estimasi_profit: omzet - totalDiskon - totalHpp,
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
   * Laporan pembelian bahan baku: pengeluaran dari faktur beli TERKONFIRMASI
   * (barang benar-benar diterima) pada rentang tanggal, dipecah per supplier
   * dan per bahan. Difilter tanggal via prod_date (konsisten dgn buku besar
   * pembelian). Owner/admin bisa pilih cabang (?branch_id=<id>|all).
   */
  .get("/pembelian", async (c) => {
    const auth = c.get("auth");
    const branchCond = await branchCondPembelian(c);
    const [company] = await db
      .select({ timezone: companies.timezone })
      .from(companies)
      .where(eq(companies.id, auth.company_id!));
    const today = tanggalDi(company?.timezone ?? "Asia/Jakarta");
    const sampai = tglValid(c.req.query("sampai")) ?? today;
    const dari = tglValid(c.req.query("dari")) ?? sampai;

    const filter = and(
      eq(productions.companyId, auth.company_id!),
      eq(productions.tipe, "beli"),
      eq(productions.status, "dikonfirmasi"),
      isNull(productions.deletedAt),
      branchCond,
      gte(productions.prodDate, dari),
      lte(productions.prodDate, sampai),
    );
    // 1 faktur = beberapa baris ber-faktur_id sama (baris lama tanpa faktur = id-nya sendiri)
    const keyFaktur = sql<string>`COALESCE(${productions.fakturId}::text, ${productions.id}::text)`;
    const totalExpr = sql<number>`COALESCE(SUM(${productions.totalHarga}), 0)`;

    const [agg] = await db
      .select({
        total: totalExpr,
        jumlah_faktur: sql<number>`COUNT(DISTINCT ${keyFaktur})::int`,
        jumlah_item: sql<number>`count(*)::int`,
      })
      .from(productions)
      .where(filter);

    const perSupplier = await db
      .select({
        supplier: suppliers.nama,
        jumlah_faktur: sql<number>`COUNT(DISTINCT ${keyFaktur})::int`,
        total: totalExpr,
      })
      .from(productions)
      .leftJoin(suppliers, eq(productions.supplierId, suppliers.id))
      .where(filter)
      .groupBy(suppliers.nama)
      .orderBy(desc(totalExpr));

    const perBahan = await db
      .select({
        nama: ingredients.nama,
        slug: ingredients.slug,
        satuan: ingredients.satuan,
        qty: sql<number>`COALESCE(SUM(${productions.qty}), 0)`,
        total: totalExpr,
      })
      .from(productions)
      .innerJoin(ingredients, eq(productions.ingredientId, ingredients.id))
      .where(filter)
      .groupBy(ingredients.nama, ingredients.slug, ingredients.satuan)
      .orderBy(desc(totalExpr));

    const laporan: LaporanPembelian = {
      dari,
      sampai,
      total_pengeluaran: Number(agg?.total ?? 0),
      jumlah_faktur: agg?.jumlah_faktur ?? 0,
      jumlah_item: agg?.jumlah_item ?? 0,
      per_supplier: perSupplier.map((r) => ({
        supplier: r.supplier,
        jumlah_faktur: r.jumlah_faktur,
        total: Number(r.total ?? 0),
      })),
      per_bahan: perBahan.map((r) => ({
        nama: r.nama,
        slug: r.slug,
        qty: Number(r.qty ?? 0),
        satuan: r.satuan,
        total: Number(r.total ?? 0),
      })),
    };
    return c.json(laporan);
  })
  /**
   * Menu terlaris pada rentang tanggal: agregasi porsi terjual (qty) & omzet
   * per menu (dari snapshot sale_items), digabung info kategori/kode menu.
   * Diurut porsi terbanyak. Owner/admin bisa pilih cabang (?branch_id=<id>|all).
   */
  .get("/menu-laris", async (c) => {
    const auth = c.get("auth");
    const branchCond = await branchCondLaporan(c);
    const [company] = await db
      .select({ timezone: companies.timezone })
      .from(companies)
      .where(eq(companies.id, auth.company_id!));
    const today = tanggalDi(company?.timezone ?? "Asia/Jakarta");
    const sampai = tglValid(c.req.query("sampai")) ?? today;
    const dari = tglValid(c.req.query("dari")) ?? sampai;

    const saleFilter = and(
      eq(sales.companyId, auth.company_id!),
      branchCond,
      gte(sales.saleDate, dari),
      lte(sales.saleDate, sampai),
      isNull(sales.deletedAt),
    );

    const rows = await db
      .select({
        menu_id: saleItems.menuId,
        nama: menus.nama,
        kode: menus.kode,
        kategori: sql<string>`COALESCE(${menuCategories.nama}, '')`,
        qty: sum(saleItems.qty),
        omzet: sum(saleItems.lineTotal),
      })
      .from(saleItems)
      .innerJoin(sales, eq(saleItems.saleId, sales.id))
      .innerJoin(menus, eq(saleItems.menuId, menus.id))
      .leftJoin(menuCategories, eq(menus.categoryId, menuCategories.id))
      .where(saleFilter)
      .groupBy(saleItems.menuId, menus.nama, menus.kode, menuCategories.nama)
      .orderBy(desc(sum(saleItems.qty)), desc(sum(saleItems.lineTotal)));

    const items = rows.map((r) => ({
      menu_id: r.menu_id,
      nama: r.nama,
      kode: r.kode,
      kategori: r.kategori,
      qty: Number(r.qty ?? 0),
      omzet: Number(r.omzet ?? 0),
    }));
    const laporan: MenuLaris = {
      dari,
      sampai,
      total_qty: items.reduce((a, r) => a + r.qty, 0),
      total_omzet: items.reduce((a, r) => a + r.omzet, 0),
      items,
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
    const branchCond = await branchCondLaporan(c);
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
          branchCond,
          gte(sales.saleDate, dari),
          lte(sales.saleDate, sampai),
          isNull(sales.deletedAt),
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

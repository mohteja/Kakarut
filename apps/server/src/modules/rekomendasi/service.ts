import { and, desc, eq, gte, lte, sum } from "drizzle-orm";
import type {
  AcuanJenis,
  AcuanPeriode,
  MenuTerlaris,
  RekomendasiBahanRow,
  RekomendasiBeli,
} from "@kakarut/shared";
import { db } from "../../db/client";
import { ingredients, saleConsumptions, saleItems, sales } from "../../db/schema";
import { tanggalDi } from "../../lib/time";
import { hitungSaldoCabang } from "../stok/service";

/** tanggal N hari lalu (tz perusahaan). Jakarta tanpa DST → geser ms tepat. */
function hariGeser(tz: string, hari: number): string {
  return tanggalDi(tz, new Date(Date.now() - hari * 24 * 3600 * 1000));
}

async function omzetPeriode(
  companyId: string,
  branchId: string,
  dari: string,
  sampai: string,
): Promise<number> {
  const [row] = await db
    .select({ omzet: sum(sales.subtotal) })
    .from(sales)
    .where(
      and(
        eq(sales.companyId, companyId),
        eq(sales.branchId, branchId),
        gte(sales.saleDate, dari),
        lte(sales.saleDate, sampai),
      ),
    );
  return Number(row?.omzet ?? 0);
}

async function konsumsiPeriode(
  companyId: string,
  branchId: string,
  dari: string,
  sampai: string,
): Promise<Map<string, number>> {
  const rows = await db
    .select({ ingredientId: saleConsumptions.ingredientId, qty: sum(saleConsumptions.qty) })
    .from(saleConsumptions)
    .innerJoin(sales, eq(saleConsumptions.saleId, sales.id))
    .where(
      and(
        eq(sales.companyId, companyId),
        eq(sales.branchId, branchId),
        gte(sales.saleDate, dari),
        lte(sales.saleDate, sampai),
      ),
    )
    .groupBy(saleConsumptions.ingredientId);
  return new Map(rows.map((r) => [r.ingredientId, Number(r.qty ?? 0)]));
}

async function menuTerlarisPeriode(
  companyId: string,
  branchId: string,
  dari: string,
  sampai: string,
): Promise<MenuTerlaris[]> {
  const rows = await db
    .select({
      menu_nama: saleItems.menuNama,
      qty: sum(saleItems.qty),
      omzet: sum(saleItems.lineTotal),
    })
    .from(saleItems)
    .innerJoin(sales, eq(saleItems.saleId, sales.id))
    .where(
      and(
        eq(sales.companyId, companyId),
        eq(sales.branchId, branchId),
        gte(sales.saleDate, dari),
        lte(sales.saleDate, sampai),
      ),
    )
    .groupBy(saleItems.menuNama)
    .orderBy(desc(sum(saleItems.lineTotal)))
    .limit(8);
  return rows.map((r) => ({
    menu_nama: r.menu_nama,
    qty: Number(r.qty ?? 0),
    omzet: Number(r.omzet ?? 0),
  }));
}

export interface OpsiRekomendasi {
  target: number;
  acuan: AcuanJenis;
  dari?: string;
  sampai?: string;
}

/**
 * Rekomendasi pembelian dari target penjualan. Proyeksi kebutuhan bahan =
 * pemakaian nyata periode acuan × (target / omzet acuan). Mengikuti menu
 * terlaris + resep + dine-in karena memakai sale_consumptions sungguhan.
 */
export async function rekomendasiBeli(
  companyId: string,
  branchId: string,
  tz: string,
  opsi: OpsiRekomendasi,
): Promise<RekomendasiBeli> {
  const hariIni = tanggalDi(tz);

  // tentukan periode acuan
  let dari: string;
  let sampai: string;
  let jenis: AcuanJenis = opsi.acuan;
  let fallback = false;
  if (opsi.acuan === "rentang" && opsi.dari && opsi.sampai) {
    dari = opsi.dari;
    sampai = opsi.sampai;
  } else if (opsi.acuan === "7hari") {
    jenis = "7hari";
    dari = hariGeser(tz, 7);
    sampai = hariGeser(tz, 1);
  } else {
    // hari-sama minggu lalu (default)
    jenis = "minggu_lalu";
    dari = hariGeser(tz, 7);
    sampai = dari;
  }

  let omzet = await omzetPeriode(companyId, branchId, dari, sampai);
  // fallback: hari-sama-minggu-lalu kosong → rata-rata 7 hari terakhir
  if (jenis === "minggu_lalu" && omzet <= 0) {
    dari = hariGeser(tz, 7);
    sampai = hariGeser(tz, 1);
    omzet = await omzetPeriode(companyId, branchId, dari, sampai);
    fallback = true;
  }

  const [refCons, todayCons, saldoRows, extraRows, menuTerlaris] = await Promise.all([
    konsumsiPeriode(companyId, branchId, dari, sampai),
    konsumsiPeriode(companyId, branchId, hariIni, hariIni),
    hitungSaldoCabang(companyId, branchId),
    db
      .select({
        id: ingredients.id,
        pengadaan: ingredients.pengadaan,
        hargaBeli: ingredients.hargaBeli,
        isi: ingredients.isi,
      })
      .from(ingredients)
      .where(eq(ingredients.companyId, companyId)),
    menuTerlarisPeriode(companyId, branchId, dari, sampai),
  ]);

  const extra = new Map(extraRows.map((r) => [r.id, r]));
  const target = opsi.target;

  const bahan: RekomendasiBahanRow[] = saldoRows.map((s) => {
    const e = extra.get(s.ingredient_id);
    const harga_per_unit = e && e.isi > 0 ? e.hargaBeli / e.isi : 0;
    const acuan_qty = refCons.get(s.ingredient_id) ?? 0;
    const kebutuhan = omzet > 0 ? acuan_qty * (target / omzet) : null;
    const saran_beli = kebutuhan != null ? Math.max(0, kebutuhan - s.saldo) : null;
    return {
      ingredient_id: s.ingredient_id,
      nama: s.nama,
      satuan: s.satuan,
      kategori: s.kategori,
      pengadaan: e?.pengadaan ?? "beli",
      terpakai_hari_ini: todayCons.get(s.ingredient_id) ?? 0,
      sisa: s.saldo,
      acuan_qty,
      kebutuhan,
      saran_beli,
      harga_per_unit,
      estimasi_biaya: saran_beli != null ? saran_beli * harga_per_unit : null,
    };
  });

  // urut: perlu beli paling banyak dulu, lalu pemakaian acuan terbesar
  bahan.sort(
    (a, b) => (b.saran_beli ?? -1) - (a.saran_beli ?? -1) || b.acuan_qty - a.acuan_qty,
  );

  const acuan: AcuanPeriode = { jenis, dari, sampai, omzet, fallback };
  return { target, hari_ini: hariIni, acuan, menu_terlaris: menuTerlaris, bahan };
}

import { and, desc, eq, gte, isNull, lte, sum } from "drizzle-orm";
import {
  jumlahFaktur,
  kekuranganBahan,
  type AcuanJenis,
  type AcuanPeriode,
  type MenuTerlaris,
  type RekomendasiBahanRow,
  type RekomendasiBeli,
} from "@kakarut/shared";
import { db } from "../../db/client";
import { ingredients, saleConsumptions, saleItems, sales } from "../../db/schema";
import { tanggalDi } from "../../lib/time";
import { omzetDitagihSql, sumQtyDitagihSql } from "../../lib/porsi-ditagih";
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
        isNull(sales.deletedAt),
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
        isNull(sales.deletedAt),
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
      // Porsi yang direfund justru lahir dari bahan yang habis. Menghitungnya
      // sebagai terjual membuat rekomendasi belanja memakai permintaan yang
      // tak pernah terlayani sebagai bukti laku — dan angkanya juga tak lagi
      // sama dengan omzet di Laporan.
      qty: sumQtyDitagihSql,
      omzet: omzetDitagihSql,
    })
    .from(saleItems)
    .innerJoin(sales, eq(saleItems.saleId, sales.id))
    .where(
      and(
        eq(sales.companyId, companyId),
        eq(sales.branchId, branchId),
        gte(sales.saleDate, dari),
        lte(sales.saleDate, sampai),
        isNull(sales.deletedAt),
      ),
    )
    .groupBy(saleItems.menuNama)
    .orderBy(desc(omzetDitagihSql), saleItems.menuNama)
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
  /** periode kolom "terpakai" (default hari ini) */
  pakaiDari?: string;
  pakaiSampai?: string;
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
  // periode kolom "terpakai": default hari ini; bisa satu tanggal atau rentang
  const pakaiDari = opsi.pakaiDari || hariIni;
  const pakaiSampai = opsi.pakaiSampai || pakaiDari;

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

  const [refCons, pakaiCons, saldoRows, extraRows, menuTerlaris] = await Promise.all([
    konsumsiPeriode(companyId, branchId, dari, sampai),
    konsumsiPeriode(companyId, branchId, pakaiDari, pakaiSampai),
    hitungSaldoCabang(companyId, branchId),
    db
      .select({
        id: ingredients.id,
        pengadaan: ingredients.pengadaan,
        hargaBeli: ingredients.hargaBeli,
        isi: ingredients.isi,
        bolehEceran: ingredients.bolehEceran,
        leadTimeHari: ingredients.leadTimeHari,
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
    // `kekuranganBahan`, BUKAN `Math.max(0, kebutuhan - saldo)`: keduanya beda
    // tepat di ekor float. `kebutuhan` dan `saldo` sama-sama jumlahan desimal
    // (0,1 kg tiga kali = 0,30000000000000004), jadi selisih sisa ~5e-17 lumrah
    // muncul untuk bahan yang stoknya sebenarnya PAS. `Math.max` memulangkan
    // angka mungil itu apa adanya — dan di layar Rekomendasi Beli barisnya
    // disorot oranye "perlu dibeli" hanya karena nilainya truthy, sementara
    // kolom sarannya tetap tertulis 0 dan estimasi biayanya Rp 0. Peringatan
    // tanpa isi: owner mencari apa yang harus dibeli dan tak menemukan apa pun.
    //
    // Satu nilai dipakai berdua supaya keduanya tak bisa berselisih lagi.
    const saran_beli = kebutuhan != null ? kekuranganBahan(kebutuhan, s.saldo) : null;
    // Saran TERBULATKAN mengikuti kemasan/batch — aturan yang sama dengan
    // faktur otomatis rencana-dari-menu: toko menjual per kemasan `isi`;
    // bahan boleh_eceran tetap per pcs.
    const kurang = saran_beli ?? 0;
    const faktur =
      kurang > 0
        ? jumlahFaktur(kurang, e?.pengadaan ?? "beli", s.isi, e?.bolehEceran ?? false)
        : null;
    return {
      ingredient_id: s.ingredient_id,
      nama: s.nama,
      satuan: s.satuan,
      kategori: s.kategori,
      pengadaan: e?.pengadaan ?? "beli",
      terpakai: pakaiCons.get(s.ingredient_id) ?? 0,
      sisa: s.saldo,
      acuan_qty,
      kebutuhan,
      saran_beli,
      isi: s.isi,
      mode_faktur: faktur?.mode ?? null,
      jumlah_faktur: faktur?.jumlah ?? null,
      qty_faktur: faktur?.qty ?? null,
      harga_per_unit,
      estimasi_biaya: faktur
        ? Math.round(faktur.qty * harga_per_unit)
        : saran_beli != null
          ? 0
          : null,
      lead_time_hari: e?.leadTimeHari ?? 0,
    };
  });

  // urut: perlu beli paling banyak dulu, lalu pemakaian acuan terbesar
  bahan.sort(
    (a, b) => (b.saran_beli ?? -1) - (a.saran_beli ?? -1) || b.acuan_qty - a.acuan_qty,
  );

  const acuan: AcuanPeriode = { jenis, dari, sampai, omzet, fallback };
  return {
    target,
    hari_ini: hariIni,
    acuan,
    pakai: { dari: pakaiDari, sampai: pakaiSampai },
    menu_terlaris: menuTerlaris,
    bahan,
  };
}

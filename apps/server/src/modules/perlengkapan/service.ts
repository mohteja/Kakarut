/**
 * Perlengkapan (non bahan baku): saldo per cabang dari ledger mutasi bertanda,
 * plus KONSUMSI OTOMATIS harian berdasarkan aturan per (cabang, item) —
 * dimaterialisasi malas (tanpa cron): dipanggil saat daftar/kartu dibuka,
 * sebelum pakai/koreksi, dan sekali saat boot.
 */
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type {
  BeliPerlengkapanRow,
  KartuPerlengkapanDto,
  PerlengkapanMasterRow,
  PerlengkapanRowDto,
  PermintaanPerlengkapanOtomatisHasil,
  StokStatus,
} from "@kakarut/shared";
import { db } from "../../db/client";
import {
  branches,
  companies,
  dokumenNomor,
  storageLocations,
  suppliers,
  supplies,
  supplyMutations,
  supplyPurchases,
  supplyRules,
  supplySuppliers,
  supplyTransfers,
  users,
} from "../../db/schema";
import { tanggalDi } from "../../lib/time";
import { nomorUntukRefs, terbitkanNomor } from "../dokumen/nomor";

/** Tanggal lokal hari ini pada zona waktu perusahaan. */
export async function tanggalPerusahaan(companyId: string): Promise<string> {
  const [comp] = await db
    .select({ timezone: companies.timezone })
    .from(companies)
    .where(eq(companies.id, companyId));
  return tanggalDi(comp?.timezone ?? "Asia/Jakarta");
}

/** Status stok perlengkapan: habis (≤0) / menipis (≤ minimum) / aman. */
export function statusPerlengkapan(saldo: number, minimum: number): StokStatus {
  if (saldo <= 0) return "habis";
  if (minimum > 0 && saldo <= minimum) return "menipis";
  return "aman";
}

const HARI_MS = 86_400_000;
/** batas mundur perhitungan auto — aturan yang lama terbengkalai tak meledak */
const MAKS_LOOKBACK_HARI = 366;

function keUtc(tanggal: string): number {
  const [y, m, d] = tanggal.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function keTanggal(utc: number): string {
  return new Date(utc).toISOString().slice(0, 10);
}

/**
 * Hari-hari terjadwal aturan konsumsi: kandidat `mulai + k×perHari` dengan
 * `dariEksklusif < hari <= sampai` (dariEksklusif null = dari `mulai`).
 * Murni kalender (aritmetika UTC pada string YYYY-MM-DD — bebas drift zona).
 */
export function hariTerjadwal(
  mulai: string,
  perHari: number,
  dariEksklusif: string | null,
  sampai: string,
): string[] {
  if (perHari < 1) return [];
  const mulaiUtc = keUtc(mulai);
  const sampaiUtc = keUtc(sampai);
  if (mulaiUtc > sampaiUtc) return [];
  // batas bawah efektif: kursor (eksklusif) & cap lookback
  const capUtc = sampaiUtc - MAKS_LOOKBACK_HARI * HARI_MS;
  const bawahEksklusif = Math.max(
    dariEksklusif ? keUtc(dariEksklusif) : mulaiUtc - HARI_MS,
    capUtc - HARI_MS,
  );
  const langkah = perHari * HARI_MS;
  const hasil: string[] = [];
  // lompat langsung ke kandidat pertama > bawahEksklusif (hindari loop panjang)
  let k = bawahEksklusif >= mulaiUtc ? Math.floor((bawahEksklusif - mulaiUtc) / langkah) + 1 : 0;
  for (let t = mulaiUtc + k * langkah; t <= sampaiUtc; t += langkah) {
    if (t > bawahEksklusif) hasil.push(keTanggal(t));
  }
  return hasil;
}

/**
 * Materialisasi pemakaian otomatis semua aturan aktif satu perusahaan sampai
 * HARI INI (zona waktu perusahaan). Idempoten: kursor `terakhir_diterapkan`
 * + unique index parsial (supply, branch, tanggal) khusus tipe 'auto' —
 * request bersamaan aman (insert kedua konflik & dilewati).
 * Konsumsi per hari = min(qty aturan, saldo); saldo habis → sisa hari
 * DILEWATI (tidak diulang setelah restock — itulah guna kursor).
 */
export async function terapkanKonsumsiOtomatis(
  companyId: string,
  branchId?: string,
): Promise<number> {
  const [comp] = await db
    .select({ timezone: companies.timezone })
    .from(companies)
    .where(eq(companies.id, companyId));
  if (!comp) return 0;
  const hariIni = tanggalDi(comp.timezone ?? "Asia/Jakarta");

  const rules = await db
    .select({
      id: supplyRules.id,
      branchId: supplyRules.branchId,
      supplyId: supplyRules.supplyId,
      qty: supplyRules.qty,
      perHari: supplyRules.perHari,
      mulai: supplyRules.mulai,
      terakhirDiterapkan: supplyRules.terakhirDiterapkan,
    })
    .from(supplyRules)
    .innerJoin(supplies, eq(supplyRules.supplyId, supplies.id))
    .innerJoin(branches, eq(supplyRules.branchId, branches.id))
    .where(
      and(
        eq(supplyRules.companyId, companyId),
        eq(supplyRules.aktif, true),
        // metode "manual" = pemakaian via stock opname — tanpa potongan jadwal
        eq(supplyRules.metode, "otomatis"),
        eq(supplies.isActive, true),
        eq(branches.isActive, true),
        ...(branchId ? [eq(supplyRules.branchId, branchId)] : []),
      ),
    );

  let total = 0;
  for (const r of rules) {
    if (r.terakhirDiterapkan === hariIni) continue; // sudah dihitung hari ini
    const hari = hariTerjadwal(r.mulai, r.perHari, r.terakhirDiterapkan, hariIni);
    await db.transaction(async (tx) => {
      if (hari.length > 0) {
        const [{ saldo }] = await tx
          .select({
            saldo: sql<number>`COALESCE(SUM(${supplyMutations.qty}), 0)::float8`,
          })
          .from(supplyMutations)
          .where(
            and(
              eq(supplyMutations.supplyId, r.supplyId),
              eq(supplyMutations.branchId, r.branchId),
              eq(supplyMutations.status, "disetujui"),
            ),
          );
        let sisa = saldo;
        for (const tanggal of hari) {
          if (sisa <= 0) break; // habis — sisa hari dilewati (tidak diulang)
          const q = Math.min(r.qty, sisa);
          const dipakai = await tx
            .insert(supplyMutations)
            .values({
              companyId,
              branchId: r.branchId,
              supplyId: r.supplyId,
              tipe: "auto",
              qty: -q,
              tanggal,
              catatan: "Pemakaian otomatis (aturan)",
              userId: null,
            })
            .onConflictDoNothing()
            .returning({ id: supplyMutations.id });
          if (dipakai.length > 0) {
            sisa -= q;
            total += 1;
          }
        }
      }
      // kursor SELALU maju ke hari ini — termasuk saat semua hari dilewati
      await tx
        .update(supplyRules)
        .set({ terakhirDiterapkan: hariIni, updatedAt: new Date() })
        .where(eq(supplyRules.id, r.id));
    });
  }
  return total;
}

/** Boot backfill: terapkan aturan aktif semua perusahaan (idempoten). */
export async function terapkanSemuaKonsumsiOtomatis(): Promise<number> {
  const comps = await db
    .selectDistinct({ companyId: supplyRules.companyId })
    .from(supplyRules)
    .where(eq(supplyRules.aktif, true));
  let total = 0;
  for (const { companyId } of comps) total += await terapkanKonsumsiOtomatis(companyId);
  return total;
}

/**
 * Daftar item aktif + saldo cabang + aturan cabang (untuk halaman utama).
 * Bila cabang terhubung Central Kitchen, sertakan `saldo_ck` — dasar tombol
 * "Minta ke CK" saat stok ≤ minimum.
 */
export async function saldoPerlengkapan(
  companyId: string,
  branchId: string,
): Promise<PerlengkapanRowDto[]> {
  const [cab] = await db
    .select({ ckId: branches.centralKitchenId, tipe: branches.tipe })
    .from(branches)
    .where(and(eq(branches.id, branchId), eq(branches.companyId, companyId)));
  const ckId = cab && cab.tipe !== "central_kitchen" ? (cab.ckId ?? null) : null;
  // rak simpan default (nama tempat penyimpanan) per item — utk memilih lokasi opname
  const rakRows = await db
    .select({ id: storageLocations.id, nama: storageLocations.nama })
    .from(storageLocations)
    .where(eq(storageLocations.companyId, companyId));
  const rakById = new Map(rakRows.map((r) => [r.id, r.nama]));
  const rows = await db
    .select({
      id: supplies.id,
      nama: supplies.nama,
      satuan: supplies.satuan,
      hargaBeli: supplies.hargaBeli,
      stokMinimum: supplies.stokMinimum,
      catatan: supplies.catatan,
      storageLocationId: supplies.storageLocationId,
      saldo: sql<number>`COALESCE((SELECT SUM(${supplyMutations.qty}) FROM ${supplyMutations} WHERE ${supplyMutations.supplyId} = ${supplies.id} AND ${supplyMutations.branchId} = ${branchId} AND ${supplyMutations.status} = 'disetujui'), 0)::float8`,
      saldoCk: ckId
        ? sql<number>`COALESCE((SELECT SUM(${supplyMutations.qty}) FROM ${supplyMutations} WHERE ${supplyMutations.supplyId} = ${supplies.id} AND ${supplyMutations.branchId} = ${ckId} AND ${supplyMutations.status} = 'disetujui'), 0)::float8`
        : sql<number | null>`NULL`,
      aturanMetode: supplyRules.metode,
      aturanQty: supplyRules.qty,
      aturanPerHari: supplyRules.perHari,
      aturanAktif: supplyRules.aktif,
      aturanMulai: supplyRules.mulai,
    })
    .from(supplies)
    .leftJoin(
      supplyRules,
      and(eq(supplyRules.supplyId, supplies.id), eq(supplyRules.branchId, branchId)),
    )
    .where(and(eq(supplies.companyId, companyId), eq(supplies.isActive, true)))
    .orderBy(asc(supplies.nama));
  return rows.map((r) => ({
    id: r.id,
    nama: r.nama,
    satuan: r.satuan,
    harga_beli: r.hargaBeli,
    stok_minimum: r.stokMinimum,
    catatan: r.catatan,
    saldo: r.saldo,
    status: statusPerlengkapan(r.saldo, r.stokMinimum),
    rak:
      r.storageLocationId && rakById.has(r.storageLocationId)
        ? { id: r.storageLocationId, nama: rakById.get(r.storageLocationId)! }
        : null,
    aturan:
      r.aturanQty != null
        ? {
            metode: r.aturanMetode!,
            qty: r.aturanQty,
            per_hari: r.aturanPerHari!,
            aktif: r.aturanAktif!,
            mulai: r.aturanMulai!,
          }
        : null,
    saldo_ck: r.saldoCk,
  }));
}

/**
 * MASTER + sebaran: seluruh item aktif se-perusahaan, tiap item membawa
 * daftar cabang tempat ia "ada" (saldo ≠ 0 atau aturan konsumsi terpasang) —
 * untuk halaman master Manajemen yang tanpa pemilih cabang.
 */
export async function sebaranPerlengkapan(companyId: string): Promise<PerlengkapanMasterRow[]> {
  const items = await db
    .select()
    .from(supplies)
    .where(and(eq(supplies.companyId, companyId), eq(supplies.isActive, true)))
    .orderBy(asc(supplies.nama));
  // rak simpan default (nama tempat penyimpanan) per item
  const rakRows = await db
    .select({ id: storageLocations.id, nama: storageLocations.nama })
    .from(storageLocations)
    .where(eq(storageLocations.companyId, companyId));
  const rakById = new Map(rakRows.map((r) => [r.id, r.nama]));
  // ringkasan supplier per item: nama utama + jumlah terdaftar
  const supRows = await db
    .select({
      supplyId: supplySuppliers.supplyId,
      utama: sql<string | null>`MAX(${suppliers.nama}) FILTER (WHERE ${supplySuppliers.isUtama})`,
      jumlah: sql<number>`COUNT(*)::int`,
    })
    .from(supplySuppliers)
    .innerJoin(suppliers, eq(supplySuppliers.supplierId, suppliers.id))
    .where(eq(supplySuppliers.companyId, companyId))
    .groupBy(supplySuppliers.supplyId);
  const supPer = new Map(supRows.map((r) => [r.supplyId, r]));
  const cabang = await db
    .select({ id: branches.id, nama: branches.nama })
    .from(branches)
    .where(and(eq(branches.companyId, companyId), eq(branches.isActive, true)))
    .orderBy(asc(branches.createdAt));
  const namaCabang = new Map(cabang.map((b) => [b.id, b.nama]));
  const urutan = new Map(cabang.map((b, i) => [b.id, i]));
  const saldoRows = await db
    .select({
      supplyId: supplyMutations.supplyId,
      branchId: supplyMutations.branchId,
      saldo: sql<number>`COALESCE(SUM(${supplyMutations.qty}), 0)::float8`,
    })
    .from(supplyMutations)
    .where(
      and(eq(supplyMutations.companyId, companyId), eq(supplyMutations.status, "disetujui")),
    )
    .groupBy(supplyMutations.supplyId, supplyMutations.branchId);
  const ruleRows = await db
    .select({
      supplyId: supplyRules.supplyId,
      branchId: supplyRules.branchId,
      metode: supplyRules.metode,
      qty: supplyRules.qty,
      perHari: supplyRules.perHari,
      aktif: supplyRules.aktif,
      mulai: supplyRules.mulai,
    })
    .from(supplyRules)
    .where(eq(supplyRules.companyId, companyId));

  const saldoPer = new Map<string, number>(); // `${supplyId}|${branchId}` → saldo
  for (const r of saldoRows) saldoPer.set(`${r.supplyId}|${r.branchId}`, r.saldo);
  const rulePer = new Map<string, (typeof ruleRows)[number]>();
  for (const r of ruleRows) rulePer.set(`${r.supplyId}|${r.branchId}`, r);

  return items.map((it) => {
    const branchIds = new Set<string>();
    for (const r of saldoRows) {
      if (r.supplyId === it.id && Math.abs(r.saldo) > 1e-9) branchIds.add(r.branchId);
    }
    for (const r of ruleRows) if (r.supplyId === it.id) branchIds.add(r.branchId);
    const lokasi = [...branchIds]
      .filter((bid) => namaCabang.has(bid)) // cabang nonaktif tak ditampilkan
      .sort((a, b) => (urutan.get(a) ?? 0) - (urutan.get(b) ?? 0))
      .map((bid) => {
        const saldo = saldoPer.get(`${it.id}|${bid}`) ?? 0;
        const rule = rulePer.get(`${it.id}|${bid}`);
        return {
          branch_id: bid,
          branch_nama: namaCabang.get(bid)!,
          saldo,
          status: statusPerlengkapan(saldo, it.stokMinimum),
          aturan: rule
            ? {
                metode: rule.metode,
                qty: rule.qty,
                per_hari: rule.perHari,
                aktif: rule.aktif,
                mulai: rule.mulai,
              }
            : null,
        };
      });
    const sup = supPer.get(it.id);
    return {
      id: it.id,
      nama: it.nama,
      satuan: it.satuan,
      harga_beli: it.hargaBeli,
      stok_minimum: it.stokMinimum,
      catatan: it.catatan,
      kategori: it.kategori,
      boleh_eceran: it.bolehEceran,
      dilacak: it.dilacak,
      rak:
        it.storageLocationId && rakById.has(it.storageLocationId)
          ? { id: it.storageLocationId, nama: rakById.get(it.storageLocationId)! }
          : null,
      supplier_utama: sup?.utama ?? null,
      jumlah_supplier: sup?.jumlah ?? 0,
      lokasi,
    };
  });
}

/** Saldo satu item di satu cabang (untuk validasi pakai/koreksi & respons). */
export async function saldoSatuPerlengkapan(supplyId: string, branchId: string): Promise<number> {
  const [{ saldo }] = await db
    .select({ saldo: sql<number>`COALESCE(SUM(${supplyMutations.qty}), 0)::float8` })
    .from(supplyMutations)
    .where(
      and(
        eq(supplyMutations.supplyId, supplyId),
        eq(supplyMutations.branchId, branchId),
        eq(supplyMutations.status, "disetujui"),
      ),
    );
  return saldo;
}

const BATAS_MUTASI = 500;

/** Kartu (ledger) satu item per cabang per rentang tanggal + saldo berjalan. */
export async function kartuPerlengkapan(params: {
  companyId: string;
  branchId: string;
  supplyId: string;
  dari: string;
  sampai: string;
}): Promise<KartuPerlengkapanDto | null> {
  const [item] = await db
    .select({ id: supplies.id, nama: supplies.nama, satuan: supplies.satuan })
    .from(supplies)
    .where(and(eq(supplies.id, params.supplyId), eq(supplies.companyId, params.companyId)));
  if (!item) return null;

  const [{ saldoAwal }] = await db
    .select({ saldoAwal: sql<number>`COALESCE(SUM(${supplyMutations.qty}), 0)::float8` })
    .from(supplyMutations)
    .where(
      and(
        eq(supplyMutations.supplyId, params.supplyId),
        eq(supplyMutations.branchId, params.branchId),
        eq(supplyMutations.status, "disetujui"),
        lt(supplyMutations.tanggal, params.dari),
      ),
    );

  const rows = await db
    .select({
      id: supplyMutations.id,
      waktu: supplyMutations.waktu,
      tanggal: supplyMutations.tanggal,
      tipe: supplyMutations.tipe,
      qty: supplyMutations.qty,
      totalHarga: supplyMutations.totalHarga,
      catatan: supplyMutations.catatan,
      userNama: users.nama,
      // nomor dokumen PL- (hanya mutasi 'masuk' yang bernomor)
      nomor: dokumenNomor.nomorTeks,
    })
    .from(supplyMutations)
    .leftJoin(users, eq(supplyMutations.userId, users.id))
    .leftJoin(
      dokumenNomor,
      and(
        eq(dokumenNomor.companyId, supplyMutations.companyId),
        eq(dokumenNomor.refId, supplyMutations.id),
      ),
    )
    .where(
      and(
        eq(supplyMutations.supplyId, params.supplyId),
        eq(supplyMutations.branchId, params.branchId),
        // kartu = mutasi EFEKTIF; selisih opname 'menunggu'/'ditolak' tidak tampil
        eq(supplyMutations.status, "disetujui"),
        gte(supplyMutations.tanggal, params.dari),
        lte(supplyMutations.tanggal, params.sampai),
      ),
    )
    .orderBy(asc(supplyMutations.tanggal), asc(supplyMutations.waktu))
    .limit(BATAS_MUTASI + 1);

  const terpotong = rows.length > BATAS_MUTASI;
  const tampil = terpotong ? rows.slice(0, BATAS_MUTASI) : rows;
  let saldo = saldoAwal;
  let totalMasuk = 0;
  let totalKeluar = 0;
  let totalBelanja = 0;
  const mutasi = tampil.map((m) => {
    saldo += m.qty;
    if (m.qty >= 0) totalMasuk += m.qty;
    else totalKeluar += -m.qty;
    if (m.tipe === "masuk") totalBelanja += m.totalHarga ?? 0;
    return {
      id: m.id,
      waktu: (m.waktu as Date).toISOString(),
      tanggal: m.tanggal,
      tipe: m.tipe,
      masuk: m.qty >= 0 ? m.qty : null,
      keluar: m.qty < 0 ? -m.qty : null,
      saldo,
      total_harga: m.totalHarga,
      catatan: m.catatan,
      user_nama: m.userNama,
      nomor: m.nomor,
    };
  });
  return {
    item,
    periode: { dari: params.dari, sampai: params.sampai },
    saldo_awal: saldoAwal,
    saldo_akhir: saldo,
    total_masuk: totalMasuk,
    total_keluar: totalKeluar,
    total_belanja: totalBelanja,
    terpotong,
    mutasi,
  };
}

/** Ringkasan belanja perlengkapan (mutasi masuk) per rentang tanggal per cabang. */
export async function belanjaPerlengkapan(params: {
  companyId: string;
  branchId: string;
  dari: string;
  sampai: string;
}) {
  const rows = await db
    .select({
      supplyId: supplyMutations.supplyId,
      nama: supplies.nama,
      total: sql<number>`COALESCE(SUM(${supplyMutations.totalHarga}), 0)::float8`,
    })
    .from(supplyMutations)
    .innerJoin(supplies, eq(supplyMutations.supplyId, supplies.id))
    .where(
      and(
        eq(supplyMutations.companyId, params.companyId),
        eq(supplyMutations.branchId, params.branchId),
        eq(supplyMutations.tipe, "masuk"),
        gte(supplyMutations.tanggal, params.dari),
        lte(supplyMutations.tanggal, params.sampai),
      ),
    )
    .groupBy(supplyMutations.supplyId, supplies.nama)
    .orderBy(desc(sql`SUM(${supplyMutations.totalHarga})`));
  return {
    dari: params.dari,
    sampai: params.sampai,
    total: rows.reduce((a, r) => a + r.total, 0),
    per_item: rows.map((r) => ({ supply_id: r.supplyId, nama: r.nama, total: r.total })),
  };
}

/** dipakai routes utk memuat item milik company yang masih aktif */
export async function muatSupplyAktif(companyId: string, supplyId: string) {
  const [row] = await db
    .select()
    .from(supplies)
    .where(
      and(
        eq(supplies.id, supplyId),
        eq(supplies.companyId, companyId),
        eq(supplies.isActive, true),
      ),
    );
  return row ?? null;
}

/* ===== STOCK OPNAME PERLENGKAPAN (sesi + ACC owner/admin, spt bahan) ===== */

/**
 * Simpan hasil hitung fisik satu sesi: item dengan selisih ≠ 0 menjadi baris
 * 'koreksi' berstatus MENUNGGU (belum menyentuh saldo) sampai di-ACC.
 * Return null bila semua item sesuai sistem (tanpa selisih — tak ada sesi).
 */
export async function buatOpnamePerlengkapan(params: {
  companyId: string;
  branchId: string;
  userId: string;
  items: { supply_id: string; qty_fisik: number }[];
  catatan?: string | null;
}): Promise<{ session_id: string; nomor: string; jumlah_selisih: number } | null> {
  const ids = [...new Set(params.items.map((i) => i.supply_id))];
  const milik = await db
    .select({ id: supplies.id })
    .from(supplies)
    .where(
      and(
        eq(supplies.companyId, params.companyId),
        eq(supplies.isActive, true),
        inArray(supplies.id, ids.length > 0 ? ids : ["00000000-0000-0000-0000-000000000000"]),
      ),
    );
  const adaId = new Set(milik.map((r) => r.id));
  const tanggal = await tanggalPerusahaan(params.companyId);
  const sessionId = randomUUID();
  let jumlahSelisih = 0;
  let nomor: string | null = null;
  await db.transaction(async (tx) => {
    for (const it of params.items) {
      if (!adaId.has(it.supply_id)) continue;
      const [{ saldo }] = await tx
        .select({ saldo: sql<number>`COALESCE(SUM(${supplyMutations.qty}), 0)::float8` })
        .from(supplyMutations)
        .where(
          and(
            eq(supplyMutations.supplyId, it.supply_id),
            eq(supplyMutations.branchId, params.branchId),
            eq(supplyMutations.status, "disetujui"),
          ),
        );
      const selisih = it.qty_fisik - saldo;
      if (Math.abs(selisih) < 1e-9) continue;
      await tx.insert(supplyMutations).values({
        companyId: params.companyId,
        branchId: params.branchId,
        supplyId: it.supply_id,
        tipe: "koreksi",
        qty: selisih,
        tanggal,
        catatan: params.catatan ?? "Stock opname perlengkapan",
        userId: params.userId,
        status: "menunggu",
        sessionId,
        systemQty: saldo,
        qtyFisik: it.qty_fisik,
      });
      jumlahSelisih++;
    }
    if (jumlahSelisih > 0) {
      nomor = await terbitkanNomor(tx, params.companyId, "opname_perlengkapan", sessionId);
    }
  });
  return jumlahSelisih > 0 ? { session_id: sessionId, nomor: nomor!, jumlah_selisih: jumlahSelisih } : null;
}

/** Riwayat sesi opname perlengkapan satu cabang (terbaru dulu). */
export async function riwayatOpnamePerlengkapan(companyId: string, branchId: string) {
  const rows = await db
    .select({
      sessionId: supplyMutations.sessionId,
      waktu: sql<string>`MIN(${supplyMutations.waktu})::text`,
      jumlahItem: sql<number>`COUNT(*)::int`,
      status: sql<string>`MIN(${supplyMutations.status})`,
      oleh: sql<string | null>`MIN(${users.nama})`,
    })
    .from(supplyMutations)
    .leftJoin(users, eq(supplyMutations.userId, users.id))
    .where(
      and(
        eq(supplyMutations.companyId, companyId),
        eq(supplyMutations.branchId, branchId),
        sql`${supplyMutations.sessionId} IS NOT NULL`,
      ),
    )
    .groupBy(supplyMutations.sessionId)
    .orderBy(desc(sql`MIN(${supplyMutations.waktu})`))
    .limit(100);
  const nomorMap = await nomorUntukRefs(
    db,
    companyId,
    rows.map((r) => r.sessionId!),
  );
  return rows.map((r) => ({
    session_id: r.sessionId!,
    nomor: nomorMap.get(r.sessionId!) ?? null,
    waktu: new Date(r.waktu).toISOString(),
    oleh: r.oleh,
    jumlah_item: r.jumlahItem,
    status: r.status as "menunggu" | "disetujui" | "ditolak",
  }));
}

/** Detail baris satu sesi opname perlengkapan. */
export async function detailOpnamePerlengkapan(companyId: string, sessionId: string) {
  const rows = await db
    .select({
      supplyId: supplyMutations.supplyId,
      nama: supplies.nama,
      satuan: supplies.satuan,
      systemQty: supplyMutations.systemQty,
      qtyFisik: supplyMutations.qtyFisik,
      selisih: supplyMutations.qty,
      status: supplyMutations.status,
    })
    .from(supplyMutations)
    .innerJoin(supplies, eq(supplyMutations.supplyId, supplies.id))
    .where(
      and(eq(supplyMutations.companyId, companyId), eq(supplyMutations.sessionId, sessionId)),
    )
    .orderBy(asc(supplies.nama));
  if (rows.length === 0) return null;
  const nomorMap = await nomorUntukRefs(db, companyId, [sessionId]);
  return {
    session_id: sessionId,
    nomor: nomorMap.get(sessionId) ?? null,
    status: rows[0].status as "menunggu" | "disetujui" | "ditolak",
    rows: rows.map((r) => ({
      supply_id: r.supplyId,
      nama: r.nama,
      satuan: r.satuan,
      system_qty: r.systemQty,
      qty_fisik: r.qtyFisik,
      selisih: r.selisih,
    })),
  };
}

/** ACC / tolak semua baris satu sesi (owner/admin). Return jumlah baris. */
export async function setStatusOpnamePerlengkapan(
  companyId: string,
  sessionId: string,
  status: "disetujui" | "ditolak",
): Promise<number> {
  const rows = await db
    .update(supplyMutations)
    .set({ status })
    .where(
      and(
        eq(supplyMutations.companyId, companyId),
        eq(supplyMutations.sessionId, sessionId),
        eq(supplyMutations.status, "menunggu"),
      ),
    )
    .returning({ id: supplyMutations.id });
  return rows.length;
}

/* ===== KIRIMAN PERLENGKAPAN CK → CABANG (permintaan stok minimum) ===== */

/**
 * Cabang minta ke CK: buat faktur kiriman (KP-) bila CK punya stok cukup.
 * Saldo BELUM pindah — menunggu cabang menekan Terima.
 */
export async function buatKirimanPerlengkapan(params: {
  companyId: string;
  cabangId: string;
  supplyId: string;
  qty: number;
  userId: string;
  catatan?: string | null;
}): Promise<{ id: string; nomor: string } | { error: string }> {
  const [cab] = await db
    .select({ ckId: branches.centralKitchenId, tipe: branches.tipe, nama: branches.nama })
    .from(branches)
    .where(and(eq(branches.id, params.cabangId), eq(branches.companyId, params.companyId)));
  if (!cab) return { error: "Cabang tidak valid" };
  if (cab.tipe === "central_kitchen") {
    return { error: "Cabang ini Central Kitchen — belanja langsung lewat Stok Masuk" };
  }
  if (!cab.ckId) return { error: "Cabang belum terhubung ke Central Kitchen" };
  const saldoCk = await saldoSatuPerlengkapan(params.supplyId, cab.ckId);
  if (params.qty > saldoCk) {
    return { error: `Stok CK tidak cukup (saldo CK ${saldoCk}) — beli dulu di CK` };
  }
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(supplyTransfers)
      .values({
        companyId: params.companyId,
        dariBranchId: cab.ckId!,
        keBranchId: params.cabangId,
        supplyId: params.supplyId,
        qty: params.qty,
        catatan: params.catatan ?? null,
        userId: params.userId,
      })
      .returning({ id: supplyTransfers.id });
    const nomor = await terbitkanNomor(tx, params.companyId, "kiriman_perlengkapan", row.id);
    return { id: row.id, nomor };
  });
}

/**
 * Buat FAKTUR BELI perlengkapan ke CK (status 'menunggu'). Barang belum tiba;
 * setelah dibeli & tiba dipanggil {@link tibaBeliPerlengkapan} → masuk stok CK
 * + otomatis kirim ke cabang tujuan (bila diisi). Bernomor BP-.
 */
export async function buatBeliPerlengkapan(params: {
  companyId: string;
  ckBranchId: string;
  supplyId: string;
  qty: number;
  userId: string;
  tujuanBranchId?: string | null;
  totalHarga?: number | null;
  catatan?: string | null;
}): Promise<{ id: string; nomor: string }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(supplyPurchases)
      .values({
        companyId: params.companyId,
        ckBranchId: params.ckBranchId,
        supplyId: params.supplyId,
        qty: params.qty,
        tujuanBranchId: params.tujuanBranchId ?? null,
        totalHarga: params.totalHarga ?? null,
        catatan: params.catatan ?? null,
        userId: params.userId,
      })
      .returning({ id: supplyPurchases.id });
    const nomor = await terbitkanNomor(tx, params.companyId, "beli_perlengkapan", row.id);
    return { id: row.id, nomor };
  });
}

/**
 * Permintaan perlengkapan OTOMATIS untuk satu cabang: pindai item yang saldo ≤
 * stok minimum, lalu untuk tiap item terbitkan kiriman KP- sebanyak stok yang
 * ADA di CK; kekurangan yang belum tertutup diterbitkan sebagai FAKTUR BELI ke
 * CK (BP-) — dibeli → masuk stok CK → dikirim ke cabang, persis bahan baku.
 */
export async function permintaanOtomatisPerlengkapan(params: {
  companyId: string;
  cabangId: string;
  userId: string;
}): Promise<PermintaanPerlengkapanOtomatisHasil | { error: string; code?: number }> {
  const [cab] = await db
    .select({ ckId: branches.centralKitchenId, tipe: branches.tipe, nama: branches.nama })
    .from(branches)
    .where(and(eq(branches.id, params.cabangId), eq(branches.companyId, params.companyId)));
  if (!cab) return { error: "Cabang tidak valid", code: 400 };
  if (cab.tipe === "central_kitchen") {
    return { error: "Central Kitchen belanja langsung lewat Stok Masuk", code: 400 };
  }
  if (cab.tipe === "kantor") return { error: "Kantor tidak menyimpan stok", code: 400 };
  // saldo dijujurkan dulu (jatah otomatis) sebelum dibandingkan minimum
  await terapkanKonsumsiOtomatis(params.companyId, params.cabangId);
  const rows = await saldoPerlengkapan(params.companyId, params.cabangId);
  const dibuat: PermintaanPerlengkapanOtomatisHasil["dibuat"] = [];
  const beliDibuat: PermintaanPerlengkapanOtomatisHasil["beli_dibuat"] = [];
  const takBisa: PermintaanPerlengkapanOtomatisHasil["tak_bisa_kirim"] = [];
  for (const r of rows) {
    if (!(r.stok_minimum > 0) || r.saldo >= r.stok_minimum) continue;
    // butuh dibulatkan ke atas agar tak minta pecahan yang mustahil dikirim
    const kekurangan = Math.ceil(r.stok_minimum - r.saldo - 1e-9);
    if (kekurangan <= 0) continue;
    // cabang tak terhubung CK → tak bisa minta; catat sebagai info
    if (!cab.ckId) {
      takBisa.push({ supply_id: r.id, nama: r.nama, satuan: r.satuan, qty: kekurangan });
      continue;
    }
    const ckSaldo = Math.max(0, Math.floor((r.saldo_ck ?? 0) + 1e-9));
    const kirim = Math.min(kekurangan, ckSaldo);
    if (kirim > 0) {
      const hasil = await buatKirimanPerlengkapan({
        companyId: params.companyId,
        cabangId: params.cabangId,
        supplyId: r.id,
        qty: kirim,
        userId: params.userId,
        catatan: "Permintaan otomatis (stok ≤ minimum)",
      });
      if (!("error" in hasil)) {
        dibuat.push({
          supply_id: r.id,
          nama: r.nama,
          satuan: r.satuan,
          qty: kirim,
          nomor: hasil.nomor,
        });
      }
    }
    // sisa yang tak tertutup stok CK → faktur beli ke CK (dibeli lalu dikirim)
    const sisa = kekurangan - kirim;
    if (sisa > 0) {
      const beli = await buatBeliPerlengkapan({
        companyId: params.companyId,
        ckBranchId: cab.ckId,
        supplyId: r.id,
        qty: sisa,
        userId: params.userId,
        tujuanBranchId: params.cabangId,
        catatan: `Permintaan ${cab.nama} (stok CK kurang)`,
      });
      beliDibuat.push({
        supply_id: r.id,
        nama: r.nama,
        satuan: r.satuan,
        qty: sisa,
        nomor: beli.nomor,
        tujuan_nama: cab.nama,
      });
    }
  }
  return { dibuat, beli_dibuat: beliDibuat, tak_bisa_kirim: takBisa };
}

/**
 * Barang faktur beli TIBA di CK: qty final masuk stok CK (bernomor PL-),
 * faktur → 'tiba', lalu otomatis kirim (KP-) ke cabang tujuan bila diisi &
 * stok CK cukup. Idempoten via predikat status 'menunggu'.
 */
export async function tibaBeliPerlengkapan(params: {
  companyId: string;
  id: string;
  userId: string;
  qty?: number;
  totalHarga?: number | null;
}): Promise<
  | { id: string; nomor_masuk: string; kiriman: { id: string; nomor: string } | null }
  | { error: string; code?: number }
> {
  const [beli] = await db
    .select({
      ckBranchId: supplyPurchases.ckBranchId,
      supplyId: supplyPurchases.supplyId,
      qty: supplyPurchases.qty,
      totalHarga: supplyPurchases.totalHarga,
      tujuanBranchId: supplyPurchases.tujuanBranchId,
      status: supplyPurchases.status,
    })
    .from(supplyPurchases)
    .where(and(eq(supplyPurchases.id, params.id), eq(supplyPurchases.companyId, params.companyId)));
  if (!beli) return { error: "Faktur beli tidak ditemukan", code: 404 };
  if (beli.status !== "menunggu") {
    return { error: "Faktur ini sudah tiba atau dibatalkan", code: 400 };
  }
  const qtyFinal = params.qty != null && params.qty > 0 ? params.qty : beli.qty;
  const totalHarga = params.totalHarga ?? beli.totalHarga ?? null;
  const tanggal = await tanggalPerusahaan(params.companyId);

  // qty final masuk stok CK + faktur ditandai tiba (atomik). Update status
  // DULU dengan predikat 'menunggu' → dua submit bersamaan tak menggandakan
  // stok (yang kalah: 0 baris → rollback via sentinel).
  const SUDAH = Symbol("sudah_tiba");
  let nomorMasuk: string;
  try {
    nomorMasuk = await db.transaction(async (tx) => {
      const dikunci = await tx
        .update(supplyPurchases)
        .set({
          status: "tiba",
          qty: qtyFinal,
          totalHarga,
          tibaBy: params.userId,
          tibaAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(supplyPurchases.id, params.id), eq(supplyPurchases.status, "menunggu")))
        .returning({ id: supplyPurchases.id });
      if (dikunci.length === 0) throw SUDAH;
      const [mut] = await tx
        .insert(supplyMutations)
        .values({
          companyId: params.companyId,
          branchId: beli.ckBranchId,
          supplyId: beli.supplyId,
          tipe: "masuk",
          qty: qtyFinal,
          totalHarga,
          tanggal,
          catatan: "Tiba dari faktur beli perlengkapan",
          userId: params.userId,
        })
        .returning({ id: supplyMutations.id });
      return terbitkanNomor(tx, params.companyId, "perlengkapan", mut.id);
    });
  } catch (e) {
    if (e === SUDAH) return { error: "Faktur ini sudah tiba atau dibatalkan", code: 400 };
    throw e;
  }

  // otomatis kirim ke cabang tujuan (stok CK kini cukup)
  let kiriman: { id: string; nomor: string } | null = null;
  if (beli.tujuanBranchId) {
    const ckSaldo = await saldoSatuPerlengkapan(beli.supplyId, beli.ckBranchId);
    const kirimQty = Math.min(qtyFinal, Math.max(0, Math.floor(ckSaldo + 1e-9)));
    if (kirimQty > 0) {
      const hasil = await buatKirimanPerlengkapan({
        companyId: params.companyId,
        cabangId: beli.tujuanBranchId,
        supplyId: beli.supplyId,
        qty: kirimQty,
        userId: params.userId,
        catatan: "Kiriman otomatis (barang beli tiba di CK)",
      });
      if (!("error" in hasil)) {
        kiriman = hasil;
        await db
          .update(supplyPurchases)
          .set({ kirimTransferId: hasil.id })
          .where(eq(supplyPurchases.id, params.id));
      }
    }
  }
  return { id: params.id, nomor_masuk: nomorMasuk, kiriman };
}

/** Batalkan faktur beli yang masih 'menunggu' (belum tiba). */
export async function batalBeliPerlengkapan(
  companyId: string,
  id: string,
): Promise<{ ok: true } | { error: string; code?: number }> {
  const done = await db
    .update(supplyPurchases)
    .set({ status: "batal", updatedAt: new Date() })
    .where(
      and(
        eq(supplyPurchases.id, id),
        eq(supplyPurchases.companyId, companyId),
        eq(supplyPurchases.status, "menunggu"),
      ),
    )
    .returning({ id: supplyPurchases.id });
  if (done.length === 0) {
    return { error: "Faktur tidak ditemukan / sudah tiba", code: 404 };
  }
  return { ok: true };
}

/** Daftar faktur beli perlengkapan (menunggu dulu, lalu terbaru). Opsional CK. */
export async function daftarBeliPerlengkapan(
  companyId: string,
  ckBranchId?: string,
): Promise<BeliPerlengkapanRow[]> {
  const ckB = alias(branches, "ck_beli");
  const tujuanB = alias(branches, "tujuan_beli");
  const conds = [eq(supplyPurchases.companyId, companyId)];
  if (ckBranchId) conds.push(eq(supplyPurchases.ckBranchId, ckBranchId));
  const rows = await db
    .select({
      id: supplyPurchases.id,
      supplyId: supplyPurchases.supplyId,
      nama: supplies.nama,
      satuan: supplies.satuan,
      qty: supplyPurchases.qty,
      totalHarga: supplyPurchases.totalHarga,
      status: supplyPurchases.status,
      ckNama: ckB.nama,
      tujuanNama: tujuanB.nama,
      catatan: supplyPurchases.catatan,
      waktu: supplyPurchases.createdAt,
      oleh: users.nama,
    })
    .from(supplyPurchases)
    .innerJoin(supplies, eq(supplyPurchases.supplyId, supplies.id))
    .innerJoin(ckB, eq(supplyPurchases.ckBranchId, ckB.id))
    .leftJoin(tujuanB, eq(supplyPurchases.tujuanBranchId, tujuanB.id))
    .leftJoin(users, eq(supplyPurchases.userId, users.id))
    .where(and(...conds))
    // 'menunggu' di atas (butuh aksi), lalu terbaru
    .orderBy(sql`(${supplyPurchases.status} = 'menunggu') desc`, desc(supplyPurchases.createdAt))
    .limit(200);
  const nomorMap = await nomorUntukRefs(
    db,
    companyId,
    rows.map((r) => r.id),
  );
  return rows.map((r) => ({
    id: r.id,
    supply_id: r.supplyId,
    nama: r.nama,
    satuan: r.satuan,
    qty: r.qty,
    total_harga: r.totalHarga,
    status: r.status,
    ck_nama: r.ckNama,
    tujuan_nama: r.tujuanNama,
    catatan: r.catatan,
    waktu: r.waktu.toISOString(),
    oleh: r.oleh,
    nomor: nomorMap.get(r.id) ?? null,
  }));
}

/** Kiriman yang melibatkan cabang ini (masuk & keluar), terbaru dulu. */
export async function daftarKirimanPerlengkapan(companyId: string, branchId: string) {
  const dariB = alias(branches, "dari_kiriman");
  const keB = alias(branches, "ke_kiriman");
  const rows = await db
    .select({
      id: supplyTransfers.id,
      qty: supplyTransfers.qty,
      status: supplyTransfers.status,
      waktu: supplyTransfers.waktu,
      catatan: supplyTransfers.catatan,
      keBranchId: supplyTransfers.keBranchId,
      dariNama: dariB.nama,
      keNama: keB.nama,
      itemId: supplies.id,
      itemNama: supplies.nama,
      itemSatuan: supplies.satuan,
      oleh: users.nama,
    })
    .from(supplyTransfers)
    .innerJoin(supplies, eq(supplyTransfers.supplyId, supplies.id))
    .innerJoin(dariB, eq(supplyTransfers.dariBranchId, dariB.id))
    .innerJoin(keB, eq(supplyTransfers.keBranchId, keB.id))
    .leftJoin(users, eq(supplyTransfers.userId, users.id))
    .where(
      and(
        eq(supplyTransfers.companyId, companyId),
        sql`(${supplyTransfers.dariBranchId} = ${branchId} OR ${supplyTransfers.keBranchId} = ${branchId})`,
      ),
    )
    .orderBy(desc(supplyTransfers.waktu))
    .limit(50);
  const nomorMap = await nomorUntukRefs(
    db,
    companyId,
    rows.map((r) => r.id),
  );
  return rows.map((r) => ({
    id: r.id,
    nomor: nomorMap.get(r.id) ?? null,
    dari_cabang: r.dariNama,
    ke_cabang: r.keNama,
    ke_branch_id: r.keBranchId,
    item: { id: r.itemId, nama: r.itemNama, satuan: r.itemSatuan },
    qty: r.qty,
    status: r.status,
    waktu: (r.waktu as Date).toISOString(),
    oleh: r.oleh,
    catatan: r.catatan,
  }));
}

/**
 * Cabang menerima kiriman: saldo pindah SEKARANG (CK − / cabang +) lewat
 * sepasang mutasi kirim/terima; kiriman ditandai diterima.
 */
export async function terimaKirimanPerlengkapan(params: {
  companyId: string;
  transferId: string;
  branchId: string;
  userId: string;
}): Promise<{ ok: true; saldo: number } | { error: string; code?: number }> {
  const [t] = await db
    .select()
    .from(supplyTransfers)
    .where(
      and(
        eq(supplyTransfers.id, params.transferId),
        eq(supplyTransfers.companyId, params.companyId),
      ),
    );
  if (!t) return { error: "Kiriman tidak ditemukan", code: 404 };
  if (t.keBranchId !== params.branchId) {
    return { error: "Kiriman ini bukan untuk cabang yang dipilih", code: 400 };
  }
  if (t.status !== "dikirim") return { error: "Kiriman sudah diterima", code: 400 };
  const tanggal = await tanggalPerusahaan(params.companyId);
  const nomorMap = await nomorUntukRefs(db, params.companyId, [t.id]);
  const nomor = nomorMap.get(t.id) ?? "";
  await db.transaction(async (tx) => {
    await tx
      .update(supplyTransfers)
      .set({ status: "diterima", diterimaBy: params.userId, diterimaAt: new Date() })
      .where(eq(supplyTransfers.id, t.id));
    await tx.insert(supplyMutations).values([
      {
        companyId: params.companyId,
        branchId: t.dariBranchId,
        supplyId: t.supplyId,
        tipe: "kirim",
        qty: -t.qty,
        tanggal,
        catatan: `Kiriman ${nomor}`.trim(),
        userId: params.userId,
      },
      {
        companyId: params.companyId,
        branchId: t.keBranchId,
        supplyId: t.supplyId,
        tipe: "terima",
        qty: t.qty,
        tanggal,
        catatan: `Kiriman ${nomor}`.trim(),
        userId: params.userId,
      },
    ]);
  });
  return { ok: true, saldo: await saldoSatuPerlengkapan(t.supplyId, params.branchId) };
}

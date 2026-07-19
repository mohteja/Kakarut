/**
 * Perlengkapan (non bahan baku): saldo per cabang dari ledger mutasi bertanda,
 * plus KONSUMSI OTOMATIS harian berdasarkan aturan per (cabang, item) —
 * dimaterialisasi malas (tanpa cron): dipanggil saat daftar/kartu dibuka,
 * sebelum pakai/koreksi, dan sekali saat boot.
 */
import { and, asc, desc, eq, gte, lt, lte, sql } from "drizzle-orm";
import type { KartuPerlengkapanDto, PerlengkapanRowDto, StokStatus } from "@kakarut/shared";
import { db } from "../../db/client";
import {
  branches,
  companies,
  dokumenNomor,
  supplies,
  supplyMutations,
  supplyRules,
  users,
} from "../../db/schema";
import { tanggalDi } from "../../lib/time";

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

/** Daftar item aktif + saldo cabang + aturan cabang (untuk halaman utama). */
export async function saldoPerlengkapan(
  companyId: string,
  branchId: string,
): Promise<PerlengkapanRowDto[]> {
  const rows = await db
    .select({
      id: supplies.id,
      nama: supplies.nama,
      satuan: supplies.satuan,
      hargaBeli: supplies.hargaBeli,
      stokMinimum: supplies.stokMinimum,
      catatan: supplies.catatan,
      saldo: sql<number>`COALESCE((SELECT SUM(${supplyMutations.qty}) FROM ${supplyMutations} WHERE ${supplyMutations.supplyId} = ${supplies.id} AND ${supplyMutations.branchId} = ${branchId}), 0)::float8`,
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
    aturan:
      r.aturanQty != null
        ? {
            qty: r.aturanQty,
            per_hari: r.aturanPerHari!,
            aktif: r.aturanAktif!,
            mulai: r.aturanMulai!,
          }
        : null,
  }));
}

/** Saldo satu item di satu cabang (untuk validasi pakai/koreksi & respons). */
export async function saldoSatuPerlengkapan(supplyId: string, branchId: string): Promise<number> {
  const [{ saldo }] = await db
    .select({ saldo: sql<number>`COALESCE(SUM(${supplyMutations.qty}), 0)::float8` })
    .from(supplyMutations)
    .where(and(eq(supplyMutations.supplyId, supplyId), eq(supplyMutations.branchId, branchId)));
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

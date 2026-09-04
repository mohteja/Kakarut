/**
 * Perlengkapan (non bahan baku): saldo per cabang dari ledger mutasi bertanda,
 * plus KONSUMSI OTOMATIS harian berdasarkan aturan per (cabang, item) —
 * dimaterialisasi malas (tanpa cron): dipanggil saat daftar/kartu dibuka,
 * sebelum pakai/koreksi, dan sekali saat boot.
 */
import { randomUUID } from "node:crypto";
import { keSkalaKolom, SKALA_QTY_PERLENGKAPAN } from "../../lib/batas-angka";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type {
  BeliPerlengkapanRow,
  KartuPerlengkapanDto,
  PerlengkapanMasterRow,
  PerlengkapanRowDto,
  PermintaanPerlengkapanOtomatisHasil,
  RakLokasi,
  RingkasBeliPerlengkapan,
  StokStatus,
} from "@kakarut/shared";
import { kekuranganKeMinimum } from "@kakarut/shared";
import { db } from "../../db/client";
import {
  branches,
  companies,
  dokumenNomor,
  productions,
  storageLocationIngredients,
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
import { kunciAntrean } from "../../lib/kunci";
import { tanggalDi } from "../../lib/time";
import { nomorUntukRefs, terbitkanNomor } from "../dokumen/nomor";
import { kunciKirimCabang } from "../stok/service";

/** Tanggal lokal hari ini pada zona waktu perusahaan. */
/**
 * TIGA DAFTAR DI BERKAS INI DIPOTONG, dan dulu ketiganya diam soal itu.
 *
 * Batasnya tidak berubah — yang berubah, servicenya kini mengambil SATU BARIS
 * LEBIH dan routes-nya memanggil `potongLarik` (lihat `lib/potong.ts`), jadi
 * pemakainya diberi tahu lewat header `X-Kakarut-Terpotong`. Tetapannya hidup
 * di sini, bukan disalin ke routes, supaya kedua sisi tak bisa bergeser
 * sendiri: yang mengambil `BATAS + 1` dan yang memotong ke `BATAS` harus
 * selalu angka yang sama.
 *
 * Bentuk larik telanjangnya SENGAJA tak berubah jadi objek: build ponsel lama
 * membacanya `as List`, dan repo ini tak punya gerbang versi klien.
 */
export const BATAS_OPNAME_PERLENGKAPAN = 100;
export const BATAS_BELI_PERLENGKAPAN = 200;
export const BATAS_KIRIMAN_PERLENGKAPAN = 50;

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
    await db.transaction(async (tx) => {
      /*
       * SATU ATURAN DITERAPKAN OLEH SATU PROSES SAJA, dan ini bukan kehati-hatian
       * berlebih — tanpa kunci ini saldo perlengkapan JATUH MINUS.
       *
       * Yang membuatnya berbahaya: potongan ini berjalan SENDIRI setiap kali
       * daftar perlengkapan dibuka. Tak ada yang menekan apa pun. Beberapa
       * tablet yang memuat layar Perlengkapan bersamaan di pagi hari — saat
       * kursor semua aturan masih kemarin dan tunggakannya beberapa hari —
       * sudah cukup.
       *
       * Bagaimana ia bocor, padahal `supply_mutations_auto_uq` memaksa satu
       * baris auto per item/cabang/hari dan `onConflictDoNothing` sudah dipakai:
       * indeks itu menjaga TIDAK ADA HARI YANG DIPOTONG DUA KALI, dan ia
       * memang menepatinya. Yang tak dijaganya adalah BERAPA TOTALNYA.
       *
       *   proses A: sisaRak=10 → isi hari 1..4 (3+3+3+1), stok habis, hari 5..7
       *             DITINGGALKAN karena `sisa <= 0`
       *   proses B: sudah membaca sisaRak=10 SEBELUM A commit → hari 1..4
       *             bentrok (dilewati, benar), lalu hari 5..7 MASIH KOSONG
       *             sehingga terisi 3+3+3
       *
       * Hasilnya 19 terpakai dari 10 yang ada. Terukur pada 8 item dengan 6 GET
       * serentak: 7 dari 8 item jatuh ke saldo −9, nol baris ganda. Indeksnya
       * hijau, bukunya salah.
       *
       * Kuncinya per-ATURAN, jadi aturan lain tetap berjalan berdampingan.
       * `sisaRak` dibaca DI DALAM kunci — itu intinya: yang membuat B salah
       * bukan tulisannya melainkan bacaannya yang sudah basi.
       */
      await kunciAntrean(tx, "konsumsi-auto", r.id);
      /*
       * Kursornya juga dibaca ulang di dalam kunci. Daftar `rules` di atas
       * diambil sebelum kunci ini didapat, jadi proses lain bisa sudah
       * menerapkan aturan ini seluruhnya di sela itu — dan mengulanginya cuma
       * membuang kueri.
       */
      const [segar] = await tx
        .select({ terakhirDiterapkan: supplyRules.terakhirDiterapkan })
        .from(supplyRules)
        .where(eq(supplyRules.id, r.id));
      if (!segar || segar.terakhirDiterapkan === hariIni) return;
      const hari = hariTerjadwal(r.mulai, r.perHari, segar.terakhirDiterapkan, hariIni);
      if (hari.length > 0) {
        /*
         * YANG BISA DIPAKAI ADALAH YANG ADA DI RAK.
         *
         * Niat kode ini sudah benar sejak awal — `if (sisa <= 0) break` di
         * bawah artinya "jangan memakai yang tidak ada". Yang salah cuma
         * ukurannya: ledger perlengkapan baru bergerak saat diterima, jadi
         * saldo mentah masih memuat barang yang fisiknya sudah di truk.
         *
         * Terukur, dan ini yang paling tajam dari seluruh keluarganya karena
         * TAK ADA yang menekan apa pun — potongan ini berjalan sendiri setiap
         * kali daftar perlengkapan dibuka:
         *
         *   CK 10 pcs, seluruhnya sudah dikirim, rak kosong
         *   aturan 3 pcs/hari × 4 hari → memakan seluruh 10, saldo CK 0
         *   toko menekan Terima        → CK −10, total 0 dari 10 yang ada
         *
         * Pembandingnya `saldoDiRakPerlengkapan`, sama dengan pintu-pintu lain.
         */
        const sisaRak =
          (await saldoDiRakPerlengkapan(tx, companyId, r.branchId, [r.supplyId])).get(r.supplyId) ??
          0;
        let sisa = sisaRak;
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
            // Tanpa pembulatan, `sisa` bisa mendarat di 1e-17 alih-alih 0 dan
            // hari berikutnya menyisipkan mutasi hantu sebesar derau itu.
            sisa = keSkalaKolom(sisa - q, SKALA_QTY_PERLENGKAPAN);
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
  // rak simpan per item DI CABANG INI (sumber: Tempat Penyimpanan / tabel sli)
  const rakRows = await db
    .select({
      supplyId: storageLocationIngredients.supplyId,
      id: storageLocations.id,
      nama: storageLocations.nama,
    })
    .from(storageLocationIngredients)
    .innerJoin(
      storageLocations,
      eq(storageLocations.id, storageLocationIngredients.storageLocationId),
    )
    .where(
      and(
        eq(storageLocationIngredients.companyId, companyId),
        eq(storageLocations.branchId, branchId),
        isNotNull(storageLocationIngredients.supplyId),
      ),
    );
  const rakBySupply = new Map(rakRows.map((r) => [r.supplyId!, { id: r.id, nama: r.nama }]));
  const rows = await db
    .select({
      id: supplies.id,
      nama: supplies.nama,
      satuan: supplies.satuan,
      hargaBeli: supplies.hargaBeli,
      stokMinimum: supplies.stokMinimum,
      catatan: supplies.catatan,
      saldo: sql<number>`COALESCE((SELECT SUM(${supplyMutations.qty}) FROM ${supplyMutations} WHERE ${supplyMutations.supplyId} = ${supplies.id} AND ${supplyMutations.branchId} = ${branchId} AND ${supplyMutations.status} = 'disetujui'), 0)::float8`,
      saldoCk: ckId
        ? sql<number>`COALESCE((SELECT SUM(${supplyMutations.qty}) FROM ${supplyMutations} WHERE ${supplyMutations.supplyId} = ${supplies.id} AND ${supplyMutations.branchId} = ${ckId} AND ${supplyMutations.status} = 'disetujui'), 0)::float8`
        : sql<number | null>`NULL::float8`,
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
  // Yang sudah berangkat dari cabang INI tapi belum diterima — raknya sudah
  // kosong sementara ledgernya belum bergerak. Dipakai layar opname supaya yang
  // dibandingkan angka rak, bukan angka buku.
  const dalamJalan = await qtyPerlengkapanDalamJalan(db, companyId, branchId);
  /*
   * `saldo_ck` HARUS bersih dari barang di jalan.
   *
   * Angka ini punya satu pekerjaan: menyalakan tombol "Minta ke CK", mengisi
   * qty-nya, dan memberitahu cabang berapa yang bisa diminta. Ledger CK masih
   * memuat barang yang sudah berangkat ke cabang LAIN, jadi ledger mentah
   * menjanjikan barang yang sudah punya tuan.
   *
   * Terukur: CK 10 pcs yang seluruhnya sudah dikirim ke Toko B; Toko C melihat
   * "Stok Central Kitchen: 10", tombolnya menyala, qty-nya terisi 10 — dan
   * server menolak dengan "siap kirim 0 dari saldo 10". Cabangnya melakukan
   * perjalanan yang dijamin gagal, lalu menyalahkan sistem yang benar.
   *
   * Penjaga sisi tulisnya sudah benar sejak #201; yang salah tinggal janjinya.
   */
  const dalamJalanDariCk = ckId
    ? await qtyPerlengkapanDalamJalan(db, companyId, ckId)
    : new Map<string, number>();
  return rows.map((r) => ({
    id: r.id,
    nama: r.nama,
    satuan: r.satuan,
    harga_beli: r.hargaBeli,
    stok_minimum: r.stokMinimum,
    catatan: r.catatan,
    saldo: r.saldo,
    dalam_jalan: dalamJalan.get(r.id) ?? 0,
    status: statusPerlengkapan(r.saldo, r.stokMinimum),
    rak: rakBySupply.get(r.id) ?? null,
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
    saldo_ck: r.saldoCk == null ? null : r.saldoCk - (dalamJalanDariCk.get(r.id) ?? 0),
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
  // DI SIMPAN DI MANA: rak per cabang per item (sumber Tempat Penyimpanan / sli)
  const rakLokasiRows = await db
    .select({
      supplyId: storageLocationIngredients.supplyId,
      rakId: storageLocations.id,
      rakNama: storageLocations.nama,
      branchId: branches.id,
      branchNama: branches.nama,
      branchTipe: branches.tipe,
    })
    .from(storageLocationIngredients)
    .innerJoin(
      storageLocations,
      eq(storageLocations.id, storageLocationIngredients.storageLocationId),
    )
    .innerJoin(branches, eq(branches.id, storageLocations.branchId))
    .where(
      and(
        eq(storageLocationIngredients.companyId, companyId),
        isNotNull(storageLocationIngredients.supplyId),
      ),
    )
    .orderBy(asc(branches.tipe), asc(branches.nama), asc(storageLocations.nama));
  const rakLokasiBySupply = new Map<string, RakLokasi[]>();
  for (const r of rakLokasiRows) {
    const arr = rakLokasiBySupply.get(r.supplyId!) ?? [];
    arr.push({
      branch_id: r.branchId,
      branch_nama: r.branchNama,
      branch_tipe: r.branchTipe,
      rak_id: r.rakId,
      rak_nama: r.rakNama,
    });
    rakLokasiBySupply.set(r.supplyId!, arr);
  }
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
      rak_lokasi: rakLokasiBySupply.get(it.id) ?? [],
      supplier_utama: sup?.utama ?? null,
      jumlah_supplier: sup?.jumlah ?? 0,
      lokasi,
    };
  });
}

/** Saldo satu item di satu cabang (untuk validasi pakai/koreksi & respons). */
export async function saldoSatuPerlengkapan(
  supplyId: string,
  branchId: string,
  /** transaksi pemanggil, bila saldonya dipakai untuk memutuskan sebelum menulis */
  exec: Pick<typeof db, "select"> = db,
): Promise<number> {
  const [{ saldo }] = await exec
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
    .orderBy(asc(supplyMutations.tanggal), asc(supplyMutations.waktu), asc(supplyMutations.id))
    .limit(BATAS_MUTASI + 1);

  const terpotong = rows.length > BATAS_MUTASI;
  const tampil = terpotong ? rows.slice(0, BATAS_MUTASI) : rows;
  let saldo = saldoAwal;
  let totalMasuk = 0;
  let totalKeluar = 0;
  let totalBelanja = 0;
  // Saldo berjalan & totalnya dikembalikan ke skala kolom di TIAP langkah —
  // kartu ini menumpuk baris demi baris sampai `BATAS_MUTASI`, jadi driftnya
  // tumbuh dengan jumlah barisnya, dan yang dibaca petugas setiap barisnya.
  const skala = (n: number) => keSkalaKolom(n, SKALA_QTY_PERLENGKAPAN);
  const mutasi = tampil.map((m) => {
    saldo = skala(saldo + m.qty);
    if (m.qty >= 0) totalMasuk = skala(totalMasuk + m.qty);
    else totalKeluar = skala(totalKeluar + -m.qty);
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
 *
 * YANG DIBANDINGKAN ADALAH ANGKA RAK, BUKAN ANGKA BUKU.
 *
 * Ledger perlengkapan baru bergerak SAAT DITERIMA. Jadi barang yang sudah
 * berangkat ke cabang sudah tidak ada di rak CK, tapi masih utuh di ledgernya.
 * Membandingkan hitungan fisik dengan ledger mentah membuat petugas "menemukan"
 * kekurangan yang sebenarnya cuma barang di jalan — lalu debit kirimannya
 * mendarat DI ATAS koreksi itu dan barang yang sama dipotong dua kali.
 *
 * Terukur pada server sungguhan, CK berisi 10 pcs yang seluruhnya sudah
 * dikirim:
 *
 *   opname di-ACC (rak memang kosong) → koreksi −10
 *   toko menekan Terima               → debit   −10
 *   CK = −10, Toko = 10, total = 0 dari 10 yang ada
 *
 * Sepuluh unit menguap dari pembukuan dan saldo CK jatuh minus — persis
 * keluhan yang membuat seluruh sapuan stok ini dimulai.
 *
 * Maka pembandingnya `saldo − dalam_jalan`: yang MEMANG seharusnya ada di rak.
 * Pada contoh di atas selisihnya jadi nol, tak ada koreksi yang lahir, dan
 * sesudah Terima saldo CK mendarat di 0 dengan benar.
 *
 * `systemQty` ikut merekam angka pembanding itu — bukan ledger mentahnya —
 * supaya arsip opname-nya menceritakan perbandingan yang benar-benar terjadi.
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
    const rak = await saldoDiRakPerlengkapan(tx, params.companyId, params.branchId, ids);
    for (const it of params.items) {
      if (!adaId.has(it.supply_id)) continue;
      const diRak = rak.get(it.supply_id) ?? 0;
      const selisih = it.qty_fisik - diRak;
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
        systemQty: diRak,
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
    .orderBy(desc(sql`MIN(${supplyMutations.waktu})`), supplyMutations.sessionId)
    // SATU baris lebih: pemotongannya diumumkan routes-nya lewat `potongLarik`.
    .limit(BATAS_OPNAME_PERLENGKAPAN + 1);
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
export async function detailOpnamePerlengkapan(
  companyId: string,
  sessionId: string,
  /** Syarat cabang pemanggil — sesi opname milik SATU cabang. */
  kurung: SQL | undefined,
) {
  const rows = await db
    .select({
      supplyId: supplyMutations.supplyId,
      nama: supplies.nama,
      satuan: supplies.satuan,
      systemQty: supplyMutations.systemQty,
      qtyFisik: supplyMutations.qtyFisik,
      selisih: supplyMutations.qty,
      status: supplyMutations.status,
      /*
       * Stempel & pencatat SESI, bukan baris — dihitung `min(...) over ()` di
       * kueri yang sama supaya aturannya PERSIS milik `riwayatOpnamePerlengkapan`
       * (`MIN(waktu)`, `MIN(users.nama)`, SQL yang sama, kolasi yang sama).
       * Menghitungnya di JS atas baris yang sama akan menghasilkan jawaban yang
       * hampir selalu sama — dan "hampir" adalah celah tempat daftar dan detail
       * mulai menyebut jam berbeda untuk satu sesi.
       */
      waktuSesi: sql<string>`min(${supplyMutations.waktu}) over ()::text`,
      olehSesi: sql<string | null>`min(${users.nama}) over ()`,
    })
    .from(supplyMutations)
    .innerJoin(supplies, eq(supplyMutations.supplyId, supplies.id))
    .leftJoin(users, eq(supplyMutations.userId, users.id))
    .where(
      and(
        eq(supplyMutations.companyId, companyId),
        kurung,
        eq(supplyMutations.sessionId, sessionId),
      ),
    )
    .orderBy(asc(supplies.nama));
  if (rows.length === 0) return null;
  const nomorMap = await nomorUntukRefs(db, companyId, [sessionId]);
  return {
    session_id: sessionId,
    nomor: nomorMap.get(sessionId) ?? null,
    status: rows[0].status as "menunggu" | "disetujui" | "ditolak",
    waktu: new Date(rows[0].waktuSesi).toISOString(),
    oleh: rows[0].olehSesi,
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
 * Perlengkapan yang SUDAH BERANGKAT dari sebuah cabang tapi belum ditekan
 * "Terima" di tujuannya, per supply.
 *
 * Ledger perlengkapan baru bergerak SAAT DITERIMA — kedua mutasi (debit asal,
 * kredit tujuan) ditulis sekaligus di `terimaKirimanPerlengkapan`. Selama
 * barang di jalan, saldo CK karena itu masih memuatnya utuh. Siapa pun yang
 * memakai saldo itu untuk memutuskan "boleh kirim berapa" harus menguranginya
 * dulu dengan angka ini, kalau tidak stok yang sama dijanjikan berkali-kali.
 *
 * Bentuknya sengaja meniru `qtyDalamJalan` di modul stok bahan baku, yang
 * menjawab pertanyaan yang sama untuk ledger sebelah.
 */
export async function qtyPerlengkapanDalamJalan(
  exec: Pick<typeof db, "select">,
  companyId: string,
  dariBranchId: string,
  supplyIds?: string[],
): Promise<Map<string, number>> {
  if (supplyIds && supplyIds.length === 0) return new Map();
  const rows = await exec
    .select({
      supplyId: supplyTransfers.supplyId,
      qty: sql<number>`COALESCE(SUM(${supplyTransfers.qty}), 0)::float8`,
    })
    .from(supplyTransfers)
    .where(
      and(
        eq(supplyTransfers.companyId, companyId),
        eq(supplyTransfers.dariBranchId, dariBranchId),
        eq(supplyTransfers.status, "dikirim"),
        ...(supplyIds ? [inArray(supplyTransfers.supplyId, supplyIds)] : []),
      ),
    )
    .groupBy(supplyTransfers.supplyId);
  return new Map(rows.map((r) => [r.supplyId, Number(r.qty) || 0]));
}

/**
 * Saldo yang SEHARUSNYA ADA DI RAK, per supply: ledger dikurangi barang yang
 * sudah berangkat dari cabang ini dan belum ditekan Terima di tujuannya.
 *
 * SETIAP tempat yang membandingkan hitungan fisik dengan saldo WAJIB memakai
 * ini, dan fungsinya ada supaya tak ada lagi yang lupa. Ledger perlengkapan
 * bergerak terlambat — baru saat diterima — jadi tiap pembanding yang membaca
 * saldo mentah akan "menemukan" kekurangan yang cuma barang di jalan, lalu
 * mengoreksinya; debit kirimannya kemudian mendarat di atas koreksi itu dan
 * barang yang sama dipotong dua kali.
 *
 * Terukur di TIGA pintu berbeda sebelum ini, semuanya dengan hasil yang sama
 * (CK 10 pcs yang seluruhnya sudah dikirim, petugas menghitung rak = 0):
 *
 *   POST /perlengkapan/opname        → CK −10, total 0 dari 10
 *   POST /perlengkapan/stok-awal     → CK −10, total 0 dari 10
 *   POST /perlengkapan/:id/koreksi   → CK −10, total 0 dari 10
 *
 * Ketiganya menanyakan hal yang sama kepada orang yang sama di halaman yang
 * sama. Menambalnya satu per satu hanya menunda pintu keempat.
 */
export async function saldoDiRakPerlengkapan(
  exec: Pick<typeof db, "select">,
  companyId: string,
  branchId: string,
  supplyIds: string[],
): Promise<Map<string, number>> {
  if (supplyIds.length === 0) return new Map();
  const saldo = await exec
    .select({
      supplyId: supplyMutations.supplyId,
      qty: sql<number>`COALESCE(SUM(${supplyMutations.qty}), 0)::float8`,
    })
    .from(supplyMutations)
    .where(
      and(
        eq(supplyMutations.branchId, branchId),
        eq(supplyMutations.status, "disetujui"),
        inArray(supplyMutations.supplyId, supplyIds),
      ),
    )
    .groupBy(supplyMutations.supplyId);
  const dalamJalan = await qtyPerlengkapanDalamJalan(exec, companyId, branchId, supplyIds);
  const peta = new Map<string, number>();
  for (const id of supplyIds) peta.set(id, -(dalamJalan.get(id) ?? 0));
  for (const r of saldo) peta.set(r.supplyId, (peta.get(r.supplyId) ?? 0) + (Number(r.qty) || 0));
  // Saldo rak DISUSUN DI JS dari dua SUM float8 yang masing-masing sudah
  // dibulatkan sendiri, jadi hasilnya bisa meleset di digit ke-17 — dan
  // pintu `pakai`/`minta` membandingkannya dengan permintaan klien. Terukur:
  // 0,3 − 0,1 = 0.19999999999999998 → "pakai 0,2" ditolak 400 atas stok yang
  // ADA, dengan angka derau itu ikut tercetak di pesannya. Dikembalikan ke
  // presisi kolomnya (numeric(16,3)) — lihat `keSkalaKolom`.
  for (const [id, v] of peta) peta.set(id, keSkalaKolom(v, SKALA_QTY_PERLENGKAPAN));
  return peta;
}

/**
 * Cabang minta ke CK: buat faktur kiriman (KP-) bila CK punya stok cukup.
 * Saldo BELUM pindah — menunggu cabang menekan Terima.
 *
 * STOK CK HANYA BOLEH DIJANJIKAN SEKALI.
 *
 * Justru karena saldo belum pindah, ledger CK masih memuat barang yang sudah
 * berangkat. Pemeriksaan "stok CK cukup" yang membaca ledger apa adanya karena
 * itu meluluskan kiriman kedua atas barang yang sama — dan ini BUKAN balapan,
 * cukup dua permintaan berurutan. Terukur pada server sungguhan, CK berisi 10:
 *
 *   Toko A minta → KP-0026, 10 pcs   (saldo CK terbaca 10)
 *   Toko B minta → KP-0032, 10 pcs   (saldo CK MASIH terbaca 10)
 *   keduanya diterima → CK = −10, A = 10, B = 10
 *
 * Dua puluh keluar dari sepuluh. Dan `tak_bisa_kirim` kosong, jadi tak seorang
 * pun diberi tahu: kekurangannya baru terlihat saat saldo CK sudah minus, dan
 * faktur beli yang seharusnya terbit untuk menutup kekurangan itu tak pernah
 * dibuat.
 *
 * Maka pemeriksaannya dipindah KE DALAM transaksi, di belakang kunci kirim
 * (ledger tak punya baris yang bisa dikunci), dan yang dibandingkan adalah
 * saldo DIKURANGI barang yang masih di jalan. Idiomnya sama persis dengan
 * jalur bahan baku di `produksi/routes.ts`.
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
  const ckId = cab.ckId;
  return db.transaction(async (tx) => {
    await kunciKirimCabang(tx, params.companyId, ckId, "kirim-perlengkapan");
    const saldoCk = await saldoSatuPerlengkapan(params.supplyId, ckId, tx);
    const dalamJalan =
      (await qtyPerlengkapanDalamJalan(tx, params.companyId, ckId, [params.supplyId])).get(
        params.supplyId,
      ) ?? 0;
    // Kembaran saldo rak: dua SUM float8 dikurangkan di JS (lihat
    // `keSkalaKolom`) — tanpa ini "minta sebesar sisa yang siap kirim"
    // ditolak dengan angka 0.19999999999999998 di pesannya.
    const siapKirim = keSkalaKolom(saldoCk - dalamJalan, SKALA_QTY_PERLENGKAPAN);
    if (params.qty > siapKirim) {
      return {
        error:
          dalamJalan > 0
            ? `Stok CK tidak cukup (siap kirim ${siapKirim} dari saldo ${saldoCk}; ${dalamJalan} sudah dikirim & menunggu diterima) — beli dulu di CK`
            : `Stok CK tidak cukup (saldo CK ${saldoCk}) — beli dulu di CK`,
      };
    }
    const [row] = await tx
      .insert(supplyTransfers)
      .values({
        companyId: params.companyId,
        dariBranchId: ckId,
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
 * Buat FAKTUR BELI perlengkapan ke CK (status 'menunggu') — SATU faktur bisa
 * memuat banyak item (seperti faktur beli bahan baku): semua baris berbagi
 * `faktur_id` dan SATU nomor BP- (dokumen ref = faktur_id). Barang belum tiba;
 * setelah dibeli & tiba dipanggil {@link tibaFakturBeliPerlengkapan} → masuk
 * stok CK + otomatis kirim ke cabang tujuan (bila diisi).
 */
export async function buatBeliPerlengkapan(params: {
  companyId: string;
  ckBranchId: string;
  items: { supplyId: string; qty: number; totalHarga?: number | null }[];
  userId: string;
  tujuanBranchId?: string | null;
  /** tautan ke rencana Tambah Stok dari Menu (tampil di Data Permintaan Stok) */
  rencanaId?: string | null;
  catatan?: string | null;
}): Promise<{ faktur_id: string; nomor: string; ids: string[] }> {
  return db.transaction(async (tx) => {
    const fakturId = randomUUID();
    const rows = await tx
      .insert(supplyPurchases)
      .values(
        params.items.map((it) => ({
          companyId: params.companyId,
          ckBranchId: params.ckBranchId,
          supplyId: it.supplyId,
          qty: it.qty,
          tujuanBranchId: params.tujuanBranchId ?? null,
          totalHarga: it.totalHarga ?? null,
          fakturId,
          rencanaId: params.rencanaId ?? null,
          catatan: params.catatan ?? null,
          userId: params.userId,
        })),
      )
      .returning({ id: supplyPurchases.id });
    const nomor = await terbitkanNomor(tx, params.companyId, "beli_perlengkapan", fakturId);
    return { faktur_id: fakturId, nomor, ids: rows.map((r) => r.id) };
  });
}

/**
 * Buat faktur beli perlengkapan MANUAL (dari halaman Beli Perlengkapan) — satu
 * faktur bisa banyak item. CK ditentukan eksplisit atau otomatis bila
 * perusahaan hanya punya satu; cabang tujuan (opsional) harus store — dikirim
 * otomatis setelah tiba.
 */
export async function buatBeliPerlengkapanManual(params: {
  companyId: string;
  userId: string;
  items: { supplyId: string; qty: number; totalHarga?: number | null }[];
  ckBranchId?: string | null;
  tujuanBranchId?: string | null;
  catatan?: string | null;
}): Promise<
  { faktur_id: string; nomor: string; ids: string[] } | { error: string; code?: number }
> {
  const supplyIds = [...new Set(params.items.map((it) => it.supplyId))];
  const supRows = await db
    .select({ id: supplies.id })
    .from(supplies)
    .where(
      and(
        inArray(supplies.id, supplyIds),
        eq(supplies.companyId, params.companyId),
        eq(supplies.isActive, true),
      ),
    );
  if (supRows.length !== supplyIds.length) {
    return { error: "Perlengkapan tidak ditemukan", code: 404 };
  }

  // tentukan CK tujuan beli
  let ckId = params.ckBranchId ?? null;
  if (ckId) {
    const [ck] = await db
      .select({ id: branches.id })
      .from(branches)
      .where(
        and(
          eq(branches.id, ckId),
          eq(branches.companyId, params.companyId),
          eq(branches.tipe, "central_kitchen"),
        ),
      );
    if (!ck) return { error: "Central Kitchen tidak valid", code: 400 };
  } else {
    const cks = await db
      .select({ id: branches.id })
      .from(branches)
      .where(
        and(
          eq(branches.companyId, params.companyId),
          eq(branches.tipe, "central_kitchen"),
          eq(branches.isActive, true),
        ),
      );
    if (cks.length === 0) return { error: "Belum ada Central Kitchen", code: 400 };
    if (cks.length > 1) return { error: "Pilih Central Kitchen tujuan beli", code: 400 };
    ckId = cks[0].id;
  }

  // cabang tujuan (opsional) wajib store
  if (params.tujuanBranchId) {
    const [st] = await db
      .select({ id: branches.id })
      .from(branches)
      .where(
        and(
          eq(branches.id, params.tujuanBranchId),
          eq(branches.companyId, params.companyId),
          eq(branches.tipe, "store"),
        ),
      );
    if (!st) return { error: "Cabang tujuan tidak valid (harus store)", code: 400 };
  }

  return buatBeliPerlengkapan({
    companyId: params.companyId,
    ckBranchId: ckId,
    items: params.items,
    userId: params.userId,
    tujuanBranchId: params.tujuanBranchId ?? null,
    catatan: params.catatan ?? null,
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
  /** tautan ke rencana Tambah Stok dari Menu — faktur BP tampil di Data Permintaan Stok */
  rencanaId?: string | null;
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
  // Barang CK yang sudah berangkat ke cabang mana pun & belum diterima. Diambil
  // sekali di luar loop: satu kueri untuk seluruh item, bukan satu per item.
  const dalamJalan = cab.ckId
    ? await qtyPerlengkapanDalamJalan(db, params.companyId, cab.ckId)
    : new Map<string, number>();
  const dibuat: PermintaanPerlengkapanOtomatisHasil["dibuat"] = [];
  const beliDibuat: PermintaanPerlengkapanOtomatisHasil["beli_dibuat"] = [];
  const takBisa: PermintaanPerlengkapanOtomatisHasil["tak_bisa_kirim"] = [];
  // item beli dikumpulkan dulu → SATU faktur BP untuk seluruh permintaan
  const beliItems: { supplyId: string; nama: string; satuan: string; qty: number }[] = [];
  for (const r of rows) {
    // Rumahnya di @kakarut/shared — layar memakai fungsi yang SAMA. Dulu
    // aturannya tersalin dan epsilonnya hanya ada di sini, sehingga permintaan
    // otomatis meminta 1 sementara dialog manual mengisi 2 untuk item yang sama.
    const kekurangan = kekuranganKeMinimum(r);
    if (kekurangan <= 0) continue;
    // cabang tak terhubung CK → tak bisa minta; catat sebagai info
    if (!cab.ckId) {
      takBisa.push({ supply_id: r.id, nama: r.nama, satuan: r.satuan, qty: kekurangan });
      continue;
    }
    /*
     * Yang bisa dikirim adalah saldo CK DIKURANGI yang sudah berangkat ke
     * cabang lain dan belum ditekan Terima — ledger perlengkapan baru bergerak
     * saat diterima, jadi `saldo_ck` apa adanya masih memuat barang di jalan.
     * Tanpa pengurangan ini, cabang kedua yang meminta hal yang sama dijanjikan
     * stok yang sudah menjadi milik cabang pertama.
     */
    const dalamJalanCk = dalamJalan.get(r.id) ?? 0;
    const ckSaldo = Math.max(0, Math.floor((r.saldo_ck ?? 0) - dalamJalanCk + 1e-9));
    let kirim = Math.min(kekurangan, ckSaldo);
    if (kirim > 0) {
      const hasil = await buatKirimanPerlengkapan({
        companyId: params.companyId,
        cabangId: params.cabangId,
        supplyId: r.id,
        qty: kirim,
        userId: params.userId,
        catatan: "Permintaan otomatis (stok ≤ minimum)",
      });
      if ("error" in hasil) {
        /*
         * Penolakan TIDAK BOLEH ditelan diam-diam. Sebelumnya cabang yang
         * ditolak di sini tak dapat kiriman, tak dapat faktur beli, dan tak
         * muncul di `tak_bisa_kirim` — permintaannya lenyap tanpa satu pun
         * jejak di layar. `kirim` dinolkan supaya SELURUH kekurangannya jatuh
         * ke faktur beli di bawah, jalan yang memang disediakan untuk stok CK
         * yang kurang.
         */
        kirim = 0;
      } else {
        dibuat.push({
          supply_id: r.id,
          nama: r.nama,
          satuan: r.satuan,
          qty: kirim,
          nomor: hasil.nomor,
        });
      }
    }
    // sisa yang tak tertutup stok CK → item faktur beli ke CK (dibeli lalu dikirim)
    const sisa = kekurangan - kirim;
    if (sisa > 0) {
      beliItems.push({ supplyId: r.id, nama: r.nama, satuan: r.satuan, qty: sisa });
    }
  }
  // seluruh item kurang jadi SATU faktur BP- (seperti faktur beli bahan baku);
  // item hanya masuk daftar bila cab.ckId ada (guard di loop), jadi aman.
  let beliFaktur: PermintaanPerlengkapanOtomatisHasil["beli_faktur"] = null;
  if (beliItems.length > 0) {
    const beli = await buatBeliPerlengkapan({
      companyId: params.companyId,
      ckBranchId: cab.ckId!,
      items: beliItems.map((it) => ({ supplyId: it.supplyId, qty: it.qty })),
      userId: params.userId,
      tujuanBranchId: params.cabangId,
      rencanaId: params.rencanaId ?? null,
      catatan: `Permintaan ${cab.nama} (stok CK kurang)`,
    });
    beliFaktur = { faktur_id: beli.faktur_id, nomor: beli.nomor, jumlah_baris: beliItems.length };
    for (const it of beliItems) {
      beliDibuat.push({
        supply_id: it.supplyId,
        nama: it.nama,
        satuan: it.satuan,
        qty: it.qty,
        nomor: beli.nomor,
        tujuan_nama: cab.nama,
      });
    }
  }
  return { dibuat, beli_dibuat: beliDibuat, beli_faktur: beliFaktur, tak_bisa_kirim: takBisa };
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
  if (beli.status !== "menunggu" && beli.status !== "diproses") {
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
        .where(
          and(
            eq(supplyPurchases.id, params.id),
            inArray(supplyPurchases.status, ["menunggu", "diproses"]),
          ),
        )
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

/**
 * Barang SATU FAKTUR beli tiba di CK: proses semua baris 'menunggu' faktur itu
 * (qty/harga per baris bisa disesuaikan lewat `items`). Tiap baris atomik
 * (CAS per baris di {@link tibaBeliPerlengkapan}) — masuk stok CK (PL-) +
 * otomatis kirim (KP-) ke cabang tujuan masing-masing.
 */
export async function tibaFakturBeliPerlengkapan(params: {
  companyId: string;
  fakturId: string;
  userId: string;
  items?: { id: string; qty?: number; total_harga?: number | null }[];
}): Promise<
  | {
      faktur_id: string;
      jumlah_tiba: number;
      kiriman: { id: string; nomor: string }[];
    }
  | { error: string; code?: number }
> {
  const rows = await db
    .select({ id: supplyPurchases.id, status: supplyPurchases.status })
    .from(supplyPurchases)
    .where(
      and(
        eq(supplyPurchases.fakturId, params.fakturId),
        eq(supplyPurchases.companyId, params.companyId),
      ),
    );
  if (rows.length === 0) return { error: "Faktur beli tidak ditemukan", code: 404 };
  const menunggu = rows.filter((r) => r.status === "menunggu" || r.status === "diproses");
  if (menunggu.length === 0) {
    return { error: "Faktur ini sudah tiba atau dibatalkan", code: 400 };
  }
  const override = new Map((params.items ?? []).map((it) => [it.id, it]));
  const kiriman: { id: string; nomor: string }[] = [];
  let jumlahTiba = 0;
  for (const r of menunggu) {
    const o = override.get(r.id);
    const hasil = await tibaBeliPerlengkapan({
      companyId: params.companyId,
      id: r.id,
      userId: params.userId,
      qty: o?.qty,
      totalHarga: o?.total_harga ?? undefined,
    });
    if (!("error" in hasil)) {
      jumlahTiba += 1;
      if (hasil.kiriman) kiriman.push(hasil.kiriman);
    }
  }
  if (jumlahTiba === 0) return { error: "Tidak ada baris yang bisa diproses", code: 400 };
  return { faktur_id: params.fakturId, jumlah_tiba: jumlahTiba, kiriman };
}

/**
 * Tandai SATU FAKTUR beli 'diproses' (sedang dibelanjakan) — paritas tahap
 * "RAB → diproses" beli bahan baku; pemroses & waktunya tercatat.
 */
export async function prosesFakturBeliPerlengkapan(
  companyId: string,
  fakturId: string,
  userId: string,
): Promise<{ ok: true; jumlah: number } | { error: string; code?: number }> {
  const done = await db
    .update(supplyPurchases)
    .set({ status: "diproses", diprosesBy: userId, diprosesAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(supplyPurchases.fakturId, fakturId),
        eq(supplyPurchases.companyId, companyId),
        eq(supplyPurchases.status, "menunggu"),
      ),
    )
    .returning({ id: supplyPurchases.id });
  if (done.length === 0) {
    return { error: "Faktur tidak ditemukan / sudah diproses", code: 404 };
  }
  return { ok: true, jumlah: done.length };
}

/** Batalkan SEMUA baris 'menunggu'/'diproses' satu faktur beli perlengkapan. */
export async function batalFakturBeliPerlengkapan(
  companyId: string,
  fakturId: string,
): Promise<{ ok: true; jumlah: number } | { error: string; code?: number }> {
  const done = await db
    .update(supplyPurchases)
    .set({ status: "batal", updatedAt: new Date() })
    .where(
      and(
        eq(supplyPurchases.fakturId, fakturId),
        eq(supplyPurchases.companyId, companyId),
        inArray(supplyPurchases.status, ["menunggu", "diproses"]),
      ),
    )
    .returning({ id: supplyPurchases.id });
  if (done.length === 0) {
    return { error: "Faktur tidak ditemukan / sudah tiba", code: 404 };
  }
  return { ok: true, jumlah: done.length };
}

/**
 * Batalkan SEMUA baris beli yang masih 'menunggu' (bersih-bersih massal —
 * mis. faktur warisan yang permintaannya sudah dihapus sebelum ada tautan
 * rencana_id). Opsional dibatasi satu CK.
 */
export async function batalSemuaBeliPerlengkapan(
  companyId: string,
  ckBranchId?: string,
): Promise<{ ok: true; jumlah: number }> {
  const conds = [eq(supplyPurchases.companyId, companyId), eq(supplyPurchases.status, "menunggu")];
  if (ckBranchId) conds.push(eq(supplyPurchases.ckBranchId, ckBranchId));
  const done = await db
    .update(supplyPurchases)
    .set({ status: "batal", updatedAt: new Date() })
    .where(and(...conds))
    .returning({ id: supplyPurchases.id });
  return { ok: true, jumlah: done.length };
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
        inArray(supplyPurchases.status, ["menunggu", "diproses"]),
      ),
    )
    .returning({ id: supplyPurchases.id });
  if (done.length === 0) {
    return { error: "Faktur tidak ditemukan / sudah tiba", code: 404 };
  }
  return { ok: true };
}

/** Daftar faktur beli perlengkapan (menunggu dulu, lalu terbaru). Opsional CK. */
/**
 * Kunci sebuah FAKTUR beli perlengkapan.
 *
 * `faktur_id` bila ada; kalau tidak, id barisnya sendiri — baris warisan dari
 * sebelum faktur multi-item ada diperlakukan sebagai faktur satu-item. Ditulis
 * sekali di sini supaya kueri agregat, kueri kunci halaman, dan kueri barisnya
 * tak pernah memakai definisi yang berbeda-beda.
 */
const kunciFaktur = sql<string>`coalesce(${supplyPurchases.fakturId}::text, ${supplyPurchases.id}::text)`;

export async function daftarBeliPerlengkapan(
  companyId: string,
  ckBranchId?: string,
  halaman?: { perPage: number; offset: number },
): Promise<{ rows: BeliPerlengkapanRow[]; total: number; ringkas: RingkasBeliPerlengkapan }> {
  const ckB = alias(branches, "ck_beli");
  const tujuanB = alias(branches, "tujuan_beli");
  const pemroses = alias(users, "pemroses_beli");
  // supplier LANGGANAN item (is_utama, maks satu — partial unique index)
  const ssUtama = alias(supplySuppliers, "ss_utama_beli");
  const supUtama = alias(suppliers, "sup_utama_beli");
  const conds = [eq(supplyPurchases.companyId, companyId)];
  if (ckBranchId) conds.push(eq(supplyPurchases.ckBranchId, ckBranchId));
  // Sembunyikan faktur yang PERMINTAANNYA sudah DIHAPUS (bukan sekadar
  // dibatalkan): saat permintaan dihapus, productions-nya di-soft-delete tapi
  // baris beli perlengkapan hanya di-set status 'batal' — dulu tetap muncul
  // sebagai "Dibatalkan" walau permintaannya lenyap (info tak konsisten).
  // Kriteria "permintaan dihapus": rencana_id-nya hanya punya production yang
  // sudah soft-delete (tak ada yang live). Baris yang SUDAH 'tiba' (stok nyata
  // masuk) tetap ditampilkan; "Dibatalkan" dengan permintaan masih hidup pun
  // tetap tampil (pembatalan sah).
  conds.push(
    sql`NOT (
      ${supplyPurchases.status} <> 'tiba'
      AND ${supplyPurchases.rencanaId} IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM ${productions} p
        WHERE p.rencana_id = ${supplyPurchases.rencanaId}
          AND p.company_id = ${companyId} AND p.deleted_at IS NOT NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM ${productions} p
        WHERE p.rencana_id = ${supplyPurchases.rencanaId}
          AND p.company_id = ${companyId} AND p.deleted_at IS NULL
      )
    )`,
  );
  /*
   * AGREGAT PER FAKTUR — satu definisi yang memberi makan TIGA hal: hitungan
   * `ringkas`, `total`, dan kunci halaman. Ketiganya karena itu tak mungkin
   * bicara soal populasi yang berbeda; kalau salah satu bocor, ketiganya
   * bocor bersama dan itu terlihat.
   *
   * `MAX(created_at)`, BUKAN MIN. Faktur diurut "yang terbaru dulu" di antara
   * yang setahap, dan tahapnya berpindah dengan menulis ulang barisnya — jadi
   * yang menentukan posisi adalah sentuhan TERAKHIR. Pada fikstur segar
   * MIN==MAX (satu submit = satu `now()`), jadi salahnya lolos uji dan baru
   * muncul di data hidup.
   */
  const perFaktur = db
    .select({
      kunci: kunciFaktur.as("kunci_faktur"),
      adaTunggu: sql<boolean>`bool_or(${supplyPurchases.status} = 'menunggu')`.as("ada_tunggu"),
      adaProses: sql<boolean>`bool_or(${supplyPurchases.status} = 'diproses')`.as("ada_proses"),
      adaTiba: sql<boolean>`bool_or(${supplyPurchases.status} = 'tiba')`.as("ada_tiba"),
      adaHidup: sql<boolean>`bool_or(${supplyPurchases.status} <> 'batal')`.as("ada_hidup"),
      waktu: sql<Date>`max(${supplyPurchases.createdAt})`.as("waktu_faktur"),
    })
    .from(supplyPurchases)
    .where(and(...conds))
    .groupBy(kunciFaktur)
    .as("per_faktur");

  /*
   * KETIGA EMBER, dirakit dari aturan yang sama dengan `emberFakturBP` di
   * `@kakarut/shared` — dan saling lepas menurut konstruksi, jadi jumlahnya
   * WAJIB tepat `total`. Itu invarian yang dipakai verify-api §294.
   *
   * `NOT ada_hidup` lebih dulu: faktur yang SELURUH barisnya batal tak boleh
   * ikut dihitung "tiba" hanya karena `ada_tiba` kebetulan false.
   */
  const batalSql = sql<boolean>`NOT ${perFaktur.adaHidup}`;
  const tibaSql = sql<boolean>`(${perFaktur.adaHidup} AND ${perFaktur.adaTiba}
    AND NOT ${perFaktur.adaTunggu} AND NOT ${perFaktur.adaProses})`;
  const butuhAksiSql = sql<boolean>`(${perFaktur.adaHidup}
    AND (${perFaktur.adaTunggu} OR ${perFaktur.adaProses}))`;

  const [hitung] = await db
    .select({
      total: sql<number>`count(*)::int`,
      butuhAksi: sql<number>`count(*) filter (where ${butuhAksiSql})::int`,
      tiba: sql<number>`count(*) filter (where ${tibaSql})::int`,
      batal: sql<number>`count(*) filter (where ${batalSql})::int`,
    })
    .from(perFaktur);
  const total = hitung?.total ?? 0;
  const ringkas: RingkasBeliPerlengkapan = {
    butuh_aksi: hitung?.butuhAksi ?? 0,
    tiba: hitung?.tiba ?? 0,
    batal: hitung?.batal ?? 0,
  };

  /*
   * KUNCI HALAMAN — faktur, bukan baris. Mengiris per baris mengirim faktur
   * yang terpotong di tengah: kartu berisi separuh itemnya, tanpa penanda.
   *
   * PEMUTUS SERI `asc(kunci)` wajib. Kedua kunci urut di atasnya adalah
   * agregat, dan dua faktur berwaktu sama tak punya urutan sama sekali —
   * waktu yang sama pun bukan kebetulan langka (`now()` stabil per transaksi;
   * satu permintaan cabang melahirkan beberapa faktur sekaligus). Dipadu
   * OFFSET, akibatnya bukan tampilan yang goyah melainkan faktur yang tak
   * muncul di halaman MANA PUN. `GET /produksi` sudah membayar bug ini.
   */
  const kunciHalaman = (
    await db
      .select({ kunci: perFaktur.kunci })
      .from(perFaktur)
      .orderBy(desc(butuhAksiSql), desc(perFaktur.waktu), asc(perFaktur.kunci))
      .limit(halaman?.perPage ?? BATAS_BELI_PERLENGKAPAN)
      .offset(halaman?.offset ?? 0)
  ).map((r) => r.kunci);
  if (kunciHalaman.length === 0) return { rows: [], total, ringkas };

  const rows = await db
    .select({
      id: supplyPurchases.id,
      fakturId: supplyPurchases.fakturId,
      supplyId: supplyPurchases.supplyId,
      nama: supplies.nama,
      satuan: supplies.satuan,
      hargaBeli: supplies.hargaBeli,
      qty: supplyPurchases.qty,
      totalHarga: supplyPurchases.totalHarga,
      status: supplyPurchases.status,
      ckNama: ckB.nama,
      tujuanNama: tujuanB.nama,
      catatan: supplyPurchases.catatan,
      waktu: supplyPurchases.createdAt,
      oleh: users.nama,
      diprosesOleh: pemroses.nama,
      supplierUtama: supUtama.nama,
      // terkait permintaan MASIH AKTIF: rencana_id punya produksi yg belum
      // di-soft-delete → tak boleh Hapus permanen dari sini (kelola dari
      // Permintaan Stok). manual / permintaan sudah tak ada → boleh Hapus.
      permintaanAktif: sql<boolean>`(
        ${supplyPurchases.rencanaId} IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM ${productions} p
          WHERE p.rencana_id = ${supplyPurchases.rencanaId}
            AND p.company_id = ${companyId} AND p.deleted_at IS NULL
        )
      )`,
    })
    .from(supplyPurchases)
    .innerJoin(supplies, eq(supplyPurchases.supplyId, supplies.id))
    .innerJoin(ckB, eq(supplyPurchases.ckBranchId, ckB.id))
    .leftJoin(tujuanB, eq(supplyPurchases.tujuanBranchId, tujuanB.id))
    .leftJoin(users, eq(supplyPurchases.userId, users.id))
    .leftJoin(pemroses, eq(supplyPurchases.diprosesBy, pemroses.id))
    .leftJoin(
      ssUtama,
      and(eq(ssUtama.supplyId, supplyPurchases.supplyId), eq(ssUtama.isUtama, true)),
    )
    .leftJoin(supUtama, eq(ssUtama.supplierId, supUtama.id))
    /*
     * Terkurung ke kunci halaman — jadi kueri ini TAK LAGI menyapu seluruh
     * populasi. Batas 200 barisnya hilang bersama sebabnya: yang membatasi
     * kini `per_page` dalam satuan FAKTUR, dan tiap faktur pada halaman itu
     * dikirim UTUH.
     */
    .where(and(...conds, inArray(kunciFaktur, kunciHalaman)))
    // Urutan BARIS di dalam satu faktur; urutan FAKTUR-nya ditentukan
    // penyusunan ulang di bawah, mengikuti `kunciHalaman`.
    .orderBy(desc(supplyPurchases.createdAt), desc(supplyPurchases.id));
  // nomor BP-: ref = faktur_id (baris warisan tanpa faktur → ref = id baris)
  const nomorMap = await nomorUntukRefs(
    db,
    companyId,
    [...new Set(rows.map((r) => r.fakturId ?? r.id))],
  );
  const dto = rows.map((r) => ({
    id: r.id,
    faktur_id: r.fakturId,
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
    nomor: nomorMap.get(r.fakturId ?? r.id) ?? null,
    diproses_oleh: r.diprosesOleh,
    supplier_utama: r.supplierUtama,
    harga_beli: r.hargaBeli,
    permintaan_aktif: r.permintaanAktif,
  }));
  /*
   * DISUSUN ULANG MENGIKUTI `kunciHalaman`, bukan dipulangkan apa adanya.
   *
   * Kueri baris di atas diurut `desc(createdAt)` — itu BUKAN urutan "yang
   * butuh aksi dulu" yang dipakai mengiris halamannya. Memulangkan urutan
   * kuerinya memberi HIMPUNAN YANG BENAR DENGAN URUTAN YANG SALAH: tanpa
   * typecheck, tanpa galat, dan tak seorang pun bisa membedakannya dari
   * "memang begitu datanya". Kedua klien mengelompokkan baris mengikuti
   * urutan kemunculan, jadi urutan larik ini adalah urutan kartu di layar.
   */
  const perKunci = new Map<string, BeliPerlengkapanRow[]>();
  for (const r of dto) {
    const k = r.faktur_id ?? r.id;
    const list = perKunci.get(k) ?? [];
    list.push(r);
    perKunci.set(k, list);
  }
  return {
    rows: kunciHalaman.flatMap((k) => perKunci.get(k) ?? []),
    total,
    ringkas,
  };
}

/**
 * HAPUS PERMANEN faktur/baris beli perlengkapan (bersih-bersih data lama).
 * HANYA boleh bila: TIDAK ada baris 'tiba' (tak pernah masuk stok) DAN tidak
 * terkait permintaan yang masih AKTIF (rencana_id-nya punya produksi yang belum
 * di-soft-delete) — faktur dari permintaan aktif dikelola dari Permintaan Stok.
 */
async function hapusBeliInternal(
  companyId: string,
  match: SQL,
): Promise<{ ok: true; jumlah: number } | { error: string; code?: number }> {
  const rows = await db
    .select({
      id: supplyPurchases.id,
      status: supplyPurchases.status,
      rencanaId: supplyPurchases.rencanaId,
    })
    .from(supplyPurchases)
    .where(and(eq(supplyPurchases.companyId, companyId), match));
  if (rows.length === 0) return { error: "Faktur tidak ditemukan", code: 404 };
  if (rows.some((r) => r.status === "tiba")) {
    return { error: "Faktur yang sudah tiba (masuk stok) tak bisa dihapus", code: 400 };
  }
  const rencanaIds = [...new Set(rows.map((r) => r.rencanaId).filter((x): x is string => !!x))];
  if (rencanaIds.length > 0) {
    const [aktif] = await db
      .select({ id: productions.id })
      .from(productions)
      .where(
        and(
          eq(productions.companyId, companyId),
          inArray(productions.rencanaId, rencanaIds),
          isNull(productions.deletedAt),
        ),
      )
      .limit(1);
    if (aktif) {
      return {
        error: "Faktur dari permintaan aktif — kelola/hapus dari Permintaan Stok",
        code: 400,
      };
    }
  }
  const done = await db
    .delete(supplyPurchases)
    .where(and(eq(supplyPurchases.companyId, companyId), match))
    .returning({ id: supplyPurchases.id });
  return { ok: true, jumlah: done.length };
}

export function hapusFakturBeliPerlengkapan(companyId: string, fakturId: string) {
  return hapusBeliInternal(companyId, eq(supplyPurchases.fakturId, fakturId));
}

export function hapusBeliPerlengkapan(companyId: string, id: string) {
  return hapusBeliInternal(companyId, eq(supplyPurchases.id, id));
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
    /*
     * SATU baris lebih. Cabang PENERIMA memakai layar ini untuk memastikan
     * kirimannya sudah tercatat; potongan yang senyap di sini terbaca sebagai
     * "tak pernah dikirim".
     */
    .orderBy(desc(supplyTransfers.waktu), desc(supplyTransfers.id))
    .limit(BATAS_KIRIMAN_PERLENGKAPAN + 1);
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
  /*
   * PENERIMAAN DIKLAIM LEWAT UPDATE BERSYARAT, BUKAN LEWAT PEMERIKSAAN DI ATAS.
   *
   * Penjaga `t.status !== "dikirim"` di atas hanya menangkap percobaan
   * BERURUTAN. Dua orang menekan "Terima" pada kiriman yang sama di saat
   * bersamaan sama-sama membaca status `dikirim` — READ COMMITTED tak
   * memperlihatkan tulisan yang belum di-commit — lalu keduanya menulis
   * SEPASANG MUTASI STOK. Stoknya dikreditkan DUA KALI di cabang tujuan dan
   * didebit dua kali di cabang asal, permanen, tanpa jejak apa pun: dua baris
   * mutasi kembar ber-nomor kiriman yang sama.
   *
   * Tak ada pengaman lain yang menahannya: indeks unik `supply_mutations_auto_uq`
   * PARSIAL (`WHERE tipe = 'auto'`), sedangkan baris ini ber-tipe `kirim`/
   * `terima`; dan mutasinya lahir ber-`status` bawaan `disetujui`, jadi
   * langsung terhitung di seluruh pembaca saldo.
   *
   * Maka status dibalik lewat `UPDATE … WHERE status = 'dikirim'` yang
   * mengembalikan barisnya — idiom yang sama dengan tahap produksi/beli. Yang
   * menang menulis mutasinya; yang kalah tak menulis apa pun dan dibalas sama
   * seperti percobaan berurutan, jadi klien tak melihat perilaku baru.
   */
  let kalahBalapan = false;
  await db.transaction(async (tx) => {
    const klaim = await tx
      .update(supplyTransfers)
      .set({ status: "diterima", diterimaBy: params.userId, diterimaAt: new Date() })
      .where(and(eq(supplyTransfers.id, t.id), eq(supplyTransfers.status, "dikirim")))
      .returning({ id: supplyTransfers.id });
    if (klaim.length === 0) {
      kalahBalapan = true;
      return;
    }
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
  if (kalahBalapan) return { error: "Kiriman sudah diterima", code: 400 };
  return { ok: true, saldo: await saldoSatuPerlengkapan(t.supplyId, params.branchId) };
}

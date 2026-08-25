import type { FifoAmbil, FifoLot, FifoPemakaian } from "@kakarut/shared";
import { keSkalaKolom, toleransiBanding, SKALA_QTY_STOK_KOLOM } from "./batas-angka";

/** Barang masuk stok → jadi satu lot baru. */
export interface FifoEventMasuk {
  ev: "masuk";
  waktu: string;
  jenis: "beli" | "produksi" | "transfer";
  nomor: string | null;
  supplier: string | null;
  qty: number;
  /** harga per satuan kerja dari faktur; null = tak diketahui */
  hargaSatuan: number | null;
  expDate: string | null;
}

/** Barang keluar stok → dikonsumsi dari lot PALING AWAL yang masih bersisa. */
export interface FifoEventKeluar {
  ev: "keluar";
  waktu: string;
  jenis: "penjualan" | "pemakaian" | "kirim";
  keterangan: string | null;
  qty: number;
}

/** Opname disetujui: saldo DI-RESET ke qty hitung fisik (semantik ledger). */
export interface FifoEventOpname {
  ev: "opname";
  waktu: string;
  /** hasil hitung fisik — saldo setelah peristiwa ini */
  qty: number;
  keterangan: string | null;
}

export type FifoEvent = FifoEventMasuk | FifoEventKeluar | FifoEventOpname;

/**
 * PEMBANDING NOL YANG IKUT BESARAN — bukan konstanta firasat.
 *
 * Berkas ini dulu memakai `EPS = 1e-9` telanjang, tanpa satu kalimat tentang
 * asalnya. Vena B⁷ sudah mengukur bahwa angka itu BERHENTI BERARTI begitu
 * besarannya ≥ 10⁷: ULP double di sana 1,86e-9 — lebih besar dari EPS-nya
 * sendiri. Dan `BATAS_QTY_STOK` = 9.999.999.999, jadi besaran itu ada DI DALAM
 * rentang yang skema izinkan.
 *
 * Terukur atas `jalankanFifo` (dua lot pecahan sebesar N, lalu keluar
 * SELURUHNYA):
 *
 *   N=10³ · 10⁶  sisa 0 · saldo 0 · defisit 0 · hpp terisi   ← sehat
 *   N=10⁷        sisa lot 1,86e-9 · saldo 1,86e-9            ← lot hantu
 *   N=10⁸        saldo −1,49e-8 · defisit 1,49e-8 · hpp NULL ← stok minus palsu
 *   N=10⁹        saldo −1,19e-7 · defisit 1,19e-7 · hpp NULL
 *
 * Dua baris terakhir kelas yang sama dengan temuan B⁷ ("stok yang PERSIS cukup
 * ditolak"), dipindahkan ke jalur BIAYA: kartu FIFO melaporkan stok minus dan
 * menolak menyebut HPP untuk pemakaian yang aritmetikanya eksak.
 *
 * Lantai deraunya ditentukan oleh angka TERBESAR yang dilewati walk ini, bukan
 * oleh sisa yang sedang diperiksa — sisa itu sendiri kecil, sementara derau
 * yang melahirkannya berasal dari besaran operannya. `toleransiBanding` sudah
 * merumuskan keduanya: max(½ unit skala kolom, lantai derau float pada besaran
 * itu).
 *
 * BATASNYA, ditulis jujur: pada besaran ≳10¹⁰ lantai deraunya (2,3e-6) melewati
 * satu unit kolom (1e-6), jadi sisa sebesar satu unit di sana ikut dianggap
 * nol. Di besaran itu float8 memang tak lagi sanggup membawa skala kolomnya —
 * jawabannya berhenti memakai float8, bukan mengecilkan toleransi.
 */
const bulat2 = (n: number) => Math.round(n * 100) / 100;

/** Metode pembebanan biaya pemakaian (setelan `companies.metode_hpp`). */
export type MetodeHpp = "average" | "fifo";

/**
 * Jalankan walk persediaan atas deretan peristiwa stok TERURUT waktu
 * (paling awal dulu):
 * - masuk  → lot baru (harga per satuan menempel di lot);
 * - keluar → konsumsi lot paling awal yang bersisa; kelebihan saat semua lot
 *   habis dicatat sebagai DEFISIT (stok minus) dan otomatis tertutup oleh lot
 *   masuk berikutnya (pemakaian mendahului barangnya);
 * - opname → saldo DI-RESET ke hasil hitung fisik, konsisten dgn
 *   hitungSaldoCabang: selisih turun dikonsumsi FIFO (tercatat sebagai
 *   pemakaian jenis "opname"), selisih naik jadi lot baru berharga acuan.
 *
 * ALIRAN FISIK SELALU FIFO — lot tertua yang dikuras, apa pun metodenya.
 * Itu yang membuat `sisa`/`terpakai` per lot dan pelacakan kedaluwarsa tetap
 * benar. Yang mengikuti `metode` hanyalah cara membebankan BIAYA:
 * - `fifo`    → biaya = harga lot yang keluar (biaya menempel pada barangnya);
 * - `average` → biaya = qty × rata-rata bergerak seluruh sisa stok sesaat
 *   sebelum keluar. Rata-rata dianggap TIDAK DIKETAHUI (null) bila ada sisa
 *   lot yang harganya tak diketahui — aturan "tidak tahu" yang sama dengan
 *   FIFO, karena satu lot tanpa harga membuat rata-ratanya bias diam-diam.
 *
 * Invarian akhir: `saldo = Σ sisa lot − defisit` — sama dengan saldo ledger
 * karena sumber peristiwanya identik dengan komponen hitungSaldoCabang, dan
 * tidak terpengaruh pilihan metode.
 */
export function jalankanFifo(
  events: FifoEvent[],
  /** harga acuan master per satuan — dipakai lot penyesuaian opname naik */
  hargaAcuan: number | null,
  metode: MetodeHpp = "fifo",
): { lots: FifoLot[]; pemakaian: FifoPemakaian[]; saldo: number; defisit: number } {
  const lots: FifoLot[] = [];
  /**
   * Besaran terbesar yang dilewati walk ini — penentu lantai derau float-nya.
   * Dimulai dari 1 supaya walk kecil tetap memakai ½ unit skala kolom.
   */
  let besaranMaks = 1;
  const EPS = () => toleransiBanding(besaranMaks, SKALA_QTY_STOK_KOLOM);
  /** Angka yang dipulangkan dikembalikan ke presisi kolomnya (numeric(16,6)). */
  const skala = (n: number) => keSkalaKolom(n, SKALA_QTY_STOK_KOLOM);
  const pemakaian: FifoPemakaian[] = [];
  let defisit = 0;
  // penunjuk lot tertua yang masih bersisa — konsumsi maju, tak pernah mundur
  let tertua = 0;

  const sisaTotal = () => lots.reduce((t, l) => t + l.sisa, 0);

  /**
   * Rata-rata bergerak sisa stok saat ini; null bila stok kosong atau ada sisa
   * lot tanpa harga. Dipanggil SEBELUM konsumsi — begitu lot terkuras,
   * komposisi sisanya berubah dan angkanya tak lagi menggambarkan biaya yang
   * seharusnya dibebankan.
   */
  const rataBergerak = (): number | null => {
    let qty = 0;
    let nilai = 0;
    for (let i = tertua; i < lots.length; i += 1) {
      const lot = lots[i];
      if (lot.sisa <= EPS()) continue;
      if (lot.harga_satuan == null) return null;
      qty += lot.sisa;
      nilai += lot.sisa * lot.harga_satuan;
    }
    return qty > EPS() ? bulat2(nilai / qty) : null;
  };

  /**
   * Konsumsi `qty` dari lot paling awal (fisik). Kembalikan rincian lot,
   * biaya menurut `metode`, dan rata-rata yang dipakai bila mode average.
   */
  const konsumsi = (
    qty: number,
  ): { rincian: FifoAmbil[]; hpp: number | null; hargaRata: number | null } => {
    const rincian: FifoAmbil[] = [];
    // dihitung sebelum lot dikuras — lihat catatan di rataBergerak()
    const hargaRata = metode === "average" ? rataBergerak() : null;
    let sisaAmbil = qty;
    let hpp: number | null = 0;
    while (sisaAmbil > EPS() && tertua < lots.length) {
      const lot = lots[tertua];
      if (lot.sisa <= EPS()) {
        tertua += 1;
        continue;
      }
      const ambil = Math.min(sisaAmbil, lot.sisa);
      // Tiap langkah dikembalikan ke presisi kolom: tanpa itu sisa yang NYATA
      // pun keluar sebagai 9.999999992515995e-7 alih-alih 0,000001.
      lot.sisa = skala(lot.sisa - ambil);
      lot.terpakai = skala(lot.terpakai + ambil);
      rincian.push({ lot: tertua, qty: skala(ambil), harga_satuan: lot.harga_satuan });
      if (hpp != null) hpp = lot.harga_satuan != null ? hpp + ambil * lot.harga_satuan : null;
      sisaAmbil = skala(sisaAmbil - ambil);
      if (lot.sisa <= EPS()) {
        lot.sisa = 0;
        tertua += 1;
      }
    }
    if (sisaAmbil > EPS()) {
      // stok minus: keluar tanpa lot tersedia — tunggu lot masuk berikutnya
      defisit = skala(defisit + sisaAmbil);
      rincian.push({ lot: null, qty: skala(sisaAmbil), harga_satuan: null });
      hpp = null;
    }
    if (metode === "average") {
      // stok minus tetap "tidak diketahui": sebagian qty tak punya barang yang
      // menanggungnya, jadi rata-rata pun tak boleh dipakai membebankan biaya.
      const biaya = hargaRata != null && sisaAmbil <= EPS() ? bulat2(qty * hargaRata) : null;
      return { rincian, hpp: biaya, hargaRata };
    }
    return { rincian, hpp: hpp != null ? bulat2(hpp) : null, hargaRata: null };
  };

  /** Lot baru masuk; defisit lama (stok minus) langsung tertutup lot ini. */
  const masukLot = (lot: FifoLot) => {
    if (defisit > EPS()) {
      const bayar = Math.min(defisit, lot.qty_masuk);
      lot.terpakai = skala(lot.terpakai + bayar);
      lot.sisa = skala(lot.sisa - bayar);
      defisit = skala(defisit - bayar);
      if (defisit <= EPS()) defisit = 0;
    }
    lots.push(lot);
  };

  for (const e of events) {
    // Lantai derau walk ini ditentukan angka TERBESAR yang dilewatinya.
    besaranMaks = Math.max(besaranMaks, Math.abs(e.qty));
    if (e.ev === "masuk") {
      masukLot({
        waktu: e.waktu,
        jenis: e.jenis,
        nomor: e.nomor,
        supplier: e.supplier,
        qty_masuk: e.qty,
        harga_satuan: e.hargaSatuan,
        harga_acuan: false,
        terpakai: 0,
        sisa: e.qty,
        exp_date: e.expDate,
      });
    } else if (e.ev === "keluar") {
      const { rincian, hpp, hargaRata } = konsumsi(e.qty);
      pemakaian.push({
        waktu: e.waktu,
        jenis: e.jenis,
        keterangan: e.keterangan,
        qty: e.qty,
        hpp,
        harga_rata: hargaRata,
        rincian,
      });
    } else {
      // OPNAME: reset ke hasil hitung fisik
      const saldoKini = sisaTotal() - defisit;
      const delta = e.qty - saldoKini;
      if (delta < -EPS()) {
        const { rincian, hpp, hargaRata } = konsumsi(-delta);
        pemakaian.push({
          waktu: e.waktu,
          jenis: "opname",
          keterangan: e.keterangan ?? "Penyesuaian stok fisik",
          qty: -delta,
          hpp,
          harga_rata: hargaRata,
          rincian,
        });
      } else if (delta > EPS()) {
        // selisih naik: tutup defisit dulu, sisanya jadi lot penyesuaian
        let tambah = delta;
        if (defisit > EPS()) {
          const bayar = Math.min(defisit, tambah);
          defisit = skala(defisit - bayar);
          tambah = skala(tambah - bayar);
          if (defisit <= EPS()) defisit = 0;
        }
        if (tambah > EPS()) {
          masukLot({
            waktu: e.waktu,
            jenis: "opname",
            nomor: null,
            supplier: null,
            qty_masuk: tambah,
            harga_satuan: hargaAcuan,
            harga_acuan: hargaAcuan != null,
            terpakai: 0,
            sisa: tambah,
            exp_date: null,
          });
        }
      }
    }
  }

  return { lots, pemakaian, saldo: skala(sisaTotal() - defisit), defisit: skala(defisit) };
}

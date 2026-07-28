import type { FifoAmbil, FifoLot, FifoPemakaian } from "@kakarut/shared";

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

const EPS = 1e-9;
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
      if (lot.sisa <= EPS) continue;
      if (lot.harga_satuan == null) return null;
      qty += lot.sisa;
      nilai += lot.sisa * lot.harga_satuan;
    }
    return qty > EPS ? bulat2(nilai / qty) : null;
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
    while (sisaAmbil > EPS && tertua < lots.length) {
      const lot = lots[tertua];
      if (lot.sisa <= EPS) {
        tertua += 1;
        continue;
      }
      const ambil = Math.min(sisaAmbil, lot.sisa);
      lot.sisa -= ambil;
      lot.terpakai += ambil;
      rincian.push({ lot: tertua, qty: ambil, harga_satuan: lot.harga_satuan });
      if (hpp != null) hpp = lot.harga_satuan != null ? hpp + ambil * lot.harga_satuan : null;
      sisaAmbil -= ambil;
      if (lot.sisa <= EPS) {
        lot.sisa = 0;
        tertua += 1;
      }
    }
    if (sisaAmbil > EPS) {
      // stok minus: keluar tanpa lot tersedia — tunggu lot masuk berikutnya
      defisit += sisaAmbil;
      rincian.push({ lot: null, qty: sisaAmbil, harga_satuan: null });
      hpp = null;
    }
    if (metode === "average") {
      // stok minus tetap "tidak diketahui": sebagian qty tak punya barang yang
      // menanggungnya, jadi rata-rata pun tak boleh dipakai membebankan biaya.
      const biaya = hargaRata != null && sisaAmbil <= EPS ? bulat2(qty * hargaRata) : null;
      return { rincian, hpp: biaya, hargaRata };
    }
    return { rincian, hpp: hpp != null ? bulat2(hpp) : null, hargaRata: null };
  };

  /** Lot baru masuk; defisit lama (stok minus) langsung tertutup lot ini. */
  const masukLot = (lot: FifoLot) => {
    if (defisit > EPS) {
      const bayar = Math.min(defisit, lot.qty_masuk);
      lot.terpakai += bayar;
      lot.sisa -= bayar;
      defisit -= bayar;
      if (defisit <= EPS) defisit = 0;
    }
    lots.push(lot);
  };

  for (const e of events) {
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
      if (delta < -EPS) {
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
      } else if (delta > EPS) {
        // selisih naik: tutup defisit dulu, sisanya jadi lot penyesuaian
        let tambah = delta;
        if (defisit > EPS) {
          const bayar = Math.min(defisit, tambah);
          defisit -= bayar;
          tambah -= bayar;
          if (defisit <= EPS) defisit = 0;
        }
        if (tambah > EPS) {
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

  return { lots, pemakaian, saldo: sisaTotal() - defisit, defisit };
}

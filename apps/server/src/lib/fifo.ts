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

/**
 * Jalankan FIFO atas deretan peristiwa stok TERURUT waktu (paling awal dulu):
 * - masuk  → lot baru (harga per satuan menempel di lot);
 * - keluar → konsumsi lot paling awal yang bersisa; kelebihan saat semua lot
 *   habis dicatat sebagai DEFISIT (stok minus) dan otomatis tertutup oleh lot
 *   masuk berikutnya (pemakaian mendahului barangnya);
 * - opname → saldo DI-RESET ke hasil hitung fisik, konsisten dgn
 *   hitungSaldoCabang: selisih turun dikonsumsi FIFO (tercatat sebagai
 *   pemakaian jenis "opname"), selisih naik jadi lot baru berharga acuan.
 *
 * Invarian akhir: `saldo = Σ sisa lot − defisit` — sama dengan saldo ledger
 * karena sumber peristiwanya identik dengan komponen hitungSaldoCabang.
 */
export function jalankanFifo(
  events: FifoEvent[],
  /** harga acuan master per satuan — dipakai lot penyesuaian opname naik */
  hargaAcuan: number | null,
): { lots: FifoLot[]; pemakaian: FifoPemakaian[]; saldo: number; defisit: number } {
  const lots: FifoLot[] = [];
  const pemakaian: FifoPemakaian[] = [];
  let defisit = 0;
  // penunjuk lot tertua yang masih bersisa — konsumsi maju, tak pernah mundur
  let tertua = 0;

  const sisaTotal = () => lots.reduce((t, l) => t + l.sisa, 0);

  /** Konsumsi `qty` dari lot paling awal; kembalikan rincian + hpp (null bila ada lot tanpa harga). */
  const konsumsi = (qty: number): { rincian: FifoAmbil[]; hpp: number | null } => {
    const rincian: FifoAmbil[] = [];
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
    return { rincian, hpp: hpp != null ? bulat2(hpp) : null };
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
      const { rincian, hpp } = konsumsi(e.qty);
      pemakaian.push({
        waktu: e.waktu,
        jenis: e.jenis,
        keterangan: e.keterangan,
        qty: e.qty,
        hpp,
        rincian,
      });
    } else {
      // OPNAME: reset ke hasil hitung fisik
      const saldoKini = sisaTotal() - defisit;
      const delta = e.qty - saldoKini;
      if (delta < -EPS) {
        const { rincian, hpp } = konsumsi(-delta);
        pemakaian.push({
          waktu: e.waktu,
          jenis: "opname",
          keterangan: e.keterangan ?? "Penyesuaian stok fisik",
          qty: -delta,
          hpp,
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

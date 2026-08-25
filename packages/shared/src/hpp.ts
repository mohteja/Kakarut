import { keSkalaKolom, SKALA_QTY_STOK_KOLOM } from "./skala";
import { STOK_MENIPIS_THRESHOLD, type StokStatus } from "./constants";

/**
 * Rumus inti HPP & harga — satu-satunya sumber kebenaran, dipakai oleh
 * server (katalog, penjualan, seed) dan web (preview form menu).
 * Mengikuti spec Basooopa persis.
 */

/** Satu komponen resep yang siap dihitung. */
export interface KomponenHpp {
  /** jumlah unit bahan per porsi (boleh pecahan) */
  qty: number;
  /** harga_beli / isi */
  hargaPerUnit: number;
  /** bahan kemasan take-away (tidak dihitung/dikonsumsi saat dine-in) */
  isPackaging: boolean;
  /** "complement saos & sambal" (dikali 0.5 saat dine-in) */
  isComplement: boolean;
}

export function hargaPerUnit(hargaBeli: number, isi: number): number {
  return isi > 0 ? hargaBeli / isi : 0;
}

/** Qty efektif satu komponen untuk 1 porsi, dengan aturan dine-in. */
export function qtyEfektif(
  k: { qty: number; isPackaging: boolean; isComplement: boolean },
  dineIn: boolean,
): number {
  if (!dineIn) return k.qty;
  if (k.isPackaging) return 0;
  if (k.isComplement) return k.qty * 0.5;
  return k.qty;
}

/** HPP menu = Σ(qty × harga per unit); dineIn menerapkan aturan pengecualian. */
export function hitungHpp(komponen: KomponenHpp[], dineIn = false): number {
  let total = 0;
  for (const k of komponen) {
    total += qtyEfektif(k, dineIn) * k.hargaPerUnit;
  }
  return total;
}

export function hargaSaran(hpp: number, mult: number): number {
  return hpp * mult;
}

export function hargaJualBulat(saran: number): number {
  return Math.round(saran / 1000) * 1000;
}

export function foodCostPersen(hpp: number, hargaJual: number): number {
  return hargaJual > 0 ? (hpp / hargaJual) * 100 : 0;
}

/**
 * Paket (kasus khusus Paket Yamin):
 * HPP = HPP(menu dasar) + biaya topping;
 * harga saran = HPP(dasar) × base_mult + biaya topping (topping tanpa markup).
 */
export function hitungHppPaket(hppDasar: number, biayaTopping: number): number {
  return hppDasar + biayaTopping;
}

export function hargaSaranPaket(
  hppDasar: number,
  baseMult: number,
  biayaTopping: number,
): number {
  return hppDasar * baseMult + biayaTopping;
}

/** Saldo stok = stok awal (opname) + produksi − terpakai. */
export function saldoStok(stokAwal: number, produksi: number, terpakai: number): number {
  /*
   * DIKEMBALIKAN KE SKALA KOLOM, dan itu bukan kosmetik.
   *
   * Ketiga sukunya lahir dari `SUM(...)` yang TERPISAH: masing-masing sudah
   * dibulatkan sekali saat cast, jadi menyusunnya di JS memasukkan derau yang
   * tak pernah ada di datanya. Terukur lewat HTTP (2026-08-25):
   *
   *   stok awal 0,1 + pembelian 0,2 → GET /stok "saldo": 0.30000000000000004
   *   0,1 + 0,2 − 0,3               → 5.551115123125783e-17, bukan 0
   *
   * Baris kedua itu yang berbahaya: `statusStok` di bawah memakai `saldo <= 0`
   * untuk badge "habis", dan pemanggilnya memakai `saldo === 0` untuk
   * menyembunyikan baris satuan setara. Bahan yang BENAR-BENAR habis karena
   * itu terbaca "aman", dan layarnya menampilkan sisa yang tak ada.
   *
   * Pembulatannya di SINI supaya `statusStok` dan tiap pemanggil mewarisinya
   * — bukan aturan yang harus diingat ulang di tiap situs.
   */
  return keSkalaKolom(stokAwal + produksi - terpakai, SKALA_QTY_STOK_KOLOM);
}

/**
 * Status stok. Bila `minimum` > 0 (ambang batas per bahan diatur), pakai batas
 * absolut: saldo ≤ 0 → habis, saldo ≤ minimum → menipis. Bila minimum = 0
 * (belum diatur), pakai logika rasio default (kompatibel dgn perilaku lama).
 */
export function statusStok(
  stokAwal: number,
  produksi: number,
  terpakai: number,
  minimum = 0,
): StokStatus {
  const saldo = saldoStok(stokAwal, produksi, terpakai);
  if (minimum > 0) {
    if (saldo <= 0) return "habis";
    if (saldo <= minimum) return "menipis";
    return "aman";
  }
  if (saldo <= 0 && terpakai > 0) return "habis";
  const kapasitas = stokAwal + produksi;
  if (kapasitas > 0 && saldo / kapasitas < STOK_MENIPIS_THRESHOLD) return "menipis";
  return "aman";
}

export function hitungPb1(subtotal: number, ratePersen: number): number {
  return Math.round(subtotal * (ratePersen / 100));
}

/**
 * Tarif PB1 yang BENAR-BENAR menghasilkan nominal pada sebuah struk — atau
 * `null` bila tak bisa dibuktikan.
 *
 * Penjualan menyimpan RUPIAH PB1-nya, tidak tarifnya. Diskon menyimpan
 * keduanya (`diskon_persen` ikut tersimpan per penjualan), PB1 tidak. Jadi
 * struk cetak ulang tak punya sumber untuk persen di sebelah nominalnya, dan
 * satu-satunya angka yang tersedia — setelan perusahaan HARI INI — justru yang
 * paling mudah salah. Dua jalan meleset, dan keduanya nyata:
 *
 *   1. Owner mengubah tarifnya (10% → 11%), lalu struk lama dicetak ulang dari
 *      Riwayat Transaksi. Kertas yang dipegang tamu menuliskan "PB1 11%" di
 *      sebelah nominal yang 10% dari netnya.
 *   2. Refund sebagian. PB1-nya diprorata dari PB1 ASAL (lihat `refund.ts`),
 *      bukan dihitung ulang dari tarif — memang begitu seharusnya, tapi
 *      hasilnya bisa tak sama dengan tarif mana pun.
 *
 * Maka tarifnya diturunkan dari angka struk ITU SENDIRI lalu DIBUKTIKAN: hanya
 * dikembalikan bila `hitungPb1` atasnya menghasilkan nominal yang sama persis.
 * Bila tidak, jawabannya `null` dan struk mencetak "PB1" tanpa persen — persis
 * seperti struk di layar yang memang sudah tak pernah menampilkan tarif. Tidak
 * tahu lebih baik daripada menebak: yang ditebak ini dicetak di atas kertas dan
 * dibawa pulang tamu.
 */
export function tarifPb1Struk(subtotal: number, diskon: number, pb1: number): number | null {
  const net = subtotal - diskon;
  if (!(net > 0) || !(pb1 > 0)) return null;
  const kasar = (pb1 / net) * 100;
  // Yang PALING SEDERHANA dulu: bulat, lalu 1 desimal, lalu 2 (batas
  // `companies.pb1_rate` numeric(5,2) — tarif yang tak bisa disimpan
  // perusahaan juga tak boleh muncul di struk). Pembulatan PB1 membuat banyak
  // tarif menghasilkan nominal yang sama; yang dicetak sebaiknya yang paling
  // mungkin benar-benar disetel owner, bukan pecahan sisa pembagian balik.
  for (const skala of [1, 10, 100]) {
    const tarif = Math.round(kasar * skala) / skala;
    // Batas atas 100: itu yang bisa disimpan perusahaan (form Pengaturan
    // menjepitnya ke [0, 100]). Tarif di luar itu tak mungkin pernah disetel
    // siapa pun, jadi walau ia memproduksi ulang nominalnya, ia bukan
    // jawabannya — cuma artefak pembagian balik.
    if (tarif > 0 && tarif <= 100 && hitungPb1(net, tarif) === pb1) return tarif;
  }
  return null;
}

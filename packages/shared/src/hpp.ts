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
  return stokAwal + produksi - terpakai;
}

export function statusStok(
  stokAwal: number,
  produksi: number,
  terpakai: number,
): StokStatus {
  const saldo = saldoStok(stokAwal, produksi, terpakai);
  if (saldo <= 0 && terpakai > 0) return "habis";
  const kapasitas = stokAwal + produksi;
  if (kapasitas > 0 && saldo / kapasitas < STOK_MENIPIS_THRESHOLD) return "menipis";
  return "aman";
}

export function hitungPb1(subtotal: number, ratePersen: number): number {
  return Math.round(subtotal * (ratePersen / 100));
}

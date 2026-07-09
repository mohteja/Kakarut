/** Ambang "Menipis": saldo / (stok awal + produksi) < 15% */
export const STOK_MENIPIS_THRESHOLD = 0.15;

/** Tarif PB1 (pajak restoran) default dalam persen */
export const DEFAULT_PB1_RATE = 10;

/**
 * Panduan markup per jenis kategori (persen) — hanya panduan saat membuat
 * menu baru; menu yang sudah ada memakai `mult` tersimpan.
 */
export const PANDUAN_MARKUP: { kategori: string; persen: string; keterangan: string }[] = [
  { kategori: "Food set", persen: "100", keterangan: "Paket makanan (HPP × 2)" },
  { kategori: "Menu baru (food)", persen: "100", keterangan: "HPP × 2" },
  { kategori: "Minuman segar", persen: "150–175", keterangan: "HPP × 2.5–2.75" },
  { kategori: "Teh", persen: "150", keterangan: "HPP × 2.5" },
  { kategori: "Frozen / dessert", persen: "100–150", keterangan: "HPP × 2–2.5" },
  { kategori: "Yamin satuan", persen: "200", keterangan: "HPP × 3" },
  { kategori: "Side dish", persen: "250–350", keterangan: "HPP × 3.5–4.5" },
  { kategori: "Oseng", persen: "0", keterangan: "Tanpa markup" },
  { kategori: "Paket yamin", persen: "0", keterangan: "Rumus khusus (topping tanpa markup)" },
];

export type StokStatus = "habis" | "menipis" | "aman";
export type UserRole = "owner" | "admin" | "cashier";
export type MenuTipe = "regular" | "paket";
export type BahanKategori = "baso" | "minuman" | "lain";

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
export type UserRole = "owner" | "admin" | "cashier" | "tim" | "kitchen" | "bar";
export type MenuTipe = "regular" | "paket";
/**
 * Kategori bahan = teks bebas dari master `ingredient_categories` (bisa
 * ditambah owner). "baso"/"minuman"/"lain" hanya nilai bawaan.
 */
export type BahanKategori = string;
/** jalur pengadaan bahan baku: diproduksi sendiri vs dibeli jadi */
export type JenisPengadaan = "produksi" | "beli";
/**
 * Lokasi produksi bahan jalur "produksi": diproduksi di Central Kitchen (lalu
 * dikirim ke cabang) atau langsung di cabang store (kitchen ATAU bar toko,
 * sesuai `divisi_produksi` — hasil masuk stok cabang itu). Hanya bermakna
 * untuk pengadaan "produksi".
 */
export type ProduksiDi = "ck" | "cabang";
/**
 * Divisi pelaksana resep saat produksi_di="cabang": role kitchen hanya boleh
 * memproduksi resep divisi "kitchen", role bar hanya divisi "bar". Diabaikan
 * saat produksi_di="ck".
 */
export type DivisiProduksi = "kitchen" | "bar";

import type { OpnameSesiStatus, PenyesuaianStatus } from "./types";

/**
 * ATURAN PENCARIAN & SARINGAN RIWAYAT STOCK OPNAME — satu rumah untuk dua tab.
 *
 * Riwayat SO punya DUA sisi dengan bentuk baris yang mirip tapi tak sama:
 * bahan baku (`OpnameSesiRow`, 4 keadaan, punya `catatan`) dan perlengkapan
 * (`OpnamePerlengkapanSesiRow`, 3 keadaan, tanpa `catatan`). Menyalin aturan
 * pencariannya ke masing-masing tab adalah bentuk yang sudah dua kali dibayar
 * repo ini: dua salinan yang lahir kembar lalu menjawab beda tanpa ada yang
 * memberi tahu.
 */

/** Pecah kata kunci jadi token huruf kecil; spasi beruntun dirapatkan. */
function token(cari: string): string[] {
  return cari.toLowerCase().split(/\s+/).filter((t) => t.length > 0);
}

/**
 * Baris riwayat SO yang bisa dicari — irisan medan yang dimiliki KEDUA sisi,
 * ditambah `catatan` yang hanya ada di sisi bahan baku (opsional).
 */
export interface BarisCariOpname {
  nomor: string | null;
  oleh: string | null;
  catatan?: string | null;
}

/**
 * Apakah satu baris cocok dengan kata kunci.
 *
 * Aturannya:
 *
 * - kata kunci kosong (atau spasi saja) cocok dengan SEMUA — kotak pencarian
 *   yang belum diketik tak boleh mengosongkan daftar;
 * - beberapa kata di-AND, bukan di-OR. "SO-0007 owner" mencari sesi SO-0007
 *   milik Owner, bukan "semua SO-0007 DITAMBAH semua milik Owner" — yang kedua
 *   memulangkan lebih banyak baris justru saat pencariannya dipersempit, dan
 *   itu terbaca seperti pencarian yang rusak;
 * - dicocokkan ke `nomor`, `oleh`, dan `catatan` (bila ada). `session_id`
 *   SENGAJA tidak ikut: ia uuid yang tak pernah dilihat orang, dan
 *   memasukkannya membuat kata kunci pendek seperti "a" cocok dengan hampir
 *   semua baris;
 * - `null` diperlakukan sebagai teks kosong, bukan sebagai "cocok apa saja".
 */
export function cocokCariOpname(baris: BarisCariOpname, cari: string): boolean {
  const t = token(cari);
  if (t.length === 0) return true;
  const heystack = [baris.nomor ?? "", baris.oleh ?? "", baris.catatan ?? ""]
    .join(" ")
    .toLowerCase();
  return t.every((x) => heystack.includes(x));
}

/** Pilihan saringan status sisi BAHAN BAKU — "semua" plus keempat keadaannya. */
export const SARINGAN_STATUS_OPNAME_BAHAN = [
  "semua",
  "cocok",
  "menunggu",
  "disetujui",
  "ditolak",
] as const satisfies readonly ("semua" | OpnameSesiStatus)[];

/** Pilihan saringan status sisi PERLENGKAPAN — "semua" plus ketiga keadaannya. */
export const SARINGAN_STATUS_OPNAME_PERLENGKAPAN = [
  "semua",
  "menunggu",
  "disetujui",
  "ditolak",
] as const satisfies readonly ("semua" | PenyesuaianStatus)[];

export type SaringanStatusOpnameBahan = (typeof SARINGAN_STATUS_OPNAME_BAHAN)[number];
export type SaringanStatusOpnamePerlengkapan =
  (typeof SARINGAN_STATUS_OPNAME_PERLENGKAPAN)[number];

/**
 * Apakah baris berstatus `status` lolos saringan `pilihan`.
 *
 * Dipisah jadi fungsi sendiri (bukan `pilihan === status` di tempat pemakaian)
 * supaya kata ajaib `"semua"` hanya ditulis SEKALI. Sebuah tab yang lupa
 * menangani "semua" akan menyaring habis daftarnya dan terbaca sebagai
 * "belum ada riwayat" — pernyataan yang salah.
 */
export function lolosSaringanStatus(status: string, pilihan: string): boolean {
  return pilihan === "semua" || status === pilihan;
}

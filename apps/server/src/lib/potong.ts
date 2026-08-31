import type { Context } from "hono";

/**
 * DAFTAR YANG DIPOTONG — SATU RUMAH UNTUK CARA MENGATAKANNYA.
 *
 * Aturannya sudah ditulis panjang di `modules/customer/routes.ts`, dan punya
 * dua sisi: agregat dihitung SEBELUM pemotongan, dan yang membaca daftarnya
 * DIBERI TAHU bahwa ia pendek. Sisi kedua itu yang tinggal di sini.
 *
 * Dua bentuk, dan pilihannya ditentukan BENTUK BALASANNYA, bukan selera:
 *
 * - **Balasan berupa objek** → kunci badan `<sesuatu>_terpotong: boolean`,
 *   seperti `customer` (`terpotong`, `transaksi_terpotong`), `bahan`
 *   (`lots_terpotong`), `shift` (`transaksi_terpotong`).
 * - **Balasan berupa LARIK TELANJANG** → header [HEADER_TERPOTONG]. Bentuk
 *   larik tak boleh berubah jadi objek: build ponsel lama membacanya
 *   `as List` dan repo ini TIDAK punya gerbang versi klien, jadi mengubah
 *   bentuknya mematikan layar yang hari ini jalan. Header lewat begitu saja
 *   pada klien yang tak memintanya.
 *
 * Header ini lahir di `modules/sampah/routes.ts` dan sudah dibaca kedua klien
 * (`apps/web/src/lib/api.ts` lewat `bacaHeader`, dan `core/api_client.dart`).
 * Ia dipindah ke sini — bukan disalin — begitu pintu KEDUA membutuhkannya:
 * dua tetapan dengan ejaan yang pelan-pelan berbeda adalah cara sebuah aturan
 * berhenti berlaku tanpa ada yang memutuskan begitu.
 */
export const HEADER_TERPOTONG = "X-Kakarut-Terpotong";

/**
 * Potong `rows` ke `batas` dan KATAKAN pada pemanggil bila ada yang dibuang.
 *
 * Cara pakainya menuntut kueri mengambil `batas + 1` baris — satu baris lebih
 * itulah yang membedakan "tepat sejumlah batas" dari "lebih banyak dari
 * batas". Tanpa itu, daftar yang kebetulan pas berjumlah `batas` akan
 * dituduh terpotong, dan peringatan yang menyala tanpa sebab adalah
 * peringatan yang orang belajar abaikan.
 */
export function potongLarik<T>(
  c: Context,
  rows: T[],
  batas: number,
): T[] {
  if (rows.length <= batas) return rows;
  c.header(HEADER_TERPOTONG, String(batas));
  return rows.slice(0, batas);
}

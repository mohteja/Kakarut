/**
 * PEMBULATAN KE PRESISI KOLOM untuk angka yang DISUSUN DI JS.
 *
 * Rumahnya di `@kakarut/shared` — bukan di server — karena aturan yang
 * memakainya (`saldoStok`) tinggal di sini juga. Menaruh pembulatannya di
 * server berarti `saldoStok` mengembalikan angka mentah dan tiap pemanggil
 * harus ingat membulatkannya sendiri; itu satu aturan dengan banyak rumah,
 * dan bentuk itulah yang berulang kali jadi bug di repo ini.
 * `apps/server/src/lib/batas-angka.ts` MENGEKSPOR ULANG keduanya, jadi
 * pemanggil server tak perlu tahu di mana ia tinggal.
 */

/** Skala desimal kolom qty stok/produksi (`numeric(16,6)` di skema). */
export const SKALA_QTY_STOK_KOLOM = 6;

/**
 * Kembalikan angka ke PRESISI KOLOMNYA sesudah disusun di JS.
 *
 * Postgres menjumlahkan `numeric` secara EKSAK, jadi SATU `SUM(...)::float8`
 * dibulatkan sekali dan tetap sepadan dengan desimal aslinya. Yang tidak
 * sepadan: nilai yang disusun DI JS dari beberapa float8 yang masing-masing
 * sudah dibulatkan sendiri — di sanalah derau digit ke-17 masuk, dan ia
 * bukan informasi yang hilang saat dibuang.
 */
export function keSkalaKolom(nilai: number, skala: number): number {
  if (!Number.isFinite(nilai)) return nilai;
  const f = 10 ** skala;
  return Math.round(nilai * f) / f;
}

/** Skala desimal kolom UANG (`sales.subtotal`/`total`, `sale_items.line_total` — `numeric(…,2)`). */
export const SKALA_UANG_KOLOM = 2;

/** Skala desimal kolom HPP tersimpan (`sales.total_hpp`, `sale_items.hpp_satuan` — `numeric(…,4)`). */
export const SKALA_HPP_KOLOM = 4;

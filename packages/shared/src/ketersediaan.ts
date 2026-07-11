/**
 * Perhitungan sisa porsi menu (ketersediaan) — sumber kebenaran murni yang
 * dipakai server. Dipisah agar bisa diuji tanpa database.
 */
import type { KomponenDto } from "./types";

/** Komponen minimal yang dibutuhkan untuk hitung ketersediaan. */
export type KomponenKetersediaan = Pick<KomponenDto, "ingredient_id" | "qty" | "track_stok">;

/**
 * Qty bahan terlacak per porsi sebuah menu — menggabungkan komponen menu
 * sendiri dengan komponen menu dasar (paket), dijumlah per bahan. Meniru
 * konsumsi BAWA PULANG: qty penuh tiap komponen (termasuk kemasan), yaitu
 * skenario yang paling banyak memakai stok — sehingga estimasi porsi bersifat
 * konservatif (sisa yang ditampilkan tak pernah melebihi kemampuan nyata).
 * Bahan yang tak dilacak stoknya atau qty ≤ 0 diabaikan.
 */
export function qtyBahanPerPorsi(komponen: KomponenKetersediaan[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const k of komponen) {
    if (!k.track_stok || k.qty <= 0) continue;
    out.set(k.ingredient_id, (out.get(k.ingredient_id) ?? 0) + k.qty);
  }
  return out;
}

/**
 * Sisa porsi = ⌊min(saldo ÷ qty per porsi)⌋ atas semua bahan pembatas. Bahan
 * tanpa saldo (nonaktif / tak tampil di cabang) diabaikan. Mengembalikan
 * `null` bila tak ada bahan pembatas (dianggap tak terbatas); tak pernah
 * bernilai negatif (bahan yang tekor dianggap habis → 0).
 */
export function porsiTersedia(
  qtyPerPorsi: Map<string, number>,
  saldoByIngredient: Map<string, number>,
): number | null {
  let porsi: number | null = null;
  for (const [ingredientId, qty] of qtyPerPorsi) {
    const saldo = saldoByIngredient.get(ingredientId);
    if (saldo == null) continue;
    const bisa = Math.max(0, Math.floor(saldo / qty));
    porsi = porsi == null ? bisa : Math.min(porsi, bisa);
  }
  return porsi;
}

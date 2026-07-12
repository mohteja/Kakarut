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
  return bahanPembatas(qtyPerPorsi, saldoByIngredient)?.porsi ?? null;
}

/**
 * Bahan PEMBATAS ketersediaan: bahan dengan ⌊saldo ÷ qty⌋ paling kecil (yang
 * menentukan sisa porsi). Aturan sama dengan porsiTersedia; null bila menu tak
 * punya bahan pembatas. Bila seri, bahan pertama pada urutan komponen menang.
 */
export function bahanPembatas(
  qtyPerPorsi: Map<string, number>,
  saldoByIngredient: Map<string, number>,
): { ingredient_id: string; porsi: number } | null {
  let terketat: { ingredient_id: string; porsi: number } | null = null;
  for (const [ingredientId, qty] of qtyPerPorsi) {
    const saldo = saldoByIngredient.get(ingredientId);
    if (saldo == null) continue;
    const bisa = Math.max(0, Math.floor(saldo / qty));
    if (terketat == null || bisa < terketat.porsi) {
      terketat = { ingredient_id: ingredientId, porsi: bisa };
    }
  }
  return terketat;
}

/**
 * Total kebutuhan bahan untuk sebuah RENCANA porsi menu:
 * Σ (porsi menu × qty bahan per porsi), dijumlah per bahan lintas menu.
 * Rencana dengan porsi ≤ 0 diabaikan.
 */
export function kebutuhanBahanRencana(
  rencana: { qtyPerPorsi: Map<string, number>; porsi: number }[],
): Map<string, number> {
  const total = new Map<string, number>();
  for (const r of rencana) {
    if (r.porsi <= 0) continue;
    for (const [ingredientId, qty] of r.qtyPerPorsi) {
      total.set(ingredientId, (total.get(ingredientId) ?? 0) + qty * r.porsi);
    }
  }
  return total;
}

/**
 * Kekurangan bahan = butuh − saldo, dengan toleransi presisi float: selisih
 * di bawah epsilon dianggap 0 (mis. 0.1 × 3 vs saldo 0.3 menghasilkan noise
 * 5.55e-17 yang TIDAK boleh memicu faktur satu batch penuh).
 */
export function kekuranganBahan(butuh: number, saldo: number): number {
  const selisih = butuh - saldo;
  return selisih > 1e-9 ? selisih : 0;
}

/**
 * Terjemahkan KEKURANGAN bahan menjadi baris faktur:
 * - jalur produksi & isi > 1 → mode "batch", jumlah = ⌈kurang ÷ isi⌉
 *   (produksi nyata terjadi per batch penuh);
 * - jalur beli & isi > 1 & TIDAK boleh eceran → mode "batch" juga, karena toko
 *   menjual per kemasan (`isi` = isi per kemasan) — jumlah = ⌈kurang ÷ isi⌉
 *   kemasan (label UI: "kemasan");
 * - selainnya (isi = 1, atau beli yang boleh eceran) → mode "pcs",
 *   jumlah = ⌈kurang⌉ (bulat ke atas, tak beli pecahan).
 * `qty` = kuantitas riil yang masuk stok (jumlah × isi untuk batch/kemasan).
 */
export function jumlahFaktur(
  kurang: number,
  pengadaan: "produksi" | "beli",
  isi: number,
  /** hanya berlaku untuk jalur beli; produksi selalu per batch bila isi > 1 */
  bolehEceran: boolean,
): { mode: "pcs" | "batch"; jumlah: number; qty: number } {
  const perKemasan = isi > 1 && (pengadaan === "produksi" || !bolehEceran);
  if (perKemasan) {
    const jumlah = Math.max(1, Math.ceil(kurang / isi));
    return { mode: "batch", jumlah, qty: jumlah * isi };
  }
  const jumlah = Math.max(1, Math.ceil(kurang));
  return { mode: "pcs", jumlah, qty: jumlah };
}

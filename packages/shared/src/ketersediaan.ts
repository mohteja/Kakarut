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
  if (bergerakPerKemasan(pengadaan, isi, bolehEceran)) {
    const jumlah = Math.max(1, Math.ceil(kurang / isi));
    return { mode: "batch", jumlah, qty: jumlah * isi };
  }
  const jumlah = Math.max(1, Math.ceil(kurang));
  return { mode: "pcs", jumlah, qty: jumlah };
}

/** Toleransi pembanding kuantitas (qty numeric(…,2) → pecahan kecil wajar). */
/**
 * Toleransi pembanding qty — dan asalnya DITULIS, sebab konstanta telanjang
 * adalah kelas yang sudah tiga kali jadi bug di repo ini (`1e-9` di stok,
 * produksi, FIFO, dan refund).
 *
 * Angkanya = SATU unit kolom qty stok (`numeric(16,6)`), dan pembandingnya
 * `<` STRIK — jadi selisih sebesar satu unit kolom yang NYATA tetap terlihat,
 * sementara derau di bawahnya tidak. Diukur (2026-08-25):
 *
 *   |1e-6| < EPS_QTY → false   ← selisih satu unit kolom TIDAK tertelan
 *   |5e-7| < EPS_QTY → true    ← setengah unit (derau) tertelan
 *
 * Dan ia masih lebih besar daripada derau float di seluruh rentang yang
 * dipakai praktik — ULP `kemasan = qty / isi` terukur 5,7e-14 (qty 10³),
 * 3,7e-9 (qty 10⁸), 1,2e-7 (qty 10⁹):
 *
 *   qty 10¹⁰ → ULP 1,91e-6 > EPS_QTY  ← DI SINI ia berhenti berarti
 *
 * Batas itu ditulis apa adanya: pada besaran ≳10¹⁰ (`BATAS_QTY_STOK` =
 * 9.999.999.999) float8 tak lagi sanggup membawa skala kolomnya, dan
 * jawabannya berhenti memakai float8 — bukan mengecilkan toleransi ini.
 */
const EPS_QTY = 1e-6;

/**
 * Bahan ini bergerak per KEMASAN UTUH, bukan eceran?
 *
 * Predikat tunggal yang dipakai `jumlahFaktur` (belanja) DAN pemeriksaan
 * kiriman antar-cabang, supaya keduanya tak pernah berbeda pendapat: barang
 * yang hanya bisa DIBELI per kilo juga hanya bisa DIKIRIM per kilo.
 */
export function bergerakPerKemasan(
  pengadaan: "produksi" | "beli",
  isi: number,
  bolehEceran: boolean,
): boolean {
  return isi > 1 && (pengadaan === "produksi" || !bolehEceran);
}

/**
 * Kiriman bahan ini WAJIB kelipatan kemasan?
 *
 * SENGAJA lebih sempit daripada `bergerakPerKemasan`: hanya jalur **beli**.
 * Alasannya, kendala kemasan itu nyata di sisi pemasok — sayur yang cuma dijual
 * per kilo memang tak bisa dipecah jadi 900 gr. Untuk bahan **produksi** `isi`
 * adalah UKURAN BATCH, bukan kemasan fisik: CK memproduksi 100 butir baso lalu
 * mengirim 40 butir ke cabang adalah alur normal, dan memaksanya kelipatan 100
 * akan mengunci operasional cabang.
 */
export function wajibKelipatanKirim(
  pengadaan: "produksi" | "beli",
  isi: number,
  bolehEceran: boolean,
): boolean {
  return pengadaan === "beli" && bergerakPerKemasan(pengadaan, isi, bolehEceran);
}

/**
 * Periksa qty kiriman terhadap aturan kemasan.
 *
 * Bahan yang wajib kelipatan hanya boleh dikirim dalam KELIPATAN `isi`
 * (1 kg, 2 kg — bukan 900 gr). Satu pengecualian yang disengaja: bila qty sama
 * dengan SELURUH sisa stok bahan itu di cabang asal, kiriman tetap boleh
 * ("kirim habis") — tanpa itu sisa 900 gr terjebak selamanya di gudang asal
 * karena tak akan pernah mencapai satu kemasan penuh.
 *
 * `sisa` = saldo tersedia di cabang asal (sudah dipotong barang di jalan);
 * biarkan `undefined` bila tak diketahui — pengecualian kirim-habis dilewati.
 */
export function cekKirimKemasan(params: {
  qty: number;
  isi: number;
  pengadaan: "produksi" | "beli";
  bolehEceran: boolean;
  sisa?: number;
}): { ok: true } | { ok: false; kemasan: number; bawah: number; atas: number } {
  const { qty, isi, pengadaan, bolehEceran, sisa } = params;
  if (!wajibKelipatanKirim(pengadaan, isi, bolehEceran)) return { ok: true };
  const kemasan = qty / isi;
  if (Math.abs(kemasan - Math.round(kemasan)) < EPS_QTY) return { ok: true };
  // kirim habis: sisa di bawah satu kemasan tetap boleh dipindahkan
  if (sisa != null && Math.abs(qty - sisa) < EPS_QTY) return { ok: true };
  return {
    ok: false,
    kemasan,
    bawah: Math.floor(kemasan) * isi,
    atas: Math.ceil(kemasan) * isi,
  };
}

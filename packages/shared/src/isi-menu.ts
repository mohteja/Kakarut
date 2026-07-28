/**
 * Draf "isi menu" dari RESEP — titik awal untuk field `deskripsi`, bukan
 * penggantinya.
 *
 * Kenapa hanya draf, bukan turunan langsung? Karena resep (`menu_components`)
 * itu dokumen **biaya**, bukan deskripsi hidangan:
 *
 * - takarannya boleh pecahan hasil konversi gram — di data nyata ada baris
 *   `0,7576 butir Baso halus kecil`, yang mustahil dicetak di daftar menu;
 * - memuat KEMASAN (kresek/plastik take away) dan PELENGKAP (saos & sambal)
 *   yang bukan "isi" yang dijanjikan ke pembeli;
 * - namanya nama gudang ("Topping mie dkk"), bukan nama yang menjual.
 *
 * Jadi fungsi ini menyiapkan teks sedekat mungkin dengan yang biasanya
 * diinginkan, lalu pemilik merapikannya sendiri di form.
 */
import type { KomponenDto } from "./types";

/** Komponen minimal yang dibutuhkan untuk menyusun draf isi menu. */
export type KomponenIsi = Pick<
  KomponenDto,
  "nama" | "qty" | "satuan" | "is_packaging" | "is_complement"
>;

/** Satuan yang tak perlu ditulis — sudah tersirat dari nama bahannya. */
const SATUAN_TERSIRAT = new Set(["porsi", "pcs", "butir", "buah", "bungkus"]);

/**
 * Bulatkan takaran ke bilangan yang masuk akal untuk daftar menu.
 * Pecahan hasil konversi gram dibulatkan KE ATAS ke bilangan bulat terdekat:
 * pembeli tak pernah menerima "0,76 butir", dan membulatkan ke bawah jadi 0
 * akan menghapus bahan itu dari daftar.
 */
function bulatkanTakaran(qty: number): number {
  if (qty <= 0) return 0;
  return qty < 1 ? 1 : Math.round(qty);
}

/**
 * Susun satu baris draf: "2 baso kecil", atau "1 porsi kuah" bila satuannya
 * memang membawa arti. Nama bahan di-lowercase supaya kalimatnya mengalir —
 * pemilik bebas mengubahnya.
 */
function barisIsi(k: KomponenIsi): string {
  const n = bulatkanTakaran(k.qty);
  const satuan = SATUAN_TERSIRAT.has(k.satuan.toLowerCase()) ? "" : ` ${k.satuan}`;
  return `${n}${satuan} ${k.nama.toLowerCase()}`;
}

/**
 * Draf isi menu dari komponen resep.
 *
 * Yang DIBUANG: kemasan (`is_packaging`), pelengkap (`is_complement`), dan
 * baris bertakaran ≤ 0. Sisanya ditulis apa adanya dengan takaran dibulatkan.
 *
 * `basePrefix` untuk menu PAKET: mis. `"2× Yamin Misdasem"` — isi menu dasar
 * tak ikut terbaca di `komponen` paket, jadi harus disebut terpisah supaya
 * drafnya tidak menyesatkan.
 */
export function draftIsiMenu(komponen: KomponenIsi[], basePrefix?: string | null): string {
  const baris = komponen
    .filter((k) => !k.is_packaging && !k.is_complement && k.qty > 0)
    .map(barisIsi);
  if (basePrefix) baris.unshift(basePrefix);
  return baris.join(", ");
}

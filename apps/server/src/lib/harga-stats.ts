import type { HargaEkstrem } from "@kakarut/shared";

/**
 * Statistik harga riwayat pembelian: terendah/tertinggi (berapa & kapan) +
 * MEDIAN — median jadi dasar harga acuan RAB beli bahan baku (disinkron saat
 * Laporan Harga), sedangkan harga riil per lot tetap dipakai HPP FIFO/resep.
 */

/** Median dari daftar angka; null bila kosong. Genap = rata-rata dua tengah. */
export function median(nilai: number[]): number | null {
  if (nilai.length === 0) return null;
  const urut = [...nilai].sort((a, b) => a - b);
  const tengah = Math.floor(urut.length / 2);
  const m = urut.length % 2 === 1 ? urut[tengah] : (urut[tengah - 1] + urut[tengah]) / 2;
  return Math.round(m * 100) / 100;
}

/** Satu lot pembelian yang ikut menentukan harga acuan. */
export interface LotAcuan {
  id: string;
  qty: number;
  totalHarga: number | null;
}

/**
 * Harga acuan per satuan dari kolam lot.
 *
 * `lots` HANYA boleh berisi lot yang harganya PERNAH DILIHAT MANUSIA
 * (`harga_tebakan = false`). Faktur yang dibuat tanpa harga memakai tebakan
 * yang diturunkan dari harga acuan saat itu; kalau tebakan ikut masuk kolam,
 * acuan menyeret dirinya sendiri (acuan → tebakan → median → acuan) sampai HPP
 * seluruh menu hanyut ke atas.
 *
 * Baris yang SEDANG dilaporkan dikeluarkan dari `lots` (dicocokkan lewat `id`)
 * lalu dimasukkan kembali dengan nilai barunya — hasilnya persis sama dengan
 * kondisi setelah laporan tersimpan.
 */
export function acuanDariLot(
  lots: LotAcuan[],
  dilaporkan: Array<{ id: string; qty: number; totalHarga: number }>,
  fallback: number | null,
): number | null {
  const perSatuan = (totalHarga: number, qty: number) =>
    Math.round((totalHarga / qty) * 100) / 100;
  const sedangDilaporkan = new Set(dilaporkan.map((d) => d.id));
  const hargaSatuan = lots
    .filter((l) => !sedangDilaporkan.has(l.id) && l.totalHarga != null && l.qty > 0)
    .map((l) => perSatuan(l.totalHarga!, l.qty));
  for (const d of dilaporkan) {
    if (d.qty > 0) hargaSatuan.push(perSatuan(d.totalHarga, d.qty));
  }
  return median(hargaSatuan) ?? fallback;
}

export interface StatistikHarga {
  harga_terendah: HargaEkstrem | null;
  harga_tertinggi: HargaEkstrem | null;
  harga_median: number | null;
}

/**
 * Hitung terendah/tertinggi/median dari lot pembelian (harga per satuan).
 * Lot tanpa harga dilewati. Lot diharapkan urut TERBARU dulu; perbandingan
 * ketat (< / >) membuat titik ekstrem memakai kejadian PALING BARU saat seri.
 */
export function statistikHargaLots(
  lots: Array<{ harga_satuan: number | null; tanggal: string }>,
): StatistikHarga {
  let terendah: HargaEkstrem | null = null;
  let tertinggi: HargaEkstrem | null = null;
  const berharga: number[] = [];
  for (const l of lots) {
    if (l.harga_satuan == null) continue;
    berharga.push(l.harga_satuan);
    if (!terendah || l.harga_satuan < terendah.harga) {
      terendah = { harga: l.harga_satuan, tanggal: l.tanggal };
    }
    if (!tertinggi || l.harga_satuan > tertinggi.harga) {
      tertinggi = { harga: l.harga_satuan, tanggal: l.tanggal };
    }
  }
  return {
    harga_terendah: terendah,
    harga_tertinggi: tertinggi,
    harga_median: median(berharga),
  };
}

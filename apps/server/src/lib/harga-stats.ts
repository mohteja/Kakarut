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

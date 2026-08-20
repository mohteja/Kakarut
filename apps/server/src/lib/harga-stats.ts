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
  harga_rata: number | null;
  /** berapa lot yang benar-benar menentukan keempat angka di atas */
  jumlah_harga_nyata: number;
}

/**
 * Terendah / tertinggi / median / rata-rata tertimbang dari lot pembelian —
 * KEEMPATNYA dihitung di sini, dan HANYA dari harga yang pernah dilihat
 * manusia.
 *
 * LOT TEBAKAN DIKELUARKAN, dan itu bukan kehati-hatian berlebih.
 *
 * Faktur beli yang dibuat tanpa harga diisi qty × harga acuan SAAT ITU dan
 * ditandai `harga_tebakan`. Median inilah yang jadi harga acuan berikutnya
 * (disinkron tiap Laporan Harga), dan harga acuan itulah dasar HPP setiap menu
 * yang memakai bahannya. Kalau tebakan ikut kolam, acuan menyeret dirinya
 * sendiri: acuan → tebakan → median → acuan.
 *
 * TERUKUR, lewat API sungguhan: satu bahan beracuan awal 10.000, SATU pembelian
 * sungguhan 20.000/kg, lalu belanja rutin tanpa harga. Yang dilihat pemilik di
 * kartu Riwayat Harga:
 *
 *   Terendah 10.000 · MEDIAN 15.000 · Tertinggi 20.000 · Rata 15.000
 *
 * Padahal 10.000 tak pernah dibeli siapa pun — itu acuan lama yang dikutip
 * balik oleh sistem sebagai kalau-kalau ia sebuah pembelian. Menuruti median di
 * layarnya (dan layar itu menuliskan "Median jadi harga acuan RAB belanja"),
 * acuan mengunci di 15.000 selamanya, 25% di bawah satu-satunya harga yang
 * betul-betul dibayar — dan HPP tiap menu ikut turun sebesar itu.
 *
 * KENAPA SARINGANNYA DI SINI, BUKAN DI PEMANGGIL. Aturannya sudah ditegakkan
 * benar di `hitungAcuanBaru` (jalur MENULIS), dan `acuanDariLot` menuliskan
 * syaratnya di komentar. Yang menegakkan komentar tak ada, jadi jalur MEMBACA —
 * kartu Riwayat Harga — melewatkannya di keempat angkanya sekaligus. Sekarang
 * pemanggil tak bisa lupa: `harga_tebakan` bagian dari tipe lotnya, dan yang
 * menyaring fungsi ini.
 *
 * Rata-rata TERTIMBANG (Σtotal ÷ Σqty) ikut pindah ke sini karena ia dulu
 * disalin utuh di dua berkas rute — dan kedua salinan sama-sama lupa.
 *
 * Lot tanpa harga dilewati. Lot diharapkan urut TERBARU dulu; perbandingan
 * ketat (< / >) membuat titik ekstrem memakai kejadian PALING BARU saat seri.
 */
export function statistikHargaLots(
  lots: Array<{
    harga_satuan: number | null;
    tanggal: string;
    qty: number;
    total_harga: number | null;
    harga_tebakan: boolean;
  }>,
): StatistikHarga {
  let terendah: HargaEkstrem | null = null;
  let tertinggi: HargaEkstrem | null = null;
  const berharga: number[] = [];
  let sumHarga = 0;
  let sumQty = 0;
  for (const l of lots) {
    if (l.harga_tebakan || l.harga_satuan == null) continue;
    berharga.push(l.harga_satuan);
    if (!terendah || l.harga_satuan < terendah.harga) {
      terendah = { harga: l.harga_satuan, tanggal: l.tanggal };
    }
    if (!tertinggi || l.harga_satuan > tertinggi.harga) {
      tertinggi = { harga: l.harga_satuan, tanggal: l.tanggal };
    }
    if (l.total_harga != null && l.qty > 0) {
      sumHarga += l.total_harga;
      sumQty += l.qty;
    }
  }
  return {
    harga_terendah: terendah,
    harga_tertinggi: tertinggi,
    harga_median: median(berharga),
    harga_rata: sumQty > 0 ? Math.round((sumHarga / sumQty) * 100) / 100 : null,
    jumlah_harga_nyata: berharga.length,
  };
}

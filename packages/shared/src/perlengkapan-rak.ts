import type { PerlengkapanRowDto } from "./types";

/**
 * Berapa perlengkapan yang SEHARUSNYA ADA DI RAK cabang ini.
 *
 * Ledger perlengkapan baru bergerak SAAT DITERIMA, jadi `saldo` masih memuat
 * barang yang sudah berangkat ke cabang lain dan raknya sudah kosong. Setiap
 * layar yang menanyakan "berapa yang ada" — stock opname, stok awal, koreksi
 * fisik — harus membandingkan hitungan petugas dengan angka INI, bukan `saldo`.
 *
 * Sisi server sudah punya rumahnya sendiri (`saldoDiRakPerlengkapan`), dan
 * berkas ini rumah yang sama untuk sisi klien. Keduanya WAJIB sepakat: kalau
 * layar menampilkan saldo buku sementara server membandingkan angka rak,
 * petugas melihat "Sistem 10" di depan rak kosong, mengetik 0, dan layar
 * menjanjikan koreksi yang tak pernah terjadi.
 *
 * KENAPA BERKAS INI ADA, dan ini kegagalan yang layak dicatat: aturan ini
 * pernah lima kali disalin di sisi server — opname, stok awal, koreksi fisik,
 * pemakaian, potongan otomatis — dan KELIMANYA salah dengan cara yang identik
 * (saldo CK jatuh minus, barang hilang dari pembukuan). Sesudah dipusatkan di
 * server, DUA salinan sebaris tetap tertinggal di klien — di perubahan yang
 * justru berargumen menentang penyalinan itu. Sapuan "konsep yang dihitung di
 * banyak tempat" yang menemukannya, bukan mata.
 */
export function saldoDiRak(r: Pick<PerlengkapanRowDto, "saldo" | "dalam_jalan">): number {
  return r.saldo - r.dalam_jalan;
}

/**
 * Apakah ada barang dari cabang ini yang sedang di jalan?
 *
 * Dipakai layar untuk memutuskan apakah keterangan "N di jalan" perlu
 * ditampilkan. Angka rak yang lebih kecil dari saldo TANPA keterangan akan
 * terbaca sebagai stok yang hilang.
 */
export function adaDiJalan(r: Pick<PerlengkapanRowDto, "dalam_jalan">): boolean {
  return r.dalam_jalan > 0;
}

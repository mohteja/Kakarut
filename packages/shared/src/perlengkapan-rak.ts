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

/**
 * Berapa yang KURANG untuk mencapai stok minimum — dibulatkan ke atas.
 *
 * `0` bila stok sudah cukup, atau bila item ini memang tak punya minimum.
 * Pemanggil yang butuh angka SARAN (prefill dialog) membungkusnya sendiri
 * dengan `Math.max(1, …)`: menyarankan 0 pada kotak isian tak masuk akal, tapi
 * itu keputusan tampilan, bukan bagian dari "berapa kurangnya".
 *
 * KENAPA ADA `- 1e-9`, DAN KENAPA MENGHILANGKANNYA BUKAN "MERAPIKAN".
 *
 * Saldo perlengkapan disimpan `numeric(16,6)` dan sampai ke JavaScript sebagai
 * pecahan biner. Pengurangan dua desimal biasa bisa mendarat SEDIKIT DI ATAS
 * bilangan bulat, dan `Math.ceil` menaikkannya satu penuh:
 *
 *   stok_minimum 2.2, saldo 1.2  →  selisihnya 1.0000000000000002
 *     tanpa epsilon → Math.ceil(...) = 2
 *     dengan epsilon → 1
 *
 * Bukan kasus pinggiran yang dibuat-buat: menyapu pasangan (minimum, saldo)
 * satu desimal sampai 200 memberi 18.510 pasangan yang hasilnya berbeda.
 * Cabang bersatuan pecahan akan memesan satu lebih banyak dari yang perlu,
 * setiap kali.
 *
 * Aturan ini pernah tersalin dua kali — server memakai epsilonnya, layar tidak
 * — sehingga permintaan otomatis meminta 1 sementara dialog manual mengisi 2
 * untuk item yang sama. Berkas ini rumahnya sekarang.
 */
export function kekuranganKeMinimum(
  r: Pick<PerlengkapanRowDto, "stok_minimum" | "saldo">,
): number {
  if (!(r.stok_minimum > 0) || r.saldo >= r.stok_minimum) return 0;
  return Math.max(0, Math.ceil(r.stok_minimum - r.saldo - 1e-9));
}

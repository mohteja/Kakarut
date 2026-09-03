/**
 * KALIMAT UNTUK SESI YANG MATI — satu rumah.
 *
 * `lib/api.ts` memperlakukan 401 di luar login sebagai "sesi berakhir": sesi
 * lokal dihapus dan browser dipindah ke /login. Sampai 2026-09-02 pindahnya
 * BISU — `throw new ApiError(401, "Sesi berakhir…")` di sana tak pernah dibaca
 * siapa pun, sebab `window.location.href` sudah membuang halamannya. Token
 * kedaluwarsa (12 jam), password diganti di perangkat lain, akun dinonaktifkan
 * admin: semuanya berakhir di layar login yang sama tanpa satu kalimat,
 * terbaca sebagai "aplikasinya mengeluarkan saya tanpa sebab". Diukur di
 * browser (e2e `sesi-berakhir.spec.ts`).
 *
 * Sebabnya dibawa lewat query `?sesi=berakhir` — satu-satunya yang selamat
 * dari perpindahan dokumen penuh — dan halaman login yang mengucapkannya.
 */
export const PARAM_SESI = "sesi";
export const NILAI_SESI_BERAKHIR = "berakhir";
/*
 * Dipendekkan atas permintaan pemilik repo (2026-09-03): "sesi anda berakhir
 * silahkan masuk kembali cukup saja gitu".
 *
 * Versi panjangnya menyebut ketiga sebabnya dalam kurung — kedaluwarsa,
 * password diganti, akun dinonaktifkan. Itu benar, tapi ketiganya menuntut
 * tindakan yang SAMA dari pembacanya (masuk lagi), dan yang dua di antaranya
 * tak bisa ia perbaiki sendiri. Kalimat yang menyuruh orang membaca tiga
 * kemungkinan sebelum melakukan satu-satunya hal yang bisa ia lakukan adalah
 * kalimat yang tak dibaca. Yang penting tetap ada: bahwa ia dikeluarkan karena
 * SESUATU, bukan tanpa sebab — itu yang dulu hilang sama sekali.
 */
export const PESAN_SESI_BERAKHIR = "Sesi Anda berakhir. Silakan masuk kembali.";

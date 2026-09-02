/**
 * KALIMAT YANG MENYERTAI KODE VERIFIKASI — satu rumah untuk tiga layar.
 *
 * KENAPA BERKAS INI ADA, dan ongkosnya sudah dibayar orang sungguhan.
 *
 * Ketiga layar yang meminta kode verifikasi dulu menuliskan kalimatnya
 * sendiri-sendiri, dan ketiganya MENGKLAIM satu hal yang tak selalu benar:
 * "kami sudah mengirim kode". Untuk akun yang SUDAH terverifikasi server tidak
 * mengirim apa-apa — yang dibutuhkan orangnya cuma MASUK — dan tak satu layar
 * pun menyebutnya. Pemilik repo ini sendiri terjebak di situ dua hari.
 *
 * Versi pertama perbaikannya menaruh DUA kemungkinan di kalimat yang sama
 * ("jika baru, kodenya dikirim; jika sudah aktif, langsung Masuk") plus tombol
 * "Akun sudah aktif?". Pemilik repo menolaknya, dan alasannya benar: ini layar
 * PERTAMA orang mencoba aplikasi ini, dan layar yang menawarkan dua jalan
 * membingungkan. Yang benar: satu jalan, dan keadaan "sudah aktif" ditangani
 * SEBELUM layar ini — `/register` dengan password yang cocok kini memulangkan
 * sesi, dan orangnya langsung dimasukkan.
 *
 * Maka kalimat di sini kembali satu arah. Satu-satunya keadaan yang masih tak
 * terwakili — akun aktif + password SALAH — memang tak boleh dibedakan dari
 * email baru (anti-enumerasi), dan pemegangnya punya jalan yang selalu ada di
 * bawah layar: "Sudah punya akun? Masuk".
 *
 * Ditaruh di satu berkas karena bentuk "tiga salinan yang pelan-pelan
 * menyimpang" sudah menggigit di jalur yang sama: `VerifikasiEmailPage`
 * mendapat hitung mundur dari server sementara tombol kembar di `LoginPage`
 * berjalan tanpa jeda berbulan-bulan.
 */

/** Sesudah pendaftaran email baru (atau akun lama yang belum diverifikasi). */
export const PESAN_DAFTAR =
  "Kode 6 angka sedang dikirim ke alamat ini (berlaku 60 menit). Masukkan " +
  "kodenya untuk mengaktifkan akun.";

/** Sesudah menekan "Kirim ulang kode", di layar mana pun. */
export const PESAN_KIRIM_ULANG = "Kode baru sedang dikirim (berlaku 60 menit). Cek email Anda.";

/**
 * Saat `/register` memulangkan SESI: akun sudah aktif dan passwordnya cocok.
 * Ditampilkan sesaat sebelum diarahkan masuk, supaya orangnya tahu kenapa ia
 * tak diminta kode.
 */
export const PESAN_SUDAH_AKTIF = "Akun ini sudah aktif — Anda langsung dimasukkan.";

/**
 * Sesudah "Kirim tautan reset" di halaman Lupa Password. "Jika" di sini SAH,
 * dan bukan cabang kedua seperti yang dicabut di atas: balasan `/forgot-password`
 * memang netral untuk email terdaftar maupun tidak (anti-enumerasi), jadi
 * layarnya tak boleh tahu — dan tak boleh berkata "sudah dikirim" untuk surat
 * yang, bila alamatnya tak dikenal atau penyedianya menolak, tak pernah
 * berangkat. Kelas yang sama dengan tiga layar di atas; ditemukan saat
 * cakupan disapu 2026-09-02 (halaman ini tak pernah disentuh uji mana pun).
 */
export const PESAN_LUPA =
  "Jika alamat ini terdaftar, tautan atur ulang password sedang dikirim ke sana " +
  "(berlaku 1 jam). Cek email Anda.";

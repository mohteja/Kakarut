/**
 * KALIMAT YANG MENYERTAI KODE VERIFIKASI — satu rumah untuk tiga layar.
 *
 * KENAPA BERKAS INI ADA, dan ongkosnya sudah dibayar orang sungguhan.
 *
 * Ketiga layar yang meminta kode verifikasi dulu menuliskan kalimatnya
 * sendiri-sendiri, dan ketiganya MENGKLAIM satu hal yang tak selalu benar:
 *
 *     "Jika X valid, kami sudah mengirim kode 6 angka ke email tersebut."
 *     "Kode baru sudah dikirim (bila email valid). Cek email Anda."
 *
 * Server sengaja membalas IDENTIK untuk email yang terdaftar dan yang tidak —
 * itu yang menutup celah enumerasi akun, dan itu benar. Tapi ada keadaan
 * ketiga yang tak terwakili kalimat mana pun: **akun yang SUDAH terverifikasi**.
 * Untuk akun seperti itu server tidak mengirim apa-apa, dan memang tak perlu —
 * yang dibutuhkan orangnya cuma MASUK.
 *
 * Akibatnya lingkaran tanpa ujung, dan ia menimpa pemilik repo ini sendiri
 * selama dua hari: daftar ulang → "kami sudah mengirim kode" → layar tunggu →
 * "Kirim ulang" → "Kode baru sudah dikirim" → menunggu surat yang secara
 * struktural tak akan pernah berangkat. Tak satu pun layar menyebut jalan
 * keluarnya. Yang akhirnya menjawabnya bukan layar mana pun melainkan riwayat
 * kirim email di panel super admin: `Tidak dikirim — akun sudah terverifikasi`.
 *
 * PERBAIKANNYA BUKAN MEMBERI TAHU YANG MANA. Mengatakan "akun ini sudah
 * terverifikasi" akan membuka kembali persis celah yang ditutup respons netral
 * itu. Yang diperbaiki: kalimat yang MENGASUMSIKAN satu kemungkinan diganti
 * kalimat yang MENYEBUT keduanya, dan jalan keluar kedua dibuat terlihat.
 * Netral, dan tak lagi menyesatkan.
 *
 * Ditaruh di satu berkas karena bentuk "tiga salinan yang pelan-pelan
 * menyimpang" sudah menggigit di jalur yang sama: `VerifikasiEmailPage`
 * mendapat hitung mundur kirim ulang dari server, sementara tombol kembar di
 * `LoginPage` berjalan tanpa jeda sama sekali selama berbulan-bulan.
 */

/** Sesudah pendaftaran: kodenya MUNGKIN sedang dikirim, mungkin juga tidak. */
export const PESAN_DAFTAR =
  "Jika alamat ini baru, kode 6 angka sedang dikirim ke sana (berlaku 60 menit). " +
  "Jika Anda sudah pernah mendaftar dan akunnya sudah aktif, tidak ada kode yang " +
  "dikirim — langsung Masuk saja.";

/** Sesudah menekan "Kirim ulang kode", di layar mana pun. */
export const PESAN_KIRIM_ULANG =
  "Jika akun ini memang menunggu verifikasi, kode barunya sedang dikirim. " +
  "Jika akunnya sudah aktif, tidak ada kode yang dikirim — langsung Masuk saja.";

/** Ajakan yang menyertai keduanya; dipakai sebagai teks tautan ke /login. */
export const AJAKAN_MASUK = "Akun sudah aktif? Masuk di sini →";

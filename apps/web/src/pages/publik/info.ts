/**
 * Konstanta situs publik Terakasir (landing, legal, bantuan, kontak).
 * Satu sumber kebenaran agar nama/email/tanggal konsisten di semua halaman.
 */
export const NAMA_APP = "Terakasir";
export const DESKRIPSI_SINGKAT = "Aplikasi kasir & manajemen stok untuk bisnis makanan & minuman.";
/** Email kontak resmi (juga pengirim email sistem/SMTP). */
export const EMAIL_KONTAK = "terahokiindonesia@gmail.com";
/** Tanggal berlaku dokumen legal (ubah bila kebijakan direvisi). */
export const TANGGAL_BERLAKU = "21 Juli 2026";
/** Daftar tautan situs publik (dipakai header & footer). */
export const TAUTAN_PUBLIK: { ke: string; label: string }[] = [
  { ke: "/tentang", label: "Beranda" },
  { ke: "/bantuan", label: "Bantuan" },
  { ke: "/kontak", label: "Kontak" },
  { ke: "/privasi", label: "Kebijakan Privasi" },
  { ke: "/syarat", label: "Syarat & Ketentuan" },
];

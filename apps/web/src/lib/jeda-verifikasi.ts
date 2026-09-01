import { bacaLokal, tulisLokal } from "./simpanan";

/**
 * TENGGAT KIRIM ULANG KODE VERIFIKASI, DISIMPAN PER EMAIL — supaya tombolnya
 * tak berbohong.
 *
 * SATU RUMAH, dan itu yang membuat berkas ini ada. Aturannya lahir di
 * `VerifikasiEmailPage` dengan alasan yang ditulis panjang di sana: hitung
 * mundur yang cuma hidup di state React hilang begitu halamannya dimuat ulang,
 * tombolnya kembali tampak siap, ditekan, dan servernya menolak DIAM-DIAM
 * karena jaraknya belum lewat — orangnya membaca "kode baru sudah dikirim"
 * untuk surat yang tak pernah berangkat.
 *
 * Lalu pintu KEDUA ke keadaan yang sama dibiarkan terbuka: tombol "Kirim ulang
 * kode verifikasi" di halaman Masuk tak punya hitung mundur sama sekali, tak
 * membaca `retry_after_detik`, dan selalu menampilkan "sudah dikirim" —
 * termasuk pada detik-detik ketika server memang sedang menahannya. Bentuk yang
 * persis sama dengan yang sudah dibayar di layar sebelah, di layar yang lain.
 *
 * Yang disimpan TENGGATNYA (epoch md), bukan sisa detiknya — sisa detik yang
 * disimpan akan tetap sebesar itu berapa lama pun tabnya tertutup.
 *
 * Per email, sebab satu perangkat bisa dipakai mendaftarkan beberapa akun
 * (pemilik yang menyiapkan akun karyawannya), dan jarak milik satu akun tak ada
 * urusannya dengan akun lain.
 */
const kunciJeda = (email: string) => `kakarut.verifJeda:${email.trim().toLowerCase()}`;

/** "1:59" untuk sisa yang masih semenit lebih; "45 dtk" untuk sisanya. */
export function jamPasir(detik: number): string {
  if (detik < 60) return `${detik} dtk`;
  return `${Math.floor(detik / 60)}:${String(detik % 60).padStart(2, "0")}`;
}

/** Sisa detik sebelum tombol kirim ulang boleh ditekan lagi; 0 = boleh. */
export function sisaJeda(email: string): number {
  if (!email) return 0;
  const mentah = bacaLokal(kunciJeda(email));
  const tenggat = mentah ? Number(mentah) : 0;
  if (!Number.isFinite(tenggat)) return 0;
  return Math.max(0, Math.ceil((tenggat - Date.now()) / 1000));
}

/**
 * Catat tenggat baru sesudah satu kiriman.
 *
 * [detik] datang dari `retry_after_detik` milik SERVER — yang menahan
 * servernya, jadi menyalin angkanya ke klien cuma menyiapkan dua angka yang
 * bisa menyimpang. Cadangan 120 dipakai hanya bila balasannya tak membawanya.
 */
export function tulisJeda(email: string, detik: number | undefined): number {
  const d = detik ?? 120;
  tulisLokal(kunciJeda(email), String(Date.now() + d * 1000));
  return d;
}

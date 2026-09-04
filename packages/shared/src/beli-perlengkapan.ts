import type {
  BeliPerlengkapanStatus,
  EmberFakturBP,
  StatusFakturBP,
} from "./types";

/**
 * KEADAAN SATU FAKTUR BELI PERLENGKAPAN — satu aturan, dipakai server dan
 * kedua klien.
 *
 * Anggota ketiga keluarga `pengadaan.ts` / `permintaan-stok.ts`, dan lahir
 * dari sebab yang sama — kecuali satu hal yang membuatnya lebih mendesak:
 * di sini kedua klien SUDAH menyimpang, dan menyimpangnya tak pernah terlihat.
 *
 * Sampai 2026-09-04 aturannya diketik dua kali, dan keduanya BERBEDA:
 *
 *   web    (`BeliPerlengkapanPage.kelompokkanFaktur`)
 *          "tahap paling tertinggal": menunggu > diproses > tiba, `batal`
 *          tak pernah menang. Empat keadaan.
 *   ponsel (`perlengkapan_models.dart:statusFaktur`)
 *          buang baris `batal` dulu; semua sisanya `tiba` → `tiba`; SEBAGIAN
 *          `tiba` → **`sebagian`**; sisanya `diproses`/`menunggu`. LIMA
 *          keadaan.
 *
 * Faktur berisi [tiba, menunggu] karena itu berbunyi **"Menunggu"** di web dan
 * **"Sebagian"** di ponsel — faktur yang sama, dua layar, dua jawaban. Tak ada
 * yang merah, dan yang membacanya tak punya cara tahu mana yang benar.
 *
 * TERUKUR sebelum ditulis: pada basis gerbang, 14 faktur, **0** di antaranya
 * menghasilkan jawaban berbeda — tak satu pun faktur bercampur tiba+belum.
 * Jadi ini perbedaan yang NYATA di kode dan NOL kejadiannya hari ini. Yang
 * diperbaiki karena itu bukan angka yang sedang salah di layar siapa pun,
 * melainkan dua aturan yang akan terus menjauh.
 *
 * YANG MENANG ATURAN PONSEL, dan alasannya bisa diperiksa: `sebagian`
 * membawa informasi yang tak bisa diturunkan dari keempat keadaan lain —
 * "sebagian barangnya sudah masuk stok, sisanya belum". Web yang menyebutnya
 * "Menunggu" tidak salah arah (keduanya menuntut pekerjaan), ia cuma
 * kehilangan setengah kalimatnya.
 */
/**
 * Keadaan satu faktur dari status baris-barisnya.
 *
 * Baris `batal` DIBUANG lebih dulu, bukan diadu: membatalkan satu item dari
 * faktur berisi lima tidak membuat fakturnya "dibatalkan", dan tak boleh pula
 * menahan fakturnya terlihat selesai saat empat sisanya sudah tiba. Hanya
 * faktur yang SELURUH barisnya batal yang berakhir `batal`.
 */
export function statusFakturBP(
  baris: readonly { status: BeliPerlengkapanStatus }[],
): StatusFakturBP {
  const hidup = baris.filter((b) => b.status !== "batal");
  if (hidup.length === 0) return "batal";
  const tiba = hidup.filter((b) => b.status === "tiba").length;
  if (tiba === hidup.length) return "tiba";
  if (tiba > 0) return "sebagian";
  if (hidup.some((b) => b.status === "diproses")) return "diproses";
  return "menunggu";
}

/**
 * Ember sebuah keadaan.
 *
 * `sebagian` masuk `butuh_aksi`, dan itu bukan pembulatan: separuh barang yang
 * belum datang tetap menuntut orang menelepon supplier. Kedua klien memang
 * sudah memperlakukannya begitu — web menyebutnya "Menunggu", ponsel
 * menampilkannya di kelompok yang sama — jadi pemetaan ini tak mengubah arti
 * apa pun di layar mana pun; ia cuma menuliskannya di satu tempat.
 */
export function emberFakturBP(status: StatusFakturBP): EmberFakturBP {
  if (status === "tiba") return "tiba";
  if (status === "batal") return "batal";
  return "butuh_aksi";
}

/** Faktur ini masih menuntut pekerjaan? Dipakai mengurut "yang perlu diurus dulu". */
export function butuhAksiBP(status: StatusFakturBP): boolean {
  return emberFakturBP(status) === "butuh_aksi";
}

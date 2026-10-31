/**
 * PROFIL USAHA — yang diisi pemilik saat membuat perusahaan dari halaman
 * welcome (`POST /onboarding/perusahaan`).
 *
 * Satu rumah untuk pilihan dan aturannya: server (zod), web, dan ponsel
 * (mencerminkan daftar yang sama) membaca dari sini, jadi form tak pernah
 * menawarkan pilihan yang ditolak server — atau sebaliknya.
 */

/** Jenis usaha — kode disimpan di `companies.jenis_usaha`, label untuk layar. */
export const JENIS_USAHA = [
  { kode: "warung_makan", label: "Warung / rumah makan" },
  { kode: "kafe_kopi", label: "Kafe & kedai kopi" },
  { kode: "bakso_mie", label: "Bakso & mie" },
  { kode: "minuman", label: "Minuman (es teh, jus, boba)" },
  { kode: "roti_camilan", label: "Roti, kue & camilan" },
  { kode: "katering", label: "Katering" },
  { kode: "lainnya", label: "Lainnya" },
] as const;

export type JenisUsaha = (typeof JENIS_USAHA)[number]["kode"];

export const KODE_JENIS_USAHA = JENIS_USAHA.map((j) => j.kode) as [JenisUsaha, ...JenisUsaha[]];

export function labelJenisUsaha(kode: string | null | undefined): string | null {
  return JENIS_USAHA.find((j) => j.kode === kode)?.label ?? null;
}

/**
 * Zona waktu Indonesia. Dipilih SEKALI saat perusahaan dibuat — menentukan
 * kapan "hari ini" berganti untuk laporan, absensi, dan struk — dan tak bisa
 * diubah sesudahnya (`zona-waktu-satu-suara.test.ts`): data yang sudah
 * bertanggal tak ikut bergeser.
 *
 * `offsetJam` dipakai ponsel (Dart tak membawa basis data zona); Indonesia
 * tak mengenal jam musim panas, jadi offset tetap itu tepat sepanjang tahun.
 */
export const ZONA_WAKTU = [
  { kode: "Asia/Jakarta", label: "WIB — Jawa, Sumatra, Kalbar, Kalteng", singkat: "WIB", offsetJam: 7 },
  { kode: "Asia/Makassar", label: "WITA — Bali, NTB, NTT, Sulawesi, Kalsel, Kaltim", singkat: "WITA", offsetJam: 8 },
  { kode: "Asia/Jayapura", label: "WIT — Maluku, Papua", singkat: "WIT", offsetJam: 9 },
] as const;

export type ZonaWaktu = (typeof ZONA_WAKTU)[number]["kode"];

export const KODE_ZONA_WAKTU = ZONA_WAKTU.map((z) => z.kode) as [ZonaWaktu, ...ZonaWaktu[]];

/** Zona bawaan — sama dengan bawaan kolom `companies.timezone`. */
export const ZONA_BAWAAN: ZonaWaktu = "Asia/Jakarta";

export function singkatanZona(kode: string | null | undefined): string {
  return ZONA_WAKTU.find((z) => z.kode === kode)?.singkat ?? kode ?? "WIB";
}

/** Batas panjang & pola — dipakai zod server dan validasi form klien. */
export const PROFIL_USAHA = {
  namaMaks: 80,
  alamatMin: 5,
  alamatMaks: 300,
  /** 8–15 digit, boleh diawali `+`, boleh spasi/tanda hubung di antaranya. */
  polaTelepon: /^\+?[0-9][0-9 -]{6,18}[0-9]$/,
} as const;

/** Body `POST /onboarding/perusahaan`. */
export interface BuatPerusahaanBody {
  nama: string;
  jenis_usaha: JenisUsaha;
  alamat: string;
  telepon: string;
  /** bawaan `Asia/Jakarta` bila tak dikirim */
  timezone?: ZonaWaktu;
}

/**
 * Validasi form profil di klien — kalimat yang sama dengan pesan zod server.
 * `null` = sah.
 */
export function validasiProfilUsaha(b: {
  nama: string;
  jenis_usaha: string;
  alamat: string;
  telepon: string;
}): string | null {
  if (!b.nama.trim()) return "Nama usaha wajib diisi";
  if (b.nama.trim().length > PROFIL_USAHA.namaMaks) return `Nama usaha maksimal ${PROFIL_USAHA.namaMaks} huruf`;
  if (!KODE_JENIS_USAHA.includes(b.jenis_usaha as JenisUsaha)) return "Pilih jenis usaha";
  if (b.alamat.trim().length < PROFIL_USAHA.alamatMin) return "Alamat wajib diisi";
  if (b.alamat.trim().length > PROFIL_USAHA.alamatMaks) return `Alamat maksimal ${PROFIL_USAHA.alamatMaks} huruf`;
  if (!PROFIL_USAHA.polaTelepon.test(b.telepon.trim())) return "No. HP/telepon tidak valid (8–15 angka)";
  return null;
}

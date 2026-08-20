/**
 * Logika murni absensi & kode karyawan — dipakai server (generate kode,
 * tentukan cap berikutnya) dan bisa diuji tanpa database.
 */
import type { AbsensiTipe } from "./types";

// Catatan: kode karyawan kini 8 digit acak (numerik) yang di-generate di server
// (lihat apps/server/src/modules/users/service.ts) — bukan lagi inisial nama.

/**
 * Cap absensi berikutnya berdasarkan cap TERAKHIR hari ini:
 *  - belum ada / terakhir "keluar" → "masuk" (mulai/awali sesi hadir);
 *  - terakhir "masuk"              → "keluar" (pulang / akhiri sesi).
 */
export function absenTipeBerikutnya(last: AbsensiTipe | null | undefined): AbsensiTipe {
  return last === "masuk" ? "keluar" : "masuk";
}

/**
 * Selisih maksimum antara cap masuk dan cap pulangnya ketika keduanya jatuh di
 * TANGGAL berbeda — shift yang melewati tengah malam.
 *
 * 12 jam sengaja tidak dibuat lebih longgar: ia menampung shift tutup
 * terpanjang yang masuk akal (22:00 → 10:00), tapi tidak menjangkau cap masuk
 * KEMARIN PAGI yang lupa ditutup. Kalau yang itu ikut terjangkau, cap masuk
 * PAGI INI malah berubah jadi cap pulang — orang yang baru datang tercatat
 * baru saja pulang.
 */
export const BATAS_LINTAS_HARI_JAM = 12;

/** Satu cap absensi, secukupnya untuk menilai sesi hadir. */
export interface CapAbsen {
  tipe: AbsensiTipe;
  /** waktu cap, epoch milidetik */
  waktu_ms: number;
  /** tanggal bisnis yang menaungi cap itu (YYYY-MM-DD) */
  tanggal: string;
}

/**
 * Sesi hadir yang MASIH TERBUKA pada saat `pada_ms` — yaitu cap "masuk" yang
 * belum ada cap pulangnya. Mengembalikan cap masuk itu, atau null bila orangnya
 * memang tidak sedang hadir.
 *
 * Dua cap dipertimbangkan, karena alternasi masuk↔keluar tidak selalu duduk di
 * satu tanggal:
 *  - `cap_hari_ini`      — cap terakhir pada tanggal bisnis `pada_ms` sendiri;
 *  - `cap_hari_sebelumnya` — cap terakhir pada tanggal SEBELUM itu.
 *
 * Bila tanggal ini belum punya cap sama sekali, cap terakhir kemarin ikut
 * dilihat: shift tutup (masuk 22:00, pulang 02:00) menaruh kedua capnya di dua
 * tanggal, dan tanpa langkah ini cap pulangnya tak punya pasangan untuk
 * ditutup. Hanya berlaku dalam `BATAS_LINTAS_HARI_JAM` — di luar itu cap masuk
 * kemarin dianggap ditinggalkan, bukan sesi yang masih berjalan.
 */
export function sesiHadirTerbuka(
  cap_hari_ini: CapAbsen | null | undefined,
  cap_hari_sebelumnya: CapAbsen | null | undefined,
  pada_ms: number,
): CapAbsen | null {
  if (cap_hari_ini) return cap_hari_ini.tipe === "masuk" ? cap_hari_ini : null;
  if (cap_hari_sebelumnya?.tipe !== "masuk") return null;
  const jam = (pada_ms - cap_hari_sebelumnya.waktu_ms) / 3_600_000;
  // jam < 0 = cap "sebelumnya" ternyata terjadi SESUDAH saat yang dinilai
  // (mungkin karena mewarisi tanggal shift); ia bukan sesi yang sedang berjalan.
  return jam >= 0 && jam <= BATAS_LINTAS_HARI_JAM ? cap_hari_sebelumnya : null;
}

/**
 * Cap berikutnya untuk seorang karyawan: tipenya, dan tanggal bisnis yang harus
 * dipakai.
 *
 * `tanggal_sesi` non-null berarti cap ini menutup sesi yang dibuka di tanggal
 * LAIN (shift lewat tengah malam) dan wajib MEWARISI tanggal itu — supaya
 * sepasang cap satu shift duduk di satu baris rekap, bukan terbelah jadi dua
 * hari yang masing-masing tanpa pasangan.
 */
export function capAbsenBerikutnya(
  cap_hari_ini: CapAbsen | null | undefined,
  cap_hari_sebelumnya: CapAbsen | null | undefined,
  pada_ms: number,
): { tipe: AbsensiTipe; tanggal_sesi: string | null } {
  const buka = sesiHadirTerbuka(cap_hari_ini, cap_hari_sebelumnya, pada_ms);
  return { tipe: absenTipeBerikutnya(buka?.tipe ?? null), tanggal_sesi: buka?.tanggal ?? null };
}

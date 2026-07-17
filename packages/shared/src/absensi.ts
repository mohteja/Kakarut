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

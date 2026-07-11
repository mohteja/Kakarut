/**
 * Logika murni absensi & kode karyawan — dipakai server (generate kode,
 * tentukan cap berikutnya) dan bisa diuji tanpa database.
 */
import type { AbsensiTipe } from "./types";

/**
 * Kode karyawan ringkas dari nama, untuk absensi cepat (ketik/scan QR):
 *  - ≥2 kata → inisial tiap kata (maks 4), mis. "Budi Santoso" → "BS".
 *  - 1 kata  → 3 huruf pertama, mis. "Teja" → "TEJ".
 * Selalu huruf besar; fallback "K" bila nama tak berhuruf. Keunikan per
 * perusahaan ditangani terpisah (menambah angka bila bentrok).
 */
export function kodeKaryawanDariNama(nama: string): string {
  const kata = nama
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (kata.length === 0) return "K";
  if (kata.length >= 2) {
    const inisial = kata
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 4);
    return inisial.length >= 2 ? inisial : kata[0].slice(0, 3).toUpperCase();
  }
  return kata[0].slice(0, 3).toUpperCase() || "K";
}

/**
 * Cap absensi berikutnya berdasarkan cap TERAKHIR hari ini:
 *  - belum ada / terakhir "keluar" → "masuk" (mulai/awali sesi hadir);
 *  - terakhir "masuk"              → "keluar" (pulang / akhiri sesi).
 */
export function absenTipeBerikutnya(last: AbsensiTipe | null | undefined): AbsensiTipe {
  return last === "masuk" ? "keluar" : "masuk";
}

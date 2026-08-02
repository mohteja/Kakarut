import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hanyaMilikSendiri } from "../src/modules/pengajuan/routes";

/**
 * Penjaga LAYAR "PENGAJUAN CUTI & LIBUR SAYA".
 *
 * `GET /pengajuan` punya DUA cakupan dalam satu endpoint: milik sendiri untuk
 * peran yang terkunci cabang, seperusahaan untuk owner/admin. Yang menentukan
 * mana yang didapat adalah PERAN pemanggil — bukan layar yang memintanya.
 *
 * Di situlah cacatnya hidup: bagian "Pengajuan saya" di halaman Absen memanggil
 * endpoint itu tanpa parameter apa pun. Untuk kasir/tim hasilnya benar, jadi
 * layarnya terbaca wajar. Untuk owner/admin ia memajang pengajuan SELURUH
 * karyawan sebagai milik sendiri — lengkap dengan alasan pribadinya, dan
 * lengkap dengan tombol "Batalkan" yang memang dituruti server untuk manajemen
 * (`DELETE /pengajuan/:id` mengizinkan owner/admin menghapus milik siapa pun).
 * Owner yang merasa membatalkan pengajuannya sendiri menghapus pengajuan orang
 * lain, dan tak ada satu pun di layar itu yang mengatakan bedanya.
 *
 * Karena itu aturannya kini eksplisit: `?saya=1` mempersempit untuk SEMUA
 * peran, dan peran terkunci cabang tetap dipersempit tanpa diminta.
 */
describe("cakupan GET /pengajuan", () => {
  const TERKUNCI = ["cashier", "tim", "kitchen", "bar"];
  const MANAJEMEN = ["owner", "admin"];

  it("?saya=1 mempersempit untuk SEMUA peran — termasuk owner/admin", () => {
    for (const role of [...MANAJEMEN, ...TERKUNCI]) {
      expect(hanyaMilikSendiri(role, "1"), role).toBe(true);
    }
  });

  it("peran terkunci cabang dipersempit walau tak meminta", () => {
    for (const role of TERKUNCI) {
      expect(hanyaMilikSendiri(role, undefined), role).toBe(true);
    }
  });

  it("owner/admin tanpa ?saya= tetap melihat seperusahaan (papan ACC)", () => {
    // Rekap Absen memang butuh daftar lintas karyawan untuk memutuskan.
    for (const role of MANAJEMEN) {
      expect(hanyaMilikSendiri(role, undefined), role).toBe(false);
    }
  });

  it("nilai lain tidak diperlakukan seperti '1'", () => {
    // Supaya `?saya=0` atau `?saya` kosong tak diam-diam mempersempit —
    // papan ACC yang tiba-tiba kosong sama membingungkannya.
    for (const nilai of ["0", "", "true", "ya"]) {
      expect(hanyaMilikSendiri("owner", nilai), nilai).toBe(false);
    }
  });
});

/**
 * Pemanggilnya harus BENAR-BENAR meminta.
 *
 * Aturan di atas menjaga nol hal kalau layarnya tetap memanggil `/pengajuan`
 * telanjang — itu persis bentuk cacatnya semula.
 */
describe("layar 'Pengajuan saya' meminta cakupan sendiri", () => {
  const bagian = readFileSync(
    fileURLToPath(new URL("../../web/src/components/PengajuanCutiSection.tsx", import.meta.url)),
    "utf8",
  );

  it("PengajuanCutiSection memanggil /pengajuan?saya=1", () => {
    expect(bagian).toMatch(/api<PengajuanRow\[\]>\("\/pengajuan\?saya=1"\)/);
  });

  it("tak ada lagi pemanggilan /pengajuan telanjang di bagian itu", () => {
    expect(bagian).not.toMatch(/api<PengajuanRow\[\]>\("\/pengajuan"\)/);
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Penjaga GALAT ABSEN — kegagalan harus melekat pada orang yang benar.
 *
 * Satu mutasi `absen` melayani DUA jalur di halaman yang sama:
 *
 *   - absen SENDIRI      → `POST /absensi/saya`, `kode` = null
 *   - stasiun pindai     → `POST /absensi`, `kode` = karyawan LAIN
 *
 * Suksesnya sudah dinaikkan ke kartu hasil bersama di puncak halaman, dan
 * kartu itu menyebut SIAPA yang tercatat (`hasil.nama`, `hasil.employee_code`).
 *
 * Galatnya dulu tidak ikut naik: ia dirender di dalam kartu "Absen Sekarang
 * (swafoto)", yang kalimatnya berbunyi "mencatat kehadiran ANDA SENDIRI".
 * Kedua kartu sama-sama tampil saat `mode === "idle"`, jadi operator yang
 * memindai QR karyawan lain dan ditolak server ("Karyawan tidak ditemukan",
 * "sudah absen pulang", di luar radius) membaca penolakan itu di bawah judul
 * tentang dirinya sendiri.
 *
 * Pesannya benar, penerimanya salah — dan di layar absensi itu cukup untuk
 * membuat orang menyimpulkan absennya sendiri bermasalah, lalu mengulang absen
 * yang sebenarnya sudah tercatat.
 */
const HAL = readFileSync(
  fileURLToPath(new URL("../../web/src/pages/absen/AbsenPage.tsx", import.meta.url)),
  "utf8",
);

/** Potongan kartu "ABSEN SENDIRI" saja. */
const iSelf = HAL.indexOf("{/* ---- ABSEN SENDIRI (semua peran) ---- */}");
const SELF = HAL.slice(iSelf, HAL.indexOf("{/* ---- STASIUN PINDAI", iSelf));

describe("premis: satu mutasi, dua jalur", () => {
  it("`kode` terisi hanya pada jalur stasiun", () => {
    expect(HAL).toContain("api<AbsenResult>(`/absensi${branchQuery}`, { method: \"POST\", body: { ...body, kode } })");
    expect(HAL).toContain("api<AbsenResult>(`/absensi/saya${branchQuery}`, { method: \"POST\", body })");
  });

  it("dan kedua kartu aksinya sama-sama tampil saat idle", () => {
    expect(HAL).toContain('{mode === "idle" && (');
    expect(HAL).toContain('{mode === "idle" && bisaStasiun && (');
  });
});

describe("galat naik ke tempat bersama, bukan menumpang kartu aksi", () => {
  it("dirender di luar kedua kartu, sebelum pratinjau kamera", () => {
    const iGalat = HAL.indexOf("{absen.error != null && (");
    const iKamera = HAL.indexOf("{/* Preview kamera");
    expect(iGalat, "blok galat bersama tak ditemukan").toBeGreaterThan(0);
    expect(iKamera).toBeGreaterThan(iGalat);
    // dan berada SEBELUM kartu absen sendiri, bukan di dalamnya
    expect(iSelf).toBeGreaterThan(iGalat);
  });

  it("tak ada lagi `ErrorText` mutasi di dalam kartu absen sendiri", () => {
    expect(iSelf, "kartu ABSEN SENDIRI tak ditemukan").toBeGreaterThan(0);
    expect(SELF).not.toContain("<ErrorText error={absen.error} />");
  });

  it("menyebut jalur mana yang gagal — kode karyawan atau diri sendiri", () => {
    expect(HAL).toContain("`Absen kode ${absen.variables.kode} gagal`");
    expect(HAL).toContain('"Absen Anda gagal"');
  });

  it("jalurnya dikenali dari `absen.variables`, bukan state tambahan", () => {
    // `kode` (state input) dikosongkan onSuccess dan tak pernah terisi pada
    // jalur pindai QR, jadi ia bukan penanda jalur yang bisa dipercaya.
    expect(HAL).toContain("{absen.variables?.kode");
  });
});

describe("sifat yang sudah benar dan jangan sampai hilang", () => {
  it("`kameraError` TETAP di kartu absen sendiri — itu memang soal perangkat ini", () => {
    expect(SELF).toContain("{kameraError && (");
  });

  it("kartu hasil sukses tetap menyebut siapa yang tercatat", () => {
    expect(HAL).toContain("{masuk ? \"Selamat datang\" : \"Sampai jumpa\"}, {hasil.nama}!");
    expect(HAL).toContain("{hasil.employee_code} · {hasil.branch_nama}");
  });

  it("galat DAFTAR absensi tetap terpisah dari galat mutasi", () => {
    expect(HAL).toContain("error: gagalDaftar");
    expect(HAL).toContain("{gagalDaftar ? (");
  });
});

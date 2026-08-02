import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Penjaga KOTAK PENCARIAN di halaman Log Galat (super admin).
 *
 * Seluruh isi halaman — kartu angka, chip saringan, DAN kotak pencariannya —
 * dirender di dalam cabang `data`. Selama `data` `undefined`, yang tampil
 * hanyalah `SpinnerAtauGalat`; kotaknya tidak sekadar tersembunyi, ia LEPAS
 * dari DOM, dan fokus ketikan lepas bersamanya.
 *
 * Dulu `cari` masuk lurus ke `queryKey`. Satu ketukan tombol = kunci baru =
 * query yang belum punya cache = `data` undefined pada render yang SAMA. Jadi:
 * ketik "t" → kotaknya lenyap → data tiba → kotak lahir kembali berisi "t"
 * tapi tanpa fokus → huruf berikutnya jatuh ke ruang hampa. Fiturnya ada di
 * layar dan tak bisa dipakai lebih dari satu huruf.
 *
 * Penunda saja TIDAK cukup — ia hanya memindahkan pencabutan itu ke 400 ms
 * kemudian, tepat saat orangnya masih mengetik. Yang menyembuhkan adalah
 * `placeholderData`: hasil lama ditahan selama yang baru diambil, jadi tak ada
 * satu render pun tanpa `data`. Keduanya dipasang, dan uji ini memaku keduanya.
 */
const baca = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const tanpaKomentar = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");

const HALAMAN = tanpaKomentar(baca("../../web/src/pages/superadmin/ErrorLogPage.tsx"));

describe("premis: kotaknya memang ikut lepas saat `data` kosong", () => {
  it("kotak pencarian dirender DI DALAM cabang `data`, sesudah spinnernya", () => {
    // Kalau suatu saat kotaknya dipindah ke luar gerbang ini, bahayanya hilang
    // dan penjagaan di bawah boleh ditinjau ulang — biar gugur dengan berisik,
    // jangan diam-diam jadi uji yang menjaga sesuatu yang sudah tak ada.
    const iGerbang = HALAMAN.indexOf("{!data ? (");
    const iSpinner = HALAMAN.indexOf("<SpinnerAtauGalat");
    const iKotak = HALAMAN.indexOf("value={cari}");
    expect(iGerbang, "gerbang `!data` tak ditemukan").toBeGreaterThan(0);
    expect(iSpinner).toBeGreaterThan(iGerbang);
    expect(iKotak, "kotak pencarian tak ditemukan").toBeGreaterThan(iSpinner);
  });

  it("kotaknya memang menyetel state, bukan form tak terkendali", () => {
    expect(HALAMAN).toMatch(/onChange=\{\(e\) => setCari\(e\.target\.value\)\}/);
  });
});

describe("ketikan tidak lagi mencabut kotaknya", () => {
  it("pembuang komentar tidak memakan kodenya", () => {
    expect(HALAMAN).toContain("cariTunda");
    expect(HALAMAN).not.toContain("ruang hampa");
  });

  it("`placeholderData` menahan hasil lama — inilah yang menyelamatkan fokus", () => {
    expect(HALAMAN).toMatch(/placeholderData: \(prev\) => prev/);
  });

  it("ketikan ditunda sebelum jadi kunci, dan timernya dibersihkan", () => {
    const i = HALAMAN.indexOf("const [cariTunda");
    expect(i, "state tunda tak ditemukan").toBeGreaterThan(0);
    const blok = HALAMAN.slice(i, HALAMAN.indexOf("}, [cari]);", i));
    expect(blok, "efek penunda tak berkunci [cari]").not.toBe("");
    expect(blok).toMatch(/setTimeout\(\(\) => setCariTunda\(cari\)/);
    // Tanpa pembersihan, tiap huruf meninggalkan timernya sendiri dan kunci
    // berubah berkali-kali sesudah orangnya berhenti mengetik.
    expect(blok).toMatch(/return \(\) => clearTimeout\(t\)/);
  });

  it("queryKey memakai nilai TERTUNDA, bukan ketikan mentah", () => {
    expect(HALAMAN).toMatch(
      /const kunci = \["admin-error-log", hari, saring, cariTunda\]/,
    );
    expect(HALAMAN).not.toMatch(/\["admin-error-log", hari, saring, cari\]/);
  });

  it("URL-nya memakai nilai yang SAMA dengan kuncinya", () => {
    // Kunci tertunda + URL mentah = dua permintaan berbeda berbagi satu entri
    // cache: hasil huruf lama tersimpan sebagai jawaban huruf baru.
    const i = HALAMAN.indexOf("queryFn:");
    const blok = HALAMAN.slice(i, HALAMAN.indexOf("placeholderData", i));
    expect(blok).toMatch(/encodeURIComponent\(cariTunda\)/);
    expect(blok).not.toMatch(/encodeURIComponent\(cari\)/);
  });

  it("saat hasil di layar masih milik saringan lama, itu dikatakan", () => {
    expect(HALAMAN).toMatch(/isFetching && <span/);
  });
});

/**
 * Dua pola rumah yang dipinjam di atas — merekalah yang menjadikan absennya di
 * halaman ini sebuah kelalaian, bukan pilihan desain.
 */
describe("pola rumahnya tetap ada di tempat asalnya", () => {
  it("TambahStokPage masih menahan hasil lama saat filter berganti", () => {
    expect(baca("../../web/src/pages/produksi/TambahStokPage.tsx")).toMatch(
      /placeholderData: \(prev\) => prev/,
    );
  });

  it("LaporanHargaModal masih menunda ketikan sebelum jadi kunci", () => {
    const src = baca("../../web/src/pages/produksi/LaporanHargaModal.tsx");
    expect(src).toMatch(/setTimeout\(\(\) => setKunciTunda\(kunci\)/);
    expect(src).toMatch(/return \(\) => clearTimeout\(t\)/);
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { angkaDari } from "@kakarut/shared";

/**
 * Penjaga HARGA SALAH KETIK di modal "Stok Masuk — Perlengkapan".
 *
 * Kolom Total harga di modal itu boleh dikosongkan: kosong berarti "pakai
 * perkiraan" (qty × harga beli), dan perkiraannya memang dikirim sebagai angka
 * nyata. Yang tak dijaga adalah kolom yang TERISI tapi tak terbaca.
 *
 * Rantainya: `angkaDari("50 rb")` → NaN → `JSON.stringify` mengubah NaN jadi
 * `null` → zod `total_harga: z.number().min(0).nullish()` MENERIMA null →
 * server menulis `totalHarga: body.total_harga ?? null` apa adanya.
 *
 * Jadi barang masuk ke stok TANPA biaya sama sekali. Dan perhatikan arahnya:
 * salah ketik lebih buruk daripada tidak mengetik apa-apa — yang mengosongkan
 * kotak membukukan perkiraan yang benar, yang mengetik "50 rb" membukukan nol.
 * Tak ada satu pun tanda di layar bahwa harganya hilang.
 *
 * Modal sebelah di berkas yang sama (`StokAwalModal`) sudah menjaga hal yang
 * persis sama sejak awal — itulah yang menjadikan absennya di sini kelalaian,
 * bukan pilihan desain.
 */
const baca = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const tanpaKomentar = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");

const TAB = tanpaKomentar(baca("../../web/src/pages/stok/StokPerlengkapanTab.tsx"));
const RUTE = baca("../src/modules/perlengkapan/routes.ts");
const iMasuk = TAB.indexOf("function MasukModal");
const MASUK = TAB.slice(iMasuk, TAB.indexOf("function MintaModal", iMasuk));

describe("premis: NaN benar-benar sampai ke DB sebagai 'tanpa biaya'", () => {
  it("harga salah ketik memang tak terbaca", () => {
    for (const t of ["50 rb", "50rb", "lima puluh ribu", "50.000,-x"]) {
      expect(Number.isNaN(angkaDari(t)), `"${t}" ternyata terbaca`).toBe(true);
    }
    // Yang WAJAR harus tetap lolos, kalau tidak penjaganya menghalangi orang benar.
    expect(angkaDari("50000")).toBe(50000);
    expect(angkaDari("50.000")).toBe(50000);
    expect(angkaDari("Rp 50.000")).toBe(50000);
  });

  it("NaN jadi null begitu dikirim sebagai JSON", () => {
    expect(JSON.parse(JSON.stringify({ total_harga: Number.NaN }))).toEqual({
      total_harga: null,
    });
  });

  it("zod server MENERIMA null, dan server menyimpannya apa adanya", () => {
    expect(RUTE).toMatch(/total_harga: z\.number\(\)\.min\(0\)\.nullish\(\)/);
    expect(RUTE).toMatch(/totalHarga: body\.total_harga \?\? null/);
  });

  it("kosong berarti PERKIRAAN — jadi salah ketik lebih buruk dari kosong", () => {
    expect(MASUK).toMatch(/const perkiraan = angkaDari\(qty\) > 0/);
    expect(MASUK).toMatch(/: perkiraan,/);
  });
});

describe("harga tak terbaca ditahan sebelum terkirim", () => {
  it("pembuang komentar tidak memakan kodenya", () => {
    expect(MASUK).toContain("hargaSalahKetik");
    expect(MASUK).not.toContain("membukukan nol");
  });

  it("penjaganya ada dan hanya menyala saat kotaknya TERISI", () => {
    expect(MASUK).toMatch(
      /const hargaSalahKetik = totalHarga\.trim\(\) !== "" && !\(angkaDari\(totalHarga\) >= 0\)/,
    );
  });

  it("tombol Simpan terkunci olehnya", () => {
    const i = MASUK.indexOf("kirim.mutate()");
    expect(i, "tombol simpan tak ditemukan").toBeGreaterThan(0);
    expect(MASUK.slice(i, i + 200)).toMatch(/disabled=\{[^}]*hargaSalahKetik/);
  });

  it("muatan memakai `trim()` yang SAMA dengan penjaganya", () => {
    // Kalau hanya penjaganya yang trim, ketikan " " lolos penjagaan lalu tetap
    // jadi NaN di muatan — celah yang sama, cuma lebih sempit.
    expect(MASUK).toMatch(/total_harga: totalHarga\.trim\(\) !== "" \? angkaDari\(totalHarga\)/);
    expect(MASUK).not.toMatch(/total_harga: totalHarga !== "" \?/);
  });

  it("alasannya tampil di layar, bukan cuma tombol mati", () => {
    expect(MASUK).toMatch(/\{hargaSalahKetik && \(/);
    expect(MASUK).toMatch(/Total harga tidak terbaca/);
  });

  it("qty tetap dijaga seperti sebelumnya", () => {
    expect(MASUK).toMatch(/!\(angkaDari\(qty\) > 0\)/);
  });
});

/**
 * Kembarannya yang sudah benar sejak awal, di BERKAS YANG SAMA — dialah bukti
 * bahwa ini pola rumah, bukan penambahan sepihak.
 */
describe("pola rumahnya tetap ada di modal sebelah", () => {
  it("StokAwalModal masih menahan angka tak terbaca", () => {
    const i = TAB.indexOf("function StokAwalModal");
    const blok = TAB.slice(i, TAB.indexOf("function MasukModal", i));
    expect(blok).toMatch(/const salahKetik = rows\.filter\(/);
    expect(blok).toMatch(/disabled=\{[^}]*salahKetik\.length > 0/);
  });

  it("BeliPerlengkapanPage masih menahan harga tak terbaca", () => {
    expect(tanpaKomentar(baca("../../web/src/pages/perlengkapan/BeliPerlengkapanPage.tsx"))).toMatch(
      /const hargaSalahKetik = barisMenunggu\.filter\(/,
    );
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { angkaDari, hitungPb1 } from "@kakarut/shared";

/**
 * Penjaga PERSENTASE SALAH KETIK di Pengaturan Perusahaan.
 *
 * Tiga kotak di halaman itu — tarif PB1, diskon maksimal kasir, ambang food
 * cost — memakai `angkaDari(x) || 0`, bentuk yang dilarang terang-terangan
 * oleh docstring `angkaDari` sendiri. Larangannya berlaku persis di sini,
 * sebab nol memang nilai yang SAH untuk ketiganya: begitu salah ketik jatuh
 * ke 0, ia tak bisa dibedakan dari nol yang disengaja.
 *
 * Yang membuatnya mudah terjadi: kotaknya berlabel "%", dan mengetik tanda
 * persennya adalah hal paling wajar di dunia. "10%" → NaN → 0.
 *
 * Yang paling sunyi adalah PB1. `pb1_enabled` tetap menyala, tapi tarifnya 0,
 * jadi struk tetap mencetak baris PB1 sebesar Rp 0 dan pajaknya berhenti
 * dipungut pada SETIAP penjualan sesudahnya — tanpa satu pun tanda di layar.
 */
const baca = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const tanpaKomentar = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");

const HAL = tanpaKomentar(baca("../../web/src/pages/pengaturan/PerusahaanPage.tsx"));
const JUAL = baca("../src/modules/penjualan/service.ts");

describe("premis: ketikan wajar jatuh ke nol, dan nol itu bermakna", () => {
  it("angka berlabel persen yang lazim diketik memang tak terbaca", () => {
    for (const t of ["10%", "10 %", "10,5%", "2.5%"]) {
      expect(Number.isNaN(angkaDari(t)), `"${t}" ternyata terbaca`).toBe(true);
      expect(angkaDari(t) || 0, `"${t}" tidak jatuh ke 0`).toBe(0);
    }
    // Yang wajar harus tetap lolos — penjaganya tak boleh menghalangi orang benar.
    expect(angkaDari("10")).toBe(10);
    expect(angkaDari("10,5")).toBe(10.5);
    expect(angkaDari("0")).toBe(0);
  });

  it("`angkaDari` memang melarang bentuk `|| 0`, dengan alasan yang sama", () => {
    expect(baca("../../../packages/shared/src/angka.ts")).toMatch(
      /Sengaja TIDAK memulangkan 0/,
    );
  });

  it("PB1 tarif 0 = pajak berhenti dipungut, bukan galat", () => {
    expect(hitungPb1(100_000, 10)).toBe(10_000);
    expect(hitungPb1(100_000, 0)).toBe(0);
  });

  it("diskon maksimal 0 menolak diskon apa pun di atas 0,5%", () => {
    expect(JUAL).toMatch(/pctEfektif > company\.diskonMaksPersen \+ 0\.5/);
  });
});

describe("persentase tak terbaca ditahan sebelum tersimpan", () => {
  it("pembuang komentar tidak memakan kodenya", () => {
    expect(HAL).toContain("persenSalahKetik");
    expect(HAL).not.toContain("berhenti dipungut");
  });

  it("penjaganya meliput KETIGA kotak, bukan cuma PB1", () => {
    const i = HAL.indexOf("const persenSalahKetik");
    expect(i, "penjaga tak ditemukan").toBeGreaterThan(0);
    const blok = HAL.slice(i, HAL.indexOf(".map(([label]) => label)", i));
    for (const v of ["pb1Rate", "diskonMaksPersen", "foodCostMaks"]) {
      expect(blok, `${v} tak ikut dijaga`).toContain(v);
    }
  });

  it("hanya kotak TERISI yang ditahan — kosong tetap berarti nol", () => {
    const i = HAL.indexOf("const persenSalahKetik");
    const blok = HAL.slice(i, HAL.indexOf(".map(([label]) => label)", i));
    expect(blok).toMatch(/v\.trim\(\) !== "" && Number\.isNaN\(angkaDari\(v\)\)/);
  });

  it("tombol Simpan terkunci olehnya", () => {
    const i = HAL.indexOf("simpan.mutate()");
    expect(i, "tombol simpan tak ditemukan").toBeGreaterThan(0);
    expect(HAL.slice(i, i + 220)).toMatch(/disabled=\{[^}]*persenSalahKetik\.length > 0/);
  });

  it("kotak mana yang salah disebut namanya di layar", () => {
    // Tiga kotak dalam satu halaman: "ada yang salah" tanpa menyebut yang mana
    // memaksa orang menebak, dan yang paling gampang terlewat justru PB1.
    expect(HAL).toMatch(/\{persenSalahKetik\.length > 0 && \(/);
    expect(HAL).toMatch(/persenSalahKetik\.join\(", "\)/);
    expect(HAL).toContain("Tarif PB1");
  });
});

/**
 * Pola rumahnya di halaman lain — merekalah yang menjadikan absennya di sini
 * kelalaian, bukan pilihan desain.
 */
describe("pola rumahnya tetap ada di tempat lain", () => {
  it.each([
    ["../../web/src/pages/stok/StokPerlengkapanTab.tsx", /const salahKetik = rows\.filter\(/],
    [
      "../../web/src/pages/perlengkapan/BeliPerlengkapanPage.tsx",
      /const hargaSalahKetik = barisMenunggu\.filter\(/,
    ],
  ])("%s masih menahan angka tak terbaca", (berkas, pola) => {
    expect(tanpaKomentar(baca(berkas))).toMatch(pola);
  });
});

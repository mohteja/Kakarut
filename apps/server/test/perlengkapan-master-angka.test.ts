import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { angkaDari } from "@kakarut/shared";

/**
 * Penjaga ANGKA SALAH KETIK di halaman master Perlengkapan.
 *
 * Tiga kotak angka di halaman ini memakai `angkaDari(x) || <bawaan>`. Yang
 * paling mahal bukan yang jatuh ke 0, melainkan yang jatuh ke 1:
 *
 * `per_hari` di Aturan Konsumsi berlabel "Setiap … hari", dan server memakainya
 * sebagai JARAK antar potongan terjadwal (`langkah = perHari * HARI_MS`).
 * Mengetik "30 hari" — NaN — mendarat di 1, jadi potongan yang dimaksudkan
 * sebulan sekali berjalan SETIAP HARI. Stoknya terkuras 30× lebih cepat, terus
 * menerus, tanpa ada yang menekan tombol apa pun.
 *
 * Dan penggantinya bukan sentinel yang mencurigakan: 1 adalah bawaan sekaligus
 * nilai yang paling lazim, jadi layarnya terlihat wajar sesudahnya.
 *
 * Dua pagar yang tampak menjaga ternyata tidak: `min`/`max` di kotaknya hanya
 * berlaku untuk `type="number"` sementara kotak ini `type="text"`, dan zod
 * server tak pernah kebagian menolak karena `|| 1` sudah menelan NaN di klien.
 */
const baca = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const tanpaKomentar = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");

const HAL = tanpaKomentar(baca("../../web/src/pages/perlengkapan/PerlengkapanPage.tsx"));
const RUTE = baca("../src/modules/perlengkapan/routes.ts");
const SVC = baca("../src/modules/perlengkapan/service.ts");
const iAturan = HAL.indexOf("function AturanModal");
const ATURAN = iAturan > 0 ? HAL.slice(iAturan) : "";

describe("premis: `per_hari` adalah jarak jadwal, bukan angka hiasan", () => {
  it("server memakainya sebagai langkah waktu antar potongan", () => {
    expect(SVC).toMatch(/const langkah = perHari \* HARI_MS/);
  });

  it("kotaknya memang berlabel 'Setiap … hari'", () => {
    expect(ATURAN, "AturanModal tak ditemukan").not.toBe("");
    expect(ATURAN).toContain("Setiap … hari");
  });

  it("ketikan wajar di kotak itu tak terbaca, dan bawaannya justru 1", () => {
    for (const t of ["30 hari", "30hr", "sebulan"]) {
      expect(Number.isNaN(angkaDari(t)), `"${t}" ternyata terbaca`).toBe(true);
      expect(angkaDari(t) || 1, `"${t}" tidak jatuh ke 1`).toBe(1);
    }
    expect(angkaDari("30")).toBe(30);
  });

  it("`min`/`max` di kotaknya tidak mengikat — kotaknya `type=\"text\"`", () => {
    const i = ATURAN.indexOf("Setiap … hari");
    const blok = ATURAN.slice(i, i + 320);
    expect(blok).toMatch(/type="text"/);
    expect(blok).toMatch(/min=\{1\} max=\{365\}/);
  });

  it("zod server tak pernah kebagian menolaknya", () => {
    // Kalau suatu saat klien mengirim NaN/0 apa adanya, zod inilah yang menahan
    // — tapi selama `|| 1` ada, ia tak pernah melihat nilai di luar rentang.
    expect(RUTE).toMatch(/per_hari: z\.number\(\)\.int\(\)\.min\(1\)\.max\(365\)/);
  });
});

describe("jadwal tak terbaca ditahan sebelum tersimpan", () => {
  it("pembuang komentar tidak memakan kodenya", () => {
    expect(ATURAN).toContain("perHariSalahKetik");
    expect(ATURAN).not.toContain("30× lebih cepat");
  });

  it("penjaganya menuntut angka ≥ 1, bukan sekadar terbaca", () => {
    expect(ATURAN).toMatch(
      /const perHariSalahKetik = perHari\.trim\(\) !== "" && !\(angkaDari\(perHari\) >= 1\)/,
    );
  });

  it("tombol Simpan Aturan terkunci olehnya — hanya di mode otomatis", () => {
    // Mode manual tak punya jadwal sama sekali; menahannya di sana hanya
    // membuat orang buntu tanpa sebab.
    const i = ATURAN.indexOf("kirim.mutate()");
    expect(i, "tombol tak ditemukan").toBeGreaterThan(0);
    const blok = ATURAN.slice(i, i + 320);
    expect(blok).toMatch(/metode === "otomatis" && \(!\(angkaDari\(qty\) > 0\) \|\| perHariSalahKetik\)/);
  });

  it("akibatnya dikatakan di layar, bukan cuma tombol mati", () => {
    expect(ATURAN).toMatch(/metode === "otomatis" && perHariSalahKetik && \(/);
    expect(ATURAN).toContain("setiap 1 hari");
  });
});

describe("harga beli & stok minimum master juga ditahan", () => {
  it("penjaganya meliput KEDUA kolom", () => {
    const i = HAL.indexOf("const angkaSalahKetik");
    expect(i, "penjaga ItemForm tak ditemukan").toBeGreaterThan(0);
    const blok = HAL.slice(i, HAL.indexOf(".map(([label]) => label)", i));
    expect(blok).toContain("hargaBeli");
    expect(blok).toContain("stokMin");
    expect(blok).toMatch(/v\.trim\(\) !== "" && Number\.isNaN\(angkaDari\(v\)\)/);
  });

  it("tombol Simpan ItemForm terkunci olehnya", () => {
    const i = HAL.indexOf("disabled={!nama.trim()");
    expect(i, "tombol ItemForm tak ditemukan").toBeGreaterThan(0);
    expect(HAL.slice(i, i + 120)).toContain("angkaSalahKetik.length > 0");
  });

  it("harga beli 0 memang merambat ke tempat lain — itu sebabnya dijaga", () => {
    // Perkiraan di modal Stok Masuk lahir dari harga beli master.
    expect(tanpaKomentar(baca("../../web/src/pages/stok/StokPerlengkapanTab.tsx"))).toMatch(
      /angkaDari\(qty\) \* item\.harga_beli/,
    );
  });
});

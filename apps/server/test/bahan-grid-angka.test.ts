import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { angkaDari } from "@kakarut/shared";

/**
 * Penjaga ANGKA TAK TERBACA di dua halaman editor Bahan Baku.
 *
 * Keduanya memakai grid yang SAMA (`BahanEditorGrid`) untuk data yang sama —
 * tapi memperlakukan baris rusak dengan dua cara berbeda:
 *
 * - `UbahBahanBakuPage` menghitung `invalid` lalu MENAHAN tombolnya;
 * - `TambahBahanBakuPage` menyaring `valid` lalu MEMBUANG barisnya.
 *
 * Yang kedua itulah cacatnya. Baris yang sudah dinamai tapi kolom Isi-nya
 * ditulis "1 kg" tersaring keluar tanpa suara: tombol tetap hidup selama ada
 * satu baris lain yang benar, simpan berhasil, halaman langsung pindah ke
 * daftar Bahan — dan bahan yang sudah diketik lengkap tak pernah dibuat.
 *
 * Lima kolom angka opsional di sebelahnya (harga beli, stok minimum, minimal
 * belanja, masa simpan, lead time) punya cacat yang lebih pelan di KEDUA
 * halaman: `angkaDari(x) || 0` menjatuhkan salah ketik ke 0 diam-diam.
 *
 * Aturannya kini satu, dipakai bersama lewat `angkaTakTerbaca` di grid —
 * perbedaan aturan antar halaman itulah yang melahirkan cacat ini.
 */
const baca = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const tanpaKomentar = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");

const GRID = tanpaKomentar(baca("../../web/src/pages/bahan/BahanEditorGrid.tsx"));
const TAMBAH = tanpaKomentar(baca("../../web/src/pages/bahan/TambahBahanBakuPage.tsx"));
const UBAH = tanpaKomentar(baca("../../web/src/pages/bahan/UbahBahanBakuPage.tsx"));

describe("premis: baris rusak benar-benar hilang tanpa suara", () => {
  it("ketikan wajar di kolom Isi memang tak terbaca", () => {
    for (const t of ["1 kg", "200 gram", "1/2"]) {
      expect(Number.isNaN(angkaDari(t)), `"${t}" ternyata terbaca`).toBe(true);
    }
    expect(angkaDari("200")).toBe(200);
    expect(angkaDari("1.000")).toBe(1000);
  });

  it("muatan Tambah hanya berisi baris `valid` — sisanya tak ikut terkirim", () => {
    expect(TAMBAH).toMatch(/const valid = rows\.filter\(/);
    expect(TAMBAH).toMatch(/items: valid\.map\(/);
  });

  it("sukses langsung berpindah halaman, jadi tak ada kesempatan sadar", () => {
    const i = TAMBAH.indexOf("onSuccess:");
    expect(TAMBAH.slice(i, i + 260)).toMatch(/navigate\("\/bahan"\)/);
  });

  it("lima kolom opsional itu memang dikirim lewat `|| 0` di kedua halaman", () => {
    for (const [nama, src] of [
      ["Tambah", TAMBAH],
      ["Ubah", UBAH],
    ] as const) {
      expect(src, `${nama}: harga_beli`).toMatch(/harga_beli: angkaDari\(b\.harga_beli\) \|\| 0/);
      expect(src, `${nama}: masa_simpan`).toMatch(/angkaDari\(b\.masa_simpan\) \|\| 0/);
    }
  });
});

describe("aturannya satu, tinggal di grid bersama", () => {
  it("pembuang komentar tidak memakan kodenya", () => {
    expect(GRID).toContain("export function angkaTakTerbaca");
    expect(GRID).not.toContain("tak pernah dibuat");
  });

  it("penolongnya meliput kelima kolom opsional", () => {
    const i = GRID.indexOf("export function angkaTakTerbaca");
    const blok = GRID.slice(i, GRID.indexOf("const cell =", i));
    for (const f of ["b.harga_beli", "b.stok_minimum", "b.min_beli", "b.masa_simpan", "b.lead_time"]) {
      expect(blok, `${f} tak ikut`).toContain(f);
    }
    expect(blok).toMatch(/v\.trim\(\) !== "" && Number\.isNaN\(angkaDari\(v\)\)/);
  });

  it("`isi` sengaja TIDAK di penolong — aturannya beda per halaman", () => {
    const i = GRID.indexOf("export function angkaTakTerbaca");
    const blok = GRID.slice(i, GRID.indexOf("const cell =", i));
    expect(blok).not.toContain("b.isi");
  });

  it("kedua halaman memakai penolong yang sama", () => {
    for (const [nama, src] of [
      ["Tambah", TAMBAH],
      ["Ubah", UBAH],
    ] as const) {
      expect(src, `${nama} tak mengimpor penolongnya`).toMatch(
        /import \{ BahanEditorGrid, angkaTakTerbaca/,
      );
      expect(src, `${nama} tak memakainya`).toMatch(/angkaTakTerbaca\(b\)/);
    }
  });
});

describe("Tambah: baris bernama yang rusak ditahan, bukan dibuang", () => {
  it("baris dinamai + Isi tak terbaca dikumpulkan dengan namanya", () => {
    expect(TAMBAH).toMatch(
      /const isiTerbuang = rows\s*\n?\s*\.filter\(\(b\) => b\.nama\.trim\(\) !== "" && !\(angkaDari\(b\.isi\) > 0\)\)/,
    );
  });

  it("baris yang masih KOSONG tetap diabaikan — ia cuma slot", () => {
    // Tanpa pagar nama ini, tiga baris kosong bawaan halaman langsung
    // mengunci tombolnya sejak halaman dibuka.
    expect(TAMBAH).toMatch(/\.filter\(\(b\) => b\.nama\.trim\(\) !== ""\)\s*\n?\s*\.flatMap/);
  });

  it("tombol Simpan terkunci oleh keduanya", () => {
    const i = TAMBAH.indexOf("simpan.mutate()");
    expect(TAMBAH.slice(i, i + 200)).toMatch(/disabled=\{valid\.length === 0 \|\| adaTerbuang/);
    expect(TAMBAH).toMatch(
      /const adaTerbuang = isiTerbuang\.length > 0 \|\| angkaTerbuang\.length > 0/,
    );
  });

  it("bedanya dikatakan di layar: yang hilang vs yang jadi nol", () => {
    expect(TAMBAH).toContain("tidak akan tersimpan");
    expect(TAMBAH).toContain("tersimpan\n              sebagai");
  });
});

describe("Ubah: penjaga lamanya utuh, kolom opsionalnya ikut ditahan", () => {
  it("penjaga nama & konversi yang sudah ada tidak dilonggarkan", () => {
    expect(UBAH).toMatch(
      /const invalid = \(rows \?\? \[\]\)\.filter\(\(b\) => b\.nama\.trim\(\) === "" \|\| !\(angkaDari\(b\.isi\) > 0\)\)/,
    );
  });

  it("tombolnya kini menahan invalid DAN angka opsional yang tak terbaca", () => {
    const i = UBAH.indexOf("simpan.mutate()");
    const blok = UBAH.slice(i, i + 320);
    expect(blok).toMatch(/invalid\.length > 0/);
    expect(blok).toMatch(/angkaTerbuang\.length > 0/);
  });
});

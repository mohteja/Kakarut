import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { galatTerbaru } from "../../web/src/lib/galat";

/**
 * Penjaga GALAT YANG MENEMPEL di layar dengan beberapa mutasi.
 *
 * Bentuk lamanya `a.error || b.error || c.error` memilih yang pertama truthy,
 * bukan yang terbaru. Dan galat sebuah mutasi bertahan sampai mutasi ITU
 * dijalankan lagi — jadi satu kegagalan menempel sebagai spanduk merah di atas
 * semua keberhasilan sesudahnya, tanpa cara menutupnya.
 *
 * Di Penerimaan Barang akibatnya bukan sekadar berisik. Tugas layar itu persis
 * menjawab "barang ini jadi masuk atau tidak"; jawaban merah yang salah membuat
 * setiap jawaban berikutnya ikut tak bisa dipercaya, dan orang gudang mengakhiri
 * sesi dengan yakin ada yang gagal padahal semuanya berhasil.
 *
 * Uji ini menguji PERILAKU fungsinya, bukan cuma teks sumbernya.
 */
const baca = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const tanpaKomentar = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");

const m = (error: unknown, submittedAt: number) => ({ error, submittedAt });

describe("galatTerbaru memilih aksi terakhir, bukan yang pertama", () => {
  it("tak ada galat → null", () => {
    expect(galatTerbaru(m(null, 5), m(null, 9))).toBeNull();
    expect(galatTerbaru()).toBeNull();
  });

  it("aksi terakhir gagal → galatnya tampil", () => {
    const e = new Error("gagal tolak");
    expect(galatTerbaru(m(null, 3), m(e, 9))).toBe(e);
    expect(galatTerbaru(m(e, 9), m(null, 3))).toBe(e);
  });

  it("INTI: gagal duluan lalu BERHASIL belakangan → layar diam", () => {
    // Inilah cacatnya: `tolak` gagal, `terima` berhasil, tapi `tolak.error`
    // tetap terpajang karena ia yang pertama truthy — spanduk merah di atas
    // keberhasilan, tanpa cara menutupnya.
    const tolakGagal = m(new Error("tolak gagal"), 100);
    const terimaBerhasil = m(null, 200);
    // Bentuk lama memang memulangkan galatnya:
    expect(tolakGagal.error || terimaBerhasil.error).toBeTruthy();
    // Bentuk baru bicara tentang aksi TERAKHIR, dan aksi itu berhasil.
    expect(galatTerbaru(tolakGagal, terimaBerhasil)).toBeNull();
  });

  it("memilih 'galat terbaru yang tersisa' TIDAK cukup — bedanya di sini", () => {
    // Jebakan yang mudah: menyaring dulu yang ber-galat, lalu ambil yang
    // submittedAt-nya terbesar. Itu tetap memajang kegagalan lama.
    const gagalLama = m(new Error("lama"), 10);
    const berhasilBaru = m(null, 20);
    const salah = [gagalLama, berhasilBaru]
      .filter((x) => x.error)
      .sort((a, b) => b.submittedAt - a.submittedAt)[0]?.error;
    expect(salah).toBe(gagalLama.error); // bentuk yang salah
    expect(galatTerbaru(gagalLama, berhasilBaru)).toBeNull(); // bentuk yang benar
  });

  it("dua galat → yang submittedAt-nya paling besar", () => {
    const lama = new Error("lama");
    const baru = new Error("baru");
    expect(galatTerbaru(m(lama, 100), m(baru, 200))).toBe(baru);
    // urutan argumen tidak boleh mengubah hasilnya
    expect(galatTerbaru(m(baru, 200), m(lama, 100))).toBe(baru);
  });

  it("mutasi yang belum pernah jalan tak pernah membungkam galat nyata", () => {
    // `submittedAt` 0 selalu kalah dari mutasi mana pun yang sudah dijalankan,
    // jadi tak perlu disaring khusus — apa pun urutan argumennya.
    const e = new Error("nyata");
    expect(galatTerbaru(m(e, 42), m(null, 0))).toBe(e);
    expect(galatTerbaru(m(null, 0), m(e, 1))).toBe(e);
  });
});

describe("kedua layar memakainya, dan rantai `||` sudah hilang", () => {
  it.each([
    ["../../web/src/pages/produksi/PenerimaanPage.tsx", /galatTerbaru\(terima, terimaSebagian, tolak, batalTolak\)/],
    ["../../web/src/pages/pengaturan/MejaPage.tsx", /galatTerbaru\(toggle, hapus, simpanTataLetak\)/],
  ])("%s memakai galatTerbaru", (berkas, pola) => {
    const src = tanpaKomentar(baca(berkas));
    expect(src).toMatch(pola);
    // Rantai `||` di dalam ErrorText adalah bentuk yang diganti — jangan balik.
    expect(src).not.toMatch(/<ErrorText error=\{[^}]*\|\|/);
  });

  it("penolongnya tinggal di modul TS biasa, bukan di dalam .tsx", () => {
    // Bukan selera: tsconfig server tak menyetel `--jsx`, jadi uji ini tak bisa
    // mengimpornya kalau ia tinggal di `ui.tsx` — dan fungsinya memang tak
    // memuat JSX sama sekali.
    expect(baca("../../web/src/lib/galat.ts")).toContain("export function galatTerbaru");
  });
});

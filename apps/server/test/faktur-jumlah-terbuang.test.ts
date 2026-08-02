import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { angkaDari } from "@kakarut/shared";

/**
 * Penjaga BARIS TERBUANG di form faktur produksi/beli.
 *
 * Aplikasi ini sudah empat kali memutuskan bahwa angka yang tak terbaca harus
 * DITAHAN DI FORM, bukan dikirim: `StokAwalPage`, `OpnamePage`,
 * `OpnamePerlengkapanPage`, dan `StokPerlengkapanTab`. Alasannya sama di
 * keempatnya — NaN lolos penyaring `!== ""`, `JSON.stringify` mengubahnya jadi
 * `null`, dan zod server membalas galat yang menyebut INDEKS larik, bukan nama
 * barangnya.
 *
 * Form faktur adalah yang KELIMA, dan justru yang paling sunyi. Penyaringnya
 * bukan `!== ""` melainkan `angkaDari(it.jumlah) > 0`, jadi NaN tidak pernah
 * sampai ke server sama sekali: barisnya dibuang di sisi klien. Tombol Simpan
 * hanya menutup pintu saat SELURUH baris tak valid, jadi satu baris benar sudah
 * cukup untuk menyimpan faktur tanpa bahan yang salah ketik — tanpa galat,
 * tanpa peringatan, tanpa jejak.
 *
 * Yang membuatnya bukan sekadar teoretis: kolom jumlah memang sengaja
 * `type="text"` (komentar di atas `<input>` menjelaskan `type="number"`
 * membuang koma desimal Indonesia diam-diam). Kolom teks bebas mengundang
 * "2 kg" — dan itu NaN.
 */
const baca = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")
    // Komentar dibuang: yang dijaga kodenya, bukan penjelasannya. (Pelajaran
    // dari `semai-saat-buka.test.ts`, yang versi pertamanya memeriksa prosa —
    // dan berkas ini pun menyebut `jumlahTerbuang` di dalam komentarnya.)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

const FAKTUR = baca("../../web/src/pages/produksi/FakturFormPage.tsx");

/**
 * PREMISNYA lebih dulu, karena seluruh temuan ini bergantung padanya: isian
 * yang wajar ditulis orang di kolom jumlah benar-benar menghasilkan NaN, dan
 * NaN benar-benar gagal `> 0` (bukan melempar, bukan jadi 0).
 */
describe("isian yang wajar memang tak terbaca", () => {
  it.each(["2 kg", "2kg", "dua", "1/2", "-", "±3"])("%j → NaN", (teks) => {
    expect(Number.isNaN(angkaDari(teks))).toBe(true);
  });

  it("NaN gagal penyaring `> 0` — jadi barisnya terbuang, bukan terkirim", () => {
    expect(angkaDari("2 kg") > 0).toBe(false);
  });

  it("angka yang benar tetap lolos, termasuk koma desimal", () => {
    for (const [teks, nilai] of [
      ["3", 3],
      ["1,5", 1.5],
      ["1.5", 1.5],
    ] as const) {
      expect(angkaDari(teks)).toBe(nilai);
      expect(angkaDari(teks) > 0).toBe(true);
    }
  });
});

describe("form faktur menahan baris yang tak akan tersimpan", () => {
  it("pembuang komentar tidak memakan kodenya", () => {
    expect(FAKTUR).toContain("const jumlahTerbuang");
    expect(FAKTUR).not.toContain("paling sunyi");
  });

  it("baris berbahan yang jumlahnya terisi tapi tak `> 0` terkumpul", () => {
    const i = FAKTUR.indexOf("const jumlahTerbuang");
    expect(i, "pengumpul baris terbuang tak ditemukan").toBeGreaterThan(0);
    const blok = FAKTUR.slice(i, FAKTUR.indexOf(";", FAKTUR.indexOf(".filter((n)", i)));
    // Ketiganya wajib ada bersama: tanpa `ingredient_id` ia menegur baris
    // kosong; tanpa `trim() !== ""` ia menegur baris yang belum disentuh;
    // tanpa `!(… > 0)` ia hanya menjaring NaN dan melewatkan 0 serta minus,
    // yang nasibnya sama persis.
    expect(blok).toMatch(/it\.ingredient_id/);
    expect(blok).toMatch(/it\.jumlah\.trim\(\) !== ""/);
    expect(blok).toMatch(/!\(angkaDari\(it\.jumlah\) > 0\)/);
  });

  it("tombol Simpan benar-benar terkunci olehnya", () => {
    /*
     * Inti temuan ini. Sebelum perbaikan, `disabled`-nya hanya
     * `itemValid.length === 0` — yang berarti satu baris benar sudah cukup
     * untuk menyimpan faktur tanpa baris yang salah ketik.
     */
    const i = FAKTUR.indexOf("Simpan Faktur");
    expect(i, "tombol Simpan tak ditemukan").toBeGreaterThan(0);
    const tombol = FAKTUR.slice(FAKTUR.lastIndexOf("<button", i), i);
    expect(tombol).toMatch(/disabled=\{[^}]*jumlahTerbuang\.length > 0/);
    // Pagar lama tetap ada — keduanya menjaga hal berbeda.
    expect(tombol).toMatch(/itemValid\.length === 0/);
  });

  it("orangnya diberi tahu bahan MANA, bukan sekadar 'ada yang salah'", () => {
    // Nama bahannya disebut (pola yang sama di empat halaman kembarnya):
    // pada faktur berisi belasan baris, "ada isian salah" tidak menolong.
    expect(FAKTUR).toMatch(/\{jumlahTerbuang\.join\(", "\)\}/);
    expect(FAKTUR).toMatch(/tidak ikut tersimpan/);
  });

  it("namanya diambil dari master bahan jalur ini", () => {
    expect(FAKTUR).toMatch(/bahanJalur\.find\(\(x\) => x\.id === it\.ingredient_id\)\?\.nama/);
  });
});

/**
 * Kembarannya yang sudah benar — dipatok agar tetap begitu, karena merekalah
 * yang menjadikan absennya penjaga di form faktur sebuah kelalaian, bukan
 * pilihan desain.
 */
describe("penjaga salah ketik di halaman kembarnya tetap ada", () => {
  it.each([
    ["../../web/src/pages/stok/OpnamePage.tsx", "s.nama"],
    ["../../web/src/pages/stok/OpnamePerlengkapanPage.tsx", "r.nama"],
    ["../../web/src/pages/stok/StokPerlengkapanTab.tsx", "r.nama"],
  ])("%s masih menahan & menyebut namanya", (berkas, nama) => {
    const src = baca(berkas);
    expect(src).toMatch(/const salahKetik/);
    expect(src).toMatch(/salahKetik\.length > 0/);
    expect(src).toContain(`salahKetik.map((${nama[0]}) => ${nama})`);
  });
});

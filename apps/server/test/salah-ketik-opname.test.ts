import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Penjaga PENANDA SALAH KETIK pada layar hitung-stok — BERPASANGAN.
 *
 * Empat layar menerima angka hitungan fisik dan mengirimnya sebagai larik.
 * Semuanya menyaring baris dengan `!== ""` saja, jadi salah ketik ("abc",
 * "1..5", "Rp") lolos sebagai NaN; `JSON.stringify` mengubah NaN jadi `null`;
 * zod server (`z.number()`) menolak SELURUH kiriman dengan galat yang menyebut
 * INDEKS LARIK, bukan nama barangnya.
 *
 * Bentuk kegagalannya: opname berisi puluhan baris, satu salah ketik, seluruh
 * hitungan ditolak — dan pemakainya harus menebak baris mana yang salah.
 *
 * Yang menulis penjaga itu memikirkannya untuk BAHAN BAKU dan berhenti di
 * sana. Dua layar kembarannya untuk PERLENGKAPAN — endpoint sebangun, pola
 * isian sama, konsekuensi sama — tak ikut dijaga. Halamannya berpasangan;
 * karena itu penjaganya dipatok berpasangan juga, supaya menambah layar
 * hitung-stok ketiga tanpa penanda langsung terlihat.
 */
const akar = fileURLToPath(new URL("../../web/src/pages/stok/", import.meta.url));

/** Layar yang menerima hitungan fisik lalu mengirimnya sebagai larik. */
const LAYAR = [
  { berkas: "OpnamePage.tsx", apa: "opname bahan baku" },
  { berkas: "StokAwalPage.tsx", apa: "stok awal bahan baku" },
  { berkas: "OpnamePerlengkapanPage.tsx", apa: "opname perlengkapan" },
  { berkas: "StokPerlengkapanTab.tsx", apa: "stok awal perlengkapan" },
];

describe("layar hitung stok: salah ketik ditahan di klien, berpasangan", () => {
  for (const { berkas, apa } of LAYAR) {
    const isi = readFileSync(akar + berkas, "utf8");

    it(`${apa} mendeteksi angka tak terbaca`, () => {
      // Yang dicari tandanya, bukan nama variabelnya: NaN diuji atas hasil
      // `angkaDari`. Itulah satu-satunya cara membedakan salah ketik dari nol.
      expect(isi, `${berkas} tak menguji NaN atas angkaDari`).toMatch(
        /Number\.isNaN\(\s*angkaDari\(/,
      );
    });

    it(`${apa} MENAHAN tombol simpannya`, () => {
      // Mendeteksi tanpa menahan cuma hiasan — kirimannya tetap berangkat dan
      // tetap ditolak server dengan pesan yang tak menyebut barangnya.
      expect(isi, `${berkas} tak menonaktifkan tombol saat ada salah ketik`).toMatch(
        /disabled=\{[^}]*salahKetik\.length\s*>\s*0/,
      );
    });

    it(`${apa} menyebut NAMA barang yang salah`, () => {
      // Inti perbaikannya: pemakainya harus tahu baris MANA. Galat server cuma
      // menyebut indeks larik, jadi namanya harus disusun di sini.
      expect(isi, `${berkas} tak menampilkan nama baris yang salah`).toMatch(
        /salahKetik\.map\(/,
      );
    });
  }
});

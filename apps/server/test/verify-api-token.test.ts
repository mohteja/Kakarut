import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Penjaga TOKEN MATI di `scripts/verify-api.sh`.
 *
 * §105 mengganti password kasir. Ganti password menaikkan `token_version`,
 * jadi `$KASIR` MATI sejak detik itu — setiap permintaan yang masih memakainya
 * dibalas 401. Penggantinya adalah `$REISS105`, hasil login ulang di §105.
 *
 * Kenapa ini butuh penjaga sendiri, bukan cuma "hati-hati": kegagalannya
 * MENYAMAR. Uji yang memakai token mati tidak berkata "tokennya mati" — ia
 * berkata "harusnya 200, dapat 401", persis seperti bug produk. Sudah dua kali
 * ronde CI habis mengejar hantu karena itu; yang kedua bahkan sesudah
 * komentarnya diperbaiki, karena yang terlewat adalah satu baris `curl` mentah
 * di bawah komentar yang sudah benar.
 *
 * Dan biayanya asimetris: pemeriksaan ini berjalan di job cepat (detik),
 * sedangkan verify-api butuh Postgres segar (~90 detik) sebelum sempat
 * mengeluh. Lebih baik gagal di sini.
 */
const sh = readFileSync(
  new URL("../../../scripts/verify-api.sh", import.meta.url),
  "utf8",
);

/** `$KASIR` sebagai variabel utuh — BUKAN `$KASIR_EMAIL` / `$KASIR46`. */
const KASIR_UTUH = /\$KASIR(?![A-Za-z0-9_])/;

describe("verify-api.sh: token kasir sesudah §105", () => {
  const baris = sh.split("\n");
  const reissue = baris.findIndex((b) => /^\s*REISS105=/.test(b));

  it("§105 memang me-reissue token kasir ke $REISS105", () => {
    expect(reissue).toBeGreaterThan(-1);
  });

  it("tak ada satu pun pemakaian $KASIR sesudah §105", () => {
    // Komentar dilewati: beberapa bagian sengaja MENJELASKAN kenapa $KASIR
    // tak dipakai lagi, dan penjelasan itu justru yang ingin dipertahankan.
    const pelanggar = baris
      .map((isi, i) => ({ isi, no: i + 1 }))
      .filter(({ isi, no }) => no > reissue + 1)
      .filter(({ isi }) => !/^\s*#/.test(isi))
      .filter(({ isi }) => KASIR_UTUH.test(isi))
      .map(({ isi, no }) => `${no}: ${isi.trim()}`);

    expect(pelanggar).toEqual([]);
  });

  it("§161 (buka kasir berbarengan) memakai token yang masih hidup", () => {
    // Bagian ini satu-satunya yang menembak `curl` langsung alih-alih helper
    // `api`, jadi ia luput dari pembacaan sekilas — dipatok terpisah.
    const b161 = sh.slice(sh.indexOf("── §161"));
    expect(b161.length).toBeGreaterThan(0);
    expect(b161).toContain("Bearer $REISS105");
    expect(KASIR_UTUH.test(b161.replace(/^\s*#.*$/gm, ""))).toBe(false);
  });
});

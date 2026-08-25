import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { butaKomentar } from "../src/scripts/buta-komentar";

/**
 * PROVISI TAMU DI BAWAH DUA BOOT SERENTAK.
 *
 * `penjaga-semua-pintu` menulis titik butanya sendiri: satu `onConflictDoUpdate`
 * di awal badan `provisionGuest` menutupi insert `companies` di bawahnya yang
 * tak berpenjaga. Utang itu kemudian DIUKUR — dua `provisionGuest` dilepas
 * `Promise.all` pada DB tanpa perusahaan demo:
 *
 *     SEBELUM: boot 1 selesai (true) · boot 2 MELEMPAR
 *              `Failed query: insert into "companies" …` mentah
 *     SESUDAH: boot 1 true · boot 2 false · 1 perusahaan · keanggotaan utuh ·
 *              ronde kedua false/false (idempoten penuh)
 *
 * Yang kalah dulu selamat HANYA karena catch pembungkus di `index.ts` — aman
 * karena konjungsi lain, bukan karena aturannya diterapkan. Sekarang aturannya
 * tinggal di tempat lahirnya: `onConflictDoNothing` pada insert perusahaan +
 * jalur kalah yang memastikan keanggotaannya sendiri lalu memulangkan false.
 *
 * Uji ini SOURCE-PIN, bukan balapan hidup: balapan sungguhan butuh Postgres
 * dan TRUNCATE — terlalu mahal untuk suite unit, dan pengukurannya sudah
 * dicatat di atas. Yang dipaku: kedua bagian perbaikannya tak bisa dicabut
 * tanpa uji ini merah.
 */
const SUMBER = butaKomentar(
  readFileSync(fileURLToPath(new URL("../src/seed/guest.ts", import.meta.url)), "utf8"),
);

describe("provisionGuest: balapan dua boot", () => {
  it("insert perusahaan memakai onConflictDoNothing — gerbang balapannya", () => {
    const insertPerusahaan = SUMBER.slice(
      SUMBER.indexOf(".insert(companies)"),
      SUMBER.indexOf(".returning()", SUMBER.indexOf(".insert(companies)")),
    );
    expect(insertPerusahaan, "gerbang balapan provisi tamu dicabut").toContain("onConflictDoNothing");
  });

  it("jalur KALAH idempoten: memastikan keanggotaan, memulangkan false", () => {
    // Tanpa jalur ini, yang kalah memulangkan hasil null dan pemanggilnya
    // meledak di `hasil.hargaByMenuId` — bentuk gagal yang lebih buruk dari
    // yang diperbaiki.
    expect(SUMBER).toContain("if (!company) return null;");
    const kalah = SUMBER.slice(SUMBER.indexOf("if (!hasil)"));
    expect(kalah.slice(0, 400), "jalur kalah kehilangan pastikanKeanggotaan").toContain(
      "pastikanKeanggotaan",
    );
    expect(kalah.slice(0, 400)).toContain("return false;");
  });
});

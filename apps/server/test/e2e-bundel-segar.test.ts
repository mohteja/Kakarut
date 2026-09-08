import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * TAHAP E2E HARUS MENGUJI BUNDEL YANG BARU DIBANGUN.
 *
 * Server ini menyajikan SPA dari `apps/web/dist` (`index.ts`: `serveStatic`
 * atas `../../web/dist`) — bukan dari sumbernya. Playwright karena itu selalu
 * membuka bundel yang KEBETULAN ada di cakram, dan `npm run e2e` di
 * `apps/web/package.json` hanyalah `playwright test`: ia tak membangun apa pun.
 *
 * Akibatnya bukan hipotesis. Terukur 2026-09-06 saat menulis spec kasir untuk
 * peringatan `blokir_jual_minus`: kode webnya sudah benar, typecheck hijau,
 * asersinya toh gagal — dan yang dibuka peramban ternyata `dist/` bertanggal
 * SEHARI SEBELUMNYA. Perubahan webnya tak pernah sampai ke peramban.
 *
 * Bentuk kegagalannya persis yang paling mahal: tahap e2e tetap HIJAU sambil
 * menguji kode yang bukan kode yang akan dikirim. Gerbang yang hijau atas
 * bundel basi tak menjaga apa pun — ia hanya menerbitkan kesan sudah diperiksa.
 * Sepupunya sudah pernah menggigit repo ini (koreksi #93: gerbang melewatkan
 * `build`, dan yang dibaca kode keluar pembungkus, bukan lognya).
 */
const AKAR = fileURLToPath(new URL("../../../", import.meta.url));
const baca = (p: string) => readFileSync(AKAR + p, "utf8");

describe("gerbang e2e: bundel yang diuji adalah bundel yang baru dibangun", () => {
  it("PREMIS: server memang menyajikan SPA dari apps/web/dist", () => {
    // Kalau suatu saat SPA-nya tak lagi disajikan dari cakram, seluruh alasan
    // uji ini lenyap — dan lebih baik ia merah daripada diam-diam hampa.
    const idx = baca("apps/server/src/index.ts");
    expect(idx).toContain("serveStatic");
    expect(idx).toMatch(/web\/dist/);
  });

  it("PREMIS: `npm run e2e` milik web memang TIDAK membangun", () => {
    // Ini yang membuat langkah build di pemanggilnya wajib, bukan gaya.
    const web = JSON.parse(baca("apps/web/package.json")) as {
      scripts: Record<string, string>;
    };
    expect(web.scripts.e2e).toBe("playwright test");
  });

  it("INTI: `test:e2e` membangun web lebih dulu", () => {
    const akar = JSON.parse(baca("package.json")) as { scripts: Record<string, string> };
    const e2e = akar.scripts["test:e2e"];
    expect(e2e, "skrip test:e2e hilang").toBeTruthy();
    expect(
      /(^|&&\s*)npm run build(\s|$|&)/.test(e2e),
      "`test:e2e` tidak membangun web lebih dulu — Playwright akan membuka " +
        "`apps/web/dist` yang tertinggal, dan tahap e2e jadi hijau atas kode yang " +
        "bukan kode yang dikirim",
    ).toBe(true);
    /*
     * …dan urutannya: build SEBELUM playwright, bukan sesudah.
     *
     * Dinyatakan sebagai SATU pola, bukan dua `indexOf` yang dibandingkan.
     * `jangkar-iris.test.ts` — penjaga yang menjaga penjaga — menagih tiap teks
     * `indexOf` di berkas uji benar-benar ada di berkas SUMBER yang uji itu
     * baca, dan jangkar dari isi `package.json` tak pernah bisa memenuhinya.
     * Uji ini merah karenanya pada jalan pertamanya; yang salah bukan penjaga
     * itu, melainkan cara asersi ini ditulis.
     */
    expect(
      /npm run build\s*&&[\s\S]*e2e -w/.test(e2e),
      "build harus mendahului playwright, bukan menyusul",
    ).toBe(true);
  });

  it("PASANGAN: pemindainya menuduh bentuk lama, dan tak menuduh yang benar", () => {
    const pola = (s: string) =>
      /(^|&&\s*)npm run build(\s|$|&)/.test(s);
    // Bentuk yang SUNGGUH ada di repo ini sampai 2026-09-06:
    expect(pola("npm run e2e -w @kakarut/web")).toBe(false);
    // Bentuk sesudah diperbaiki:
    expect(pola("npm run build && npm run e2e -w @kakarut/web")).toBe(true);
    // …dan nama yang cuma MENGANDUNG "build" tak lolos begitu saja.
    expect(pola("npm run build:docs && npm run e2e -w @kakarut/web")).toBe(false);
  });
});

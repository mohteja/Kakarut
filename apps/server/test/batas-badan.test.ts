import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Penjaga PAGAR UKURAN BADAN PERMINTAAN.
 *
 * Uji lain di berkas ini semuanya fungsi murni; `createApp()` menarik klien DB
 * + env, jadi perilakunya diperiksa terpisah terhadap app sungguhan. Yang
 * dijaga DI SINI adalah hal yang paling mudah hilang tanpa ada yang sadar:
 * middleware-nya dicopot, atau dipecah lagi jadi dua `.use()` berpola jalur.
 *
 * Kenapa dua `.use()` itu SALAH: di Hono semua middleware yang cocok ikut
 * berjalan, jadi memasang `/upload` lalu `*` membuat unggahan tetap terkena
 * batas JSON yang lebih kecil — persis kebalikan dari yang dimaksud.
 */
const src = readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");

describe("pagar ukuran badan permintaan", () => {
  it("bodyLimit terpasang di app API", () => {
    expect(src).toContain('from "hono/body-limit"');
    expect(src).toMatch(/\.use\("\*",\s*batasBadan\)/);
  });

  it("dua batas terpisah: JSON lebih kecil dari unggahan", () => {
    const json = /BATAS_JSON\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024/.exec(src);
    const unggah = /BATAS_UNGGAH\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024/.exec(src);
    expect(json).not.toBeNull();
    expect(unggah).not.toBeNull();
    expect(Number(unggah![1])).toBeGreaterThan(Number(json![1]));
  });

  it("batas unggahan MELEBIHI MAX_SIZE rute /upload", () => {
    // Kalau lebih kecil, penolakannya jadi pemutusan mentah di middleware —
    // bukan 413 berpesan dari rute upload yang tahu konteksnya.
    const upload = readFileSync(
      new URL("../src/modules/upload/routes.ts", import.meta.url),
      "utf8",
    );
    const maxSize = /MAX_SIZE\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024/.exec(upload);
    const unggah = /BATAS_UNGGAH\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024/.exec(src);
    expect(maxSize).not.toBeNull();
    expect(Number(unggah![1])).toBeGreaterThan(Number(maxSize![1]));
  });

  it("BUKAN dua .use() berpola jalur (unggahan akan ikut kena batas JSON)", () => {
    expect(src).not.toMatch(/\.use\("\/upload[^"]*",\s*tolakKebesaran/);
  });

  it("pagar dipasang SEBELUM middleware autentikasi mana pun", () => {
    // Dibandingkan dengan PEMAKAIAN requireAuth sebagai middleware, bukan
    // kemunculan pertamanya di berkas — namanya sudah muncul di blok import
    // jauh di atas semua `.use()`, jadi indeks mentah tak berarti apa-apa.
    const pagar = src.indexOf(".use(\"*\", batasBadan)");
    const authPertama = /\.use\([^)]*requireAuth/.exec(src)?.index ?? -1;
    expect(pagar).toBeGreaterThan(-1);
    expect(authPertama).toBeGreaterThan(-1);
    expect(pagar).toBeLessThan(authPertama);
  });
});

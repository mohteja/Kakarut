import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SEGMEN_RUTE_WEB, ruteWebDikenal } from "@kakarut/shared";

/**
 * Tiap rute web punya segmen pertama yang tercatat di `SEGMEN_RUTE_WEB`.
 *
 * Server menjawab jalur yang segmennya TAK tercatat dengan status 404
 * (laporan uji 31 Okt 2026: /abc dulu 200 lalu dilempar ke /login). Rute baru
 * di App.tsx yang lupa didaftarkan akan dijawab 404 — dan web menampilkan
 * "Halaman tidak ditemukan" untuknya. Uji ini menagihnya di penyusunan.
 */
const APP = readFileSync(fileURLToPath(new URL("../../web/src/App.tsx", import.meta.url)), "utf8");

function segmenDi(src: string): string[] {
  const hasil = new Set<string>();
  for (const m of src.matchAll(/path="\/([a-z0-9-]+)/g)) hasil.add(m[1]);
  for (const m of src.matchAll(/pathname === "\/([a-z0-9-]+)"/g)) hasil.add(m[1]);
  return [...hasil].sort();
}

describe("rute web terdaftar untuk jawaban 404 server", () => {
  const segmen = segmenDi(APP);

  it("pemindainya menemukan rute (non-vakum)", () => {
    expect(segmen.length).toBeGreaterThan(25);
    expect(segmen).toContain("kasir");
    expect(segmen).toContain("tentang");
  });

  it("tiap segmen rute App.tsx tercatat di SEGMEN_RUTE_WEB", () => {
    const hilang = segmen.filter((s) => !SEGMEN_RUTE_WEB.includes(s));
    expect(hilang, "tambahkan ke packages/shared/src/rute-web.ts").toEqual([]);
  });

  it("ruteWebDikenal: root & rute dikenal, jalur asing tidak", () => {
    expect(ruteWebDikenal("/")).toBe(true);
    expect(ruteWebDikenal("/kasir")).toBe(true);
    expect(ruteWebDikenal("/pengaturan/meja")).toBe(true);
    expect(ruteWebDikenal("/reset-password?token=x")).toBe(true);
    expect(ruteWebDikenal("/abc")).toBe(false);
    expect(ruteWebDikenal("/wp-admin/setup.php")).toBe(false);
  });
});

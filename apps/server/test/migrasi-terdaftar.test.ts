import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * SETIAP BERKAS MIGRASI HARUS TERDAFTAR DI JURNAL DRIZZLE.
 *
 * Migrator membaca `meta/_journal.json`, BUKAN isi direktori. Berkas `.sql`
 * yang ditulis tangan tanpa entri jurnal tidak pernah dijalankan — dan
 * gagalnya DIAM: typecheck lolos, unit test lolos, `drizzle-kit` tak mengeluh.
 * Yang muncul belakangan hanya `column ... does not exist` dari kueri yang
 * sudah terlanjur mengandalkan kolomnya, di lingkungan yang memakai DB
 * sungguhan. Persis begitu 0094 lolos sampai CI.
 *
 * Arah sebaliknya juga dijaga: entri jurnal yang berkas `.sql`-nya hilang akan
 * membuat migrator gagal saat boot, bukan saat kueri.
 */
const AKAR = fileURLToPath(new URL("../../../", import.meta.url));
const DIR = AKAR + "apps/server/drizzle/";

type Entri = { idx: number; tag: string };
const jurnal: { entries: Entri[] } = JSON.parse(readFileSync(DIR + "meta/_journal.json", "utf8"));
const tagJurnal = new Set(jurnal.entries.map((e) => e.tag));
const berkasSql = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => f.replace(/\.sql$/, ""));

describe("migrasi drizzle: berkas dan jurnal harus sinkron", () => {
  it("setiap berkas .sql punya entri jurnal (kalau tidak, ia TAK PERNAH jalan)", () => {
    const yatim = berkasSql.filter((t) => !tagJurnal.has(t));
    expect(
      yatim,
      `Migrasi ini tidak terdaftar di meta/_journal.json, jadi migrator TIDAK akan ` +
        `menjalankannya dan kolomnya tak pernah ada di DB: ${yatim.join(", ")}. ` +
        `Buat migrasi lewat 'npx drizzle-kit generate' (yang mengisi jurnal + snapshot), ` +
        `lalu tambahkan pernyataan tulis-tangan (mis. backfill) ke berkas hasilnya.`,
    ).toEqual([]);
  });

  it("setiap entri jurnal punya berkas .sql-nya (kalau tidak, boot gagal)", () => {
    const hilang = jurnal.entries.map((e) => e.tag).filter((t) => !berkasSql.includes(t));
    expect(hilang, `Entri jurnal tanpa berkas .sql: ${hilang.join(", ")}`).toEqual([]);
  });

  it("idx jurnal berurutan tanpa lompatan atau kembar", () => {
    // Migrator memakai urutan idx. Lompatan/kembar = urutan penerapan tak pasti.
    const idx = jurnal.entries.map((e) => e.idx);
    expect(idx).toEqual(idx.map((_, i) => i));
  });
});

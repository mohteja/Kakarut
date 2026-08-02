/**
 * Laporan tidak boleh menjumlah `sale_items` mentah-mentah.
 *
 * `sale_items.qty` dan `line_total` sengaja tetap merekam apa yang DIPESAN;
 * refund sebagian hanya menambah `qty_refund` dan menyusutkan angka di `sales`.
 * Jadi tiap agregasi yang memakai `qty`/`line_total` apa adanya akan berselisih
 * dengan angka utama pada layar yang sama, persis sebesar uang yang sudah
 * dikembalikan.
 *
 * Uji ini menjaga dua hal: bentuk SQL-nya benar, dan tak ada tempat baru yang
 * diam-diam kembali menjumlah kolom mentahnya.
 */
import { readFileSync } from "node:fs";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  hppDitagihSql,
  omzetDitagihSql,
  qtyDitagihSql,
  sumQtyDitagihSql,
} from "../src/lib/porsi-ditagih";

const dialect = new PgDialect();
const sqlOf = (frag: Parameters<PgDialect["sqlToQuery"]>[0]) =>
  dialect.sqlToQuery(frag).sql.replace(/"/g, "");

describe("SQL porsi ditagih", () => {
  it("qty ditagih = qty − qty_refund, dijepit di nol", () => {
    expect(sqlOf(qtyDitagihSql)).toBe(
      "GREATEST(sale_items.qty - sale_items.qty_refund, 0)",
    );
  });

  it("omzet memakai harga_satuan × porsi ditagih, bukan line_total", () => {
    const s = sqlOf(omzetDitagihSql);
    expect(s).toContain("sale_items.harga_satuan");
    expect(s).toContain("sale_items.qty_refund");
    expect(s).not.toContain("line_total");
    // COALESCE agar grup tanpa baris jadi 0, bukan NULL yang meracuni Number()
    expect(s.startsWith("COALESCE(SUM(")).toBe(true);
  });

  it("hpp memakai hpp_satuan × porsi ditagih", () => {
    const s = sqlOf(hppDitagihSql);
    expect(s).toContain("sale_items.hpp_satuan");
    expect(s).toContain("sale_items.qty_refund");
  });

  it("jumlah porsi ikut dikurangi refund", () => {
    expect(sqlOf(sumQtyDitagihSql)).toContain("sale_items.qty_refund");
  });
});

/**
 * Penjaga sumber. Bukan gaya-gayaan: bug aslinya justru berupa `sum(qty)` yang
 * terlihat wajar di tiap tempat, dan tak ada satu pun uji yang bisa menangkapnya
 * tanpa database. Kalau suatu saat memang perlu angka KOTOR (sebelum refund),
 * beri nama fragmennya sendiri di `porsi-ditagih.ts` — jangan kembalikan
 * `sum(saleItems.qty)` telanjang ke laporan.
 */
describe("tak ada agregasi sale_items yang melewatkan refund", () => {
  const berkas = [
    "src/modules/laporan/routes.ts",
    "src/modules/rekomendasi/service.ts",
  ];
  for (const f of berkas) {
    it(f, () => {
      const isi = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
      expect(isi).not.toMatch(/sum\(\s*saleItems\.qty\s*\)/);
      expect(isi).not.toMatch(/sum\(\s*saleItems\.lineTotal\s*\)/);
      expect(isi).not.toMatch(/saleItems\.hppSatuan\}\s*\*\s*\$\{saleItems\.qty\}/);
    });
  }
});

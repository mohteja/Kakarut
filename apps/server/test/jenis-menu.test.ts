import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { hitungKirimPerJenis, tebakJenisKategori } from "@kakarut/shared";

/**
 * PAPAN PESANAN GRID (permintaan pemilik 2026-11-08): tiap kotak menghitung
 * makanan & minuman yang sudah/belum dikirim. Jenisnya per kategori menu.
 */
describe("tebakJenisKategori", () => {
  it("nama minuman lazim → minuman; sisanya makanan", () => {
    for (const n of ["Minuman", "Es Campur", "ES TEH", "Jus Buah", "Kopi", "Teh Tarik", "Aneka Susu", "Boba", "Drinks", "Lemonade"]) {
      expect(tebakJenisKategori(n), n).toBe("minuman");
    }
    for (const n of ["Makanan", "Bakso", "Nasi Goreng", "Paket", "Pesta", "Lauk", "Snack", "Mie"]) {
      expect(tebakJenisKategori(n), n).toBe("makanan");
    }
  });

  it("kata utuh saja: 'es' di tengah kata bukan minuman", () => {
    expect(tebakJenisKategori("Pesanan Khusus")).toBe("makanan");
    expect(tebakJenisKategori("Dessert")).toBe("makanan");
  });

  it("migrasi 0114 memakai daftar kata yang SAMA dengan tebakan TS", () => {
    const sql = readFileSync(
      fileURLToPath(new URL("../drizzle/0114_dapper_saracen.sql", import.meta.url)),
      "utf8",
    );
    const ts = readFileSync(
      fileURLToPath(new URL("../../../packages/shared/src/pesanan.ts", import.meta.url)),
      "utf8",
    );
    const daftarSql = /\\m\(([^)]+)\)\\M/.exec(sql)?.[1];
    const daftarTs = /\\b\(([^)]+)\)\\b/.exec(ts.slice(ts.indexOf("POLA_MINUMAN")))?.[1];
    expect(daftarSql).toBeTruthy();
    expect(daftarSql?.replace(/\\\\/g, "\\")).toBe(daftarTs?.replace(/\\\\/g, "\\"));
  });
});

describe("hitungKirimPerJenis", () => {
  it("menghitung PORSI per jenis, batal tak dihitung", () => {
    const h = hitungKirimPerJenis([
      { qty: 2, status: "selesai", jenis: "makanan" },
      { qty: 1, status: "dikerjakan", jenis: "makanan" },
      { qty: 3, status: "batal", jenis: "makanan" },
      { qty: 2, status: "dikerjakan", jenis: "minuman" },
    ]);
    expect(h).toEqual({ makanan: { dikirim: 2, total: 3 }, minuman: { dikirim: 0, total: 2 } });
  });
});

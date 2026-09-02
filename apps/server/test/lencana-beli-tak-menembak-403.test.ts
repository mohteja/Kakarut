import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { butaKomentar } from "../src/scripts/buta-komentar";

/**
 * LENCANA "BELI" TAK MENEMBAK PINTU YANG IA TAHU TERTUTUP.
 *
 * Log galat production 2026-09-02: `403 GET /api/pembelian` — "Khusus
 * manajemen atau karyawan Central Kitchen" — **211 kali dalam 7 hari**, empat
 * akun, semuanya peran kitchen/bar. Diukur di peramban sebagai kitchen: membuka
 * beranda menembak `/api/pembelian?per_page=500` dua kali (403, 403) — untuk
 * lencana nav yang tak pernah dirender, sebab nav kitchen/bar memang tak punya
 * tautan Beli Bahan. Sumbernya satu predikat `lihatPengadaan` yang menyalakan
 * lencana PRODUKSI (sah untuk kitchen/bar) dan lencana BELI (tidak) sekaligus.
 *
 * Yang dijaga: predikat lencana beli mengecualikan kitchen & bar, kueri
 * `/pembelian` di Layout memakainya (bukan `lihatPengadaan`), dan penjaga
 * servernya tetap ada — layar menyesuaikan diri pada pintu, bukan sebaliknya.
 */
const LAYOUT = butaKomentar(
  readFileSync(fileURLToPath(new URL("../../web/src/components/Layout.tsx", import.meta.url)), "utf8"),
);
const APP = butaKomentar(readFileSync(fileURLToPath(new URL("../src/app.ts", import.meta.url)), "utf8"));

describe("lencana beli di nav: hanya peran yang boleh membaca /pembelian", () => {
  it("predikatnya mengecualikan kitchen & bar", () => {
    expect(LAYOUT).toMatch(
      /const lihatBeli = lihatPengadaan && roleGuard !== "kitchen" && roleGuard !== "bar";/,
    );
  });

  it("kueri /pembelian memakai lihatBeli, kueri /produksi tetap lihatPengadaan", () => {
    const beli = LAYOUT.indexOf("`/pembelian${qsPengadaan}`");
    const prod = LAYOUT.indexOf("`/produksi${qsPengadaan}`");
    expect(beli, "premis: kueri /pembelian ada").toBeGreaterThan(-1);
    expect(prod, "premis: kueri /produksi ada").toBeGreaterThan(-1);
    const sesudahBeli = LAYOUT.slice(beli, beli + 200);
    const sesudahProd = LAYOUT.slice(prod, prod + 200);
    expect(sesudahBeli).toMatch(/enabled: lihatBeli,/);
    expect(sesudahProd).toMatch(/enabled: lihatPengadaan,/);
  });

  it("pintu servernya tetap: /pembelian khusus manajemen atau karyawan CK", () => {
    expect(APP).toContain('message: "Khusus manajemen atau karyawan Central Kitchen"');
  });
});

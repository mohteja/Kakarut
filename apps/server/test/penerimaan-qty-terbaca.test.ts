import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { angkaDari } from "@kakarut/shared";

/**
 * Penjaga QTY DITERIMA di Penerimaan Barang.
 *
 * Di layar ini salah ketik tidak menghasilkan angka yang salah — ia
 * menghasilkan HASIL YANG BERLAWANAN.
 *
 * Nol punya arti tegas, ditulis di dua tempat sekaligus: label di bawah tabel
 * ("0 = baris ditolak") dan server, yang menyetel baris ber-qty 0 jadi status
 * "ditolak" beralasan "Barang tidak diterima". Bentuk lamanya
 * `angkaDari(...) || 0`, jadi petugas gudang yang mengetik "5 kg" — bermaksud
 * "saya menerima sebanyak ini" — justru MENOLAK barangnya, dan stok yang
 * sudah datang secara fisik tak pernah masuk.
 *
 * `angkaDari` sendiri melarang bentuk itu, dengan alasan yang sama persis, dan
 * kalimatnya dipatok di bawah: kalau larangan itu suatu saat dicabut, penjaga
 * ini harus ikut gugur dengan berisik.
 */
const baca = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const tanpaKomentar = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const HALAMAN = tanpaKomentar(baca("../../web/src/pages/produksi/PenerimaanPage.tsx"));
const ROUTES = tanpaKomentar(baca("../src/modules/penerimaan/routes.ts"));
const ANGKA_MENTAH = baca("../../../packages/shared/src/angka.ts");

describe("premis: nol adalah PERINTAH menolak, bukan nilai cadangan", () => {
  it("server menolak baris yang qty diterimanya 0", () => {
    const i = ROUTES.indexOf("terima-sebagian");
    expect(i).toBeGreaterThan(0);
    const blok = ROUTES.slice(i, i + 4000);
    expect(blok).toMatch(/diterima > 0/);
    expect(blok).toMatch(/status: "ditolak"/);
    expect(blok).toMatch(/Barang tidak diterima/);
  });

  it("layarnya sendiri mengumumkan arti itu ke penggunanya", () => {
    expect(HALAMAN).toMatch(/0 = baris ditolak/);
  });

  it("`angkaDari` memang melarang memakai 0 sebagai nilai kegagalan", () => {
    // Dipatok pada PROSANYA, karena inilah kontrak yang dilanggar baris lama.
    expect(ANGKA_MENTAH).toMatch(/Sengaja TIDAK memulangkan 0/);
  });

  it("isian gudang yang wajar memang NaN — dan `|| 0` mengubahnya jadi menolak", () => {
    for (const t of ["5 kg", "5kg", "2,5 kg", "sepuluh"]) {
      expect(Number.isNaN(angkaDari(t)), t).toBe(true);
      expect(angkaDari(t) || 0).toBe(0);
    }
  });

  it("angka yang benar tetap lolos, termasuk koma desimal", () => {
    expect(angkaDari("5")).toBe(5);
    expect(angkaDari("1,5")).toBe(1.5);
    expect(angkaDari(0)).toBe(0);
  });
});

describe("Penerimaan menahan qty yang tak terbaca", () => {
  it("pembuang komentar tidak memakan kodenya", () => {
    expect(HALAMAN).toContain("function qtyTakTerbaca");
    expect(HALAMAN).not.toContain("HASIL YANG BERLAWANAN");
  });

  it("`|| 0` sudah tidak ada lagi pada qty_diterima", () => {
    expect(HALAMAN).not.toMatch(/qty_diterima: angkaDari\([^)]*\) \|\| 0/);
    expect(HALAMAN).toMatch(/qty_diterima: angkaDari\(qtyDraft\[r\.id\] \?\? r\.qty\),/);
  });

  it("baris tak terbaca terkumpul — kosong ikut terjaring", () => {
    const i = HALAMAN.indexOf("function qtyTakTerbaca");
    const blok = HALAMAN.slice(i, HALAMAN.indexOf("\n  }", i));
    // `!(… >= 0)` menjaring NaN (termasuk kotak kosong) DAN minus sekaligus.
    expect(blok).toMatch(/!\(angkaDari\(qtyDraft\[r\.id\] \?\? r\.qty\) >= 0\)/);
  });

  it("tombol Simpan Penerimaan terkunci olehnya", () => {
    expect(HALAMAN).toMatch(
      /disabled=\{terimaSebagian\.isPending \|\| qtyTakTerbaca\(g\)\.length > 0\}/,
    );
  });

  it("pesannya menyebut BAHAN mana, dan mengajarkan cara menolak yang benar", () => {
    const i = HALAMAN.indexOf("Jumlah tidak terbaca pada");
    expect(i, "pesan penjaga tak ditemukan").toBeGreaterThan(0);
    const pesan = HALAMAN.slice(i, i + 400);
    expect(pesan).toMatch(/qtyTakTerbaca\(g\)\.map\(\(r\) => r\.bahan\)\.join\(", "\)/);
    // Tanpa kalimat ini, orang yang memang mau menolak akan mengosongkan
    // kotaknya — persis jalan yang baru saja ditutup.
    expect(pesan).toMatch(/tidak diterima/);
  });
});

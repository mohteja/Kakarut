import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { angkaDari } from "@kakarut/shared";

/**
 * Penjaga HARGA pada modal "Tiba di CK" beli perlengkapan.
 *
 * Modal itu punya DUA kolom angka berdampingan di tiap baris: qty dan harga.
 * Qty dijaga (`adaInvalid`); harga tidak — padahal salah ketiknya jauh lebih
 * sunyi, dan rantainya panjang:
 *
 *   "125rb" → NaN → `JSON.stringify` → `null`
 *     → zod server `total_harga: z.number().min(0).nullish()` MENERIMA null
 *       → `tibaBeliPerlengkapan`: `params.totalHarga ?? beli.totalHarga`
 *         → null berarti "pakai harga RENCANA".
 *
 * Dan "pakai harga rencana" persis arti kolom yang sengaja DIKOSONGKAN. Jadi
 * salah ketik tak terbedakan dari kosong: estimasi RAB dibukukan sebagai
 * belanja riil ke `supply_mutations.total_harga` — angka yang mengisi total
 * belanja kartu perlengkapan dan laporan belanja per supplier.
 *
 * Uangnya tidak hilang ke galat; ia diganti diam-diam dengan tebakan.
 */
const baca = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

const BELI = baca("../../web/src/pages/perlengkapan/BeliPerlengkapanPage.tsx");
const ROUTES = baca("../src/modules/perlengkapan/routes.ts");
const SERVICE = baca("../src/modules/perlengkapan/service.ts");

/** Bagian `TibaFakturModal` saja — berkasnya juga memuat BuatBeliModal. */
const AWAL = BELI.indexOf("function TibaFakturModal");
const MODAL = BELI.slice(AWAL, BELI.indexOf("interface BarisBeliDraft"));

describe("premis: rantai NaN → null → harga rencana benar-benar utuh", () => {
  it("isian harga yang wajar memang tak terbaca", () => {
    for (const teks of ["125rb", "125 ribu", "seratus", "125k"]) {
      expect(Number.isNaN(angkaDari(teks)), teks).toBe(true);
    }
  });

  it("angka yang benar tetap lolos, termasuk titik ribuan", () => {
    expect(angkaDari("125000")).toBe(125000);
    expect(angkaDari("125.000")).toBe(125000);
    expect(angkaDari("Rp 125.000")).toBe(125000);
  });

  it("zod server MENERIMA null untuk total_harga (jadi tak ada galat)", () => {
    expect(ROUTES).toMatch(/total_harga: z\.number\(\)\.min\(0\)\.max\(BATAS_UANG\)\.nullish\(\)/);
  });

  it("null di server berarti 'pakai harga rencana', bukan 'tanpa harga'", () => {
    expect(SERVICE).toMatch(/params\.totalHarga \?\? beli\.totalHarga \?\? null/);
  });
});

describe("modal Tiba menahan harga yang tak terbaca", () => {
  it("potongan yang diperiksa memang modal Tiba", () => {
    expect(AWAL, "TibaFakturModal tak ditemukan").toBeGreaterThan(0);
    expect(MODAL).toContain("adaInvalid");
    expect(MODAL).toContain("Tiba & Kirim");
  });

  it("harga terisi yang bukan angka ≥ 0 terkumpul", () => {
    const i = MODAL.indexOf("const hargaSalahKetik");
    expect(i, "penjaga harga tak ditemukan").toBeGreaterThan(0);
    const blok = MODAL.slice(i, MODAL.indexOf("});", i));
    // `!(… >= 0)` sekaligus menjaring NaN DAN minus; `>= 0` (bukan `> 0`)
    // karena harga nol sah — barang gratis/sumbangan.
    expect(blok).toMatch(/!\(angkaDari\(t\) >= 0\)/);
    expect(blok).toMatch(/t !== ""/);
  });

  it("tombol Tiba & Kirim terkunci olehnya — dan qty tetap dijaga", () => {
    expect(MODAL).toMatch(/disabled=\{simpan\.isPending \|\| adaInvalid \|\| hargaSalahKetik\.length > 0\}/);
    // Pagar qty yang sudah benar dipatok: dialah pembanding yang menjadikan
    // absennya pagar harga sebuah kelalaian, bukan pilihan.
    expect(MODAL).toMatch(/const adaInvalid = barisMenunggu\.some\(\(r\) => !\(angkaDari\(draft\[r\.id\]\?\.qty\) > 0\)\)/);
  });

  it("pesannya menyebut BARANG mana, dan bahwa kosong itu sah", () => {
    const i = MODAL.indexOf("Harga tidak terbaca pada");
    expect(i, "pesan penjaga tak ditemukan").toBeGreaterThan(0);
    const pesan = MODAL.slice(i, i + 400);
    expect(pesan).toMatch(/hargaSalahKetik\.map\(\(r\) => r\.nama\)\.join\(", "\)/);
    // Tanpa kalimat ini orang mengira kolomnya wajib, lalu mengarang angka.
    expect(pesan).toMatch(/Kosongkan bila mau memakai harga rencana/);
  });

  it("dikosongkan tetap mengirim null — arti 'pakai harga rencana' dipertahankan", () => {
    expect(MODAL).toMatch(/\(draft\[r\.id\]\?\.harga \?\? ""\)\.trim\(\) === "" \? null : angkaDari/);
  });
});

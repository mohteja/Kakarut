import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { angkaDari } from "@kakarut/shared";

/**
 * Penjaga BARIS TERBUANG pada dua layar KIRIM BARANG.
 *
 * Bentuknya sama persis dengan yang sudah dijaga di `FakturFormPage`
 * (`faktur-jumlah-terbaca.test.ts`): penyaring kiriman memakai
 * `angkaDari(...) > 0`, jadi NaN tidak pernah sampai ke server sama sekali —
 * barisnya dibuang DI SISI KLIEN. Tombolnya cuma menutup pintu saat SELURUH
 * baris tak valid, jadi satu baris benar sudah cukup untuk mengirim tanpa
 * bahan yang salah ketik.
 *
 * Di dua layar ini akibatnya berupa barang, bukan angka: kirimannya berangkat
 * tanpa bahan itu. Asal mengira sudah mengirim, tujuan tak pernah menerimanya,
 * dan tak ada galat di mana pun.
 *
 * Dijaga bersama karena keduanya satu bentuk. Memperbaiki satu sisi saja adalah
 * bentuk kegagalan yang paling mungkin terulang di repo ini — pelajaran dari
 * `rak-master-segar.test.ts` dan `opname-segar-kembar.test.ts`.
 */
const baca = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

const TRANSFER = baca("../../web/src/pages/stok/TransferStokPage.tsx");
const KIRIM_HASIL = baca("../../web/src/pages/produksi/TambahStokPage.tsx");

describe("premis: NaN dibuang penyaring, bukan ditolak server", () => {
  it("isian gudang yang wajar memang NaN dan gagal `> 0`", () => {
    for (const t of ["5 kg", "5kg", "lima", "1/2"]) {
      expect(Number.isNaN(angkaDari(t)), t).toBe(true);
      expect(angkaDari(t) > 0, t).toBe(false);
    }
  });

  it("angka yang benar tetap lolos", () => {
    expect(angkaDari("3") > 0).toBe(true);
    expect(angkaDari("1,5") > 0).toBe(true);
  });
});

describe("Transfer Stok menahan baris yang tak akan terkirim", () => {
  it("pembuang komentar tidak memakan kodenya", () => {
    expect(TRANSFER).toContain("const qtyTerbuang");
    expect(TRANSFER).not.toContain("dibuang diam-diam");
  });

  it("baris berbahan yang terisi tapi tak `> 0` terkumpul", () => {
    const i = TRANSFER.indexOf("const qtyTerbuang");
    expect(i, "pengumpul tak ditemukan").toBeGreaterThan(0);
    const blok = TRANSFER.slice(i, TRANSFER.indexOf(".filter((n)", i));
    expect(blok).toMatch(/b\.ingredient_id/);
    expect(blok).toMatch(/b\.qty\.trim\(\) !== ""/);
    expect(blok).toMatch(/!\(angkaDari\(b\.qty\) > 0\)/);
  });

  it("`bisaKirim` benar-benar terkunci olehnya", () => {
    const i = TRANSFER.indexOf("const bisaKirim");
    const blok = TRANSFER.slice(i, TRANSFER.indexOf(";", i));
    expect(blok).toMatch(/qtyTerbuang\.length === 0/);
    // Pagar lama tetap ada — masing-masing menjaga hal berbeda.
    expect(blok).toMatch(/barisTerisi\.length > 0/);
    expect(blok).toMatch(/!adaQtyLebih/);
    expect(blok).toMatch(/!adaSalahKemasan/);
  });

  it("pesannya menyebut BAHAN mana", () => {
    expect(TRANSFER).toMatch(/\{qtyTerbuang\.join\(", "\)\}/);
    expect(TRANSFER).toMatch(/tidak ikut terkirim/);
  });
});

describe("Kirim hasil produksi ke cabang menahan hal yang sama", () => {
  it("pembuang komentar tidak memakan kodenya", () => {
    expect(KIRIM_HASIL).toContain("const qtyTerbuang");
  });

  it("bahan terisi yang tak `> 0` terkumpul", () => {
    const i = KIRIM_HASIL.indexOf("const qtyTerbuang");
    expect(i, "pengumpul tak ditemukan").toBeGreaterThan(0);
    const blok = KIRIM_HASIL.slice(i, KIRIM_HASIL.indexOf(";", i));
    expect(blok).toMatch(/\(qty\[id\] \?\? ""\)\.trim\(\) !== ""/);
    expect(blok).toMatch(/!\(angkaDari\(qty\[id\]\) > 0\)/);
    expect(blok).toMatch(/b\.nama/);
  });

  it("tombol Kirim terkunci olehnya — dan pagar saldo CK tetap ada", () => {
    const i = KIRIM_HASIL.indexOf("onKirim(items)");
    expect(i).toBeGreaterThan(0);
    const blok = KIRIM_HASIL.slice(i, i + 300);
    expect(blok).toMatch(/qtyTerbuang\.length > 0/);
    expect(blok).toMatch(/adaLebihDariSaldo/);
    expect(blok).toMatch(/items\.length === 0/);
  });

  it("pesannya menyebut BAHAN mana", () => {
    const i = KIRIM_HASIL.indexOf("Jumlah pada");
    expect(i, "pesan penjaga tak ditemukan").toBeGreaterThan(0);
    expect(KIRIM_HASIL.slice(i, i + 300)).toMatch(/\{qtyTerbuang\.join\(", "\)\}/);
  });
});

/**
 * Kembarannya di `FakturFormPage` — dipatok agar tetap ada, karena dialah yang
 * menetapkan bentuk penjaganya untuk ketiga layar.
 */
describe("penjaga sejenis di form faktur tetap ada", () => {
  it("FakturFormPage masih menahan baris terbuang", () => {
    const f = baca("../../web/src/pages/produksi/FakturFormPage.tsx");
    expect(f).toMatch(/const jumlahTerbuang/);
    expect(f).toMatch(/jumlahTerbuang\.length > 0/);
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { angkaDari } from "@kakarut/shared";

/**
 * Penjaga TAKARAN TERBUANG pada dua editor RESEP.
 *
 * Bentuknya sama dengan yang sudah dijaga di form faktur dan dua layar kirim:
 * penyaring kiriman memakai `angkaDari(...) > 0`, jadi takaran tak terbaca
 * dibuang DI SISI KLIEN — tak pernah sampai ke server, tak pernah jadi galat.
 *
 * Yang membedakan dua halaman ini: yang disimpan adalah ATURAN, bukan satu
 * transaksi. Resep yang kehilangan satu bahan akan
 *   (a) menghitung HPP tanpa biaya bahan itu — food cost terlihat lebih sehat
 *       daripada kenyataannya, dan
 *   (b) tidak pernah memotong stoknya pada SETIAP penjualan menu itu.
 * Salah ketik sekali, salahnya berulang tiap hari sampai ada yang sadar.
 *
 * Di `ResepPage` ada tambahan khas: `biayaResep` juga melewatkan baris itu
 * (`angkaDari(r.qty) || 0`), jadi HARGA BATCH yang ditawarkan ikut turun — dan
 * bila persetujuan harga dicentang, harga bahan tersimpan lebih murah daripada
 * kenyataannya.
 */
const baca = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

const MENU = baca("../../web/src/pages/menu/MenuFormPage.tsx");
const RESEP = baca("../../web/src/pages/resep/ResepPage.tsx");

describe("premis: takaran yang wajar diketik memang NaN", () => {
  it("isian resep sehari-hari tak terbaca", () => {
    for (const t of ["100 gr", "100gr", "1/4", "seperempat", "2 sdm"]) {
      expect(Number.isNaN(angkaDari(t)), t).toBe(true);
      expect(angkaDari(t) > 0, t).toBe(false);
    }
  });

  it("takaran pecahan yang benar tetap lolos", () => {
    expect(angkaDari("0,25")).toBe(0.25);
    expect(angkaDari("100")).toBe(100);
  });
});

describe("form Menu menahan takaran yang tak akan masuk resep", () => {
  it("pembuang komentar tidak memakan kodenya", () => {
    expect(MENU).toContain("const qtyTerbuang");
    expect(MENU).not.toContain("salahnya berulang tiap hari");
  });

  it("baris berbahan yang terisi tapi tak `> 0` terkumpul", () => {
    const i = MENU.indexOf("const qtyTerbuang");
    expect(i, "pengumpul tak ditemukan").toBeGreaterThan(0);
    const blok = MENU.slice(i, MENU.indexOf(".filter((n)", i));
    expect(blok).toMatch(/k\.ingredient_id/);
    expect(blok).toMatch(/k\.qty\.trim\(\) !== ""/);
    expect(blok).toMatch(/!\(angkaDari\(k\.qty\) > 0\)/);
  });

  it("DUA pagar: submit dihentikan dan tombolnya mati", () => {
    // Tombol saja tidak cukup: form ini disubmit lewat `onSubmit`, dan
    // menekan Enter di kotak isian melewati tombolnya.
    expect(MENU).toMatch(/if \(qtyTerbuang\.length > 0\) return;/);
    expect(MENU).toMatch(/disabled=\{simpan\.isPending \|\| qtyTerbuang\.length > 0\}/);
  });

  it("penjaganya berjalan SEBELUM dialog kemasan", () => {
    // Kalau urutannya terbalik, dialog "simpan tanpa kemasan" muncul lebih
    // dulu dan tombol di dalamnya memanggil `simpan.mutate()` langsung —
    // melewati pagar ini sama sekali.
    const iTerbuang = MENU.indexOf("if (qtyTerbuang.length > 0) return;");
    const iKemasan = MENU.indexOf("if (perluKemasan)");
    expect(iTerbuang).toBeGreaterThan(0);
    expect(iKemasan).toBeGreaterThan(iTerbuang);
  });

  it("pesannya menyebut BAHAN mana + akibatnya", () => {
    const i = MENU.indexOf("Takaran pada");
    expect(i, "pesan penjaga tak ditemukan").toBeGreaterThan(0);
    const pesan = MENU.slice(i, i + 500);
    expect(pesan).toMatch(/\{qtyTerbuang\.join\(", "\)\}/);
    expect(pesan).toMatch(/stoknya tak pernah terpotong/);
  });
});

describe("halaman Resep produksi menahan hal yang sama", () => {
  it("baris terisi yang tak `> 0` terkumpul", () => {
    const i = RESEP.indexOf("const qtyTerbuang");
    expect(i, "pengumpul tak ditemukan").toBeGreaterThan(0);
    const blok = RESEP.slice(i, RESEP.indexOf(".filter((n)", i));
    expect(blok).toMatch(/r\.ingredient_id/);
    expect(blok).toMatch(/r\.qty\.trim\(\) !== ""/);
    expect(blok).toMatch(/!\(angkaDari\(r\.qty\) > 0\)/);
  });

  it("tombol Simpan Resep terkunci olehnya", () => {
    /*
     * Dipatok pada `simpan.mutate()`, BUKAN pada teks "Simpan Resep".
     * Versi pertama uji ini mencari teksnya — dan mendarat di prosa JSX
     * ("tersimpan saat Simpan Resep", "Tersimpan saat 'Simpan Resep'") yang
     * muncul ratusan baris lebih dulu; pembuang komentar tak menyentuhnya
     * karena itu teks tampilan, bukan komentar. Yang cocok bukan yang dijaga.
     */
    const i = RESEP.indexOf("onClick={() => simpan.mutate()}");
    expect(i, "tombol simpan resep tak ditemukan").toBeGreaterThan(0);
    expect(RESEP.slice(i, i + 200)).toMatch(
      /disabled=\{simpan\.isPending \|\| qtyTerbuang\.length > 0\}/,
    );
  });

  it("pesannya menyebut bahan + akibat pada harga batch", () => {
    const i = RESEP.indexOf("Takaran pada");
    expect(i, "pesan penjaga tak ditemukan").toBeGreaterThan(0);
    const pesan = RESEP.slice(i, i + 500);
    expect(pesan).toMatch(/\{qtyTerbuang\.join\(", "\)\}/);
    expect(pesan).toMatch(/harga batch/);
  });

  it("premisnya: biayaResep memang melewatkan baris itu", () => {
    // Inilah yang membuat harga batch ikut turun; kalau bentuk ini berubah,
    // kalimat "harga batch ikut kurang hitung" di pesannya jadi bohong.
    expect(RESEP).toMatch(/\(angkaDari\(r\.qty\) \|\| 0\) \* x\.harga_per_unit/);
  });
});

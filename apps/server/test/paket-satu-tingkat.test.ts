import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * PAKET HANYA SATU TINGKAT — dan itu harus dijaga dari DUA arah.
 *
 * `komponenEfektif` memulangkan komponen menu itu sendiri DITAMBAH komponen
 * menu dasarnya, lalu berhenti. Tidak rekursif, dan itu memang disengaja.
 *
 * Aturan yang menjaganya, "menu dasar harus reguler", dulu hanya ditegakkan
 * pada menu yang SEDANG disunting. Menu-menu yang MENUNJUK ke sana tak ikut
 * diperiksa, jadi rantai dua tingkat bisa dibuat dari arah sebaliknya:
 *
 *   1. buat paket P berdasar A   → A masih reguler, lolos
 *   2. ubah A sendiri jadi paket → yang diperiksa cuma dasar BARU-nya (B),
 *                                  dan B reguler, jadi lolos juga
 *   hasilnya: P → A → B
 *
 * Terukur pada server sungguhan sebelum perbaikan:
 *
 *   HPP paket P  : 6.250   (dasarnya sendiri sudah 10.139 — 38% terlalu rendah)
 *   jual P       : cuma mengonsumsi resep A; resep B tak pernah dipotong
 *
 * Tak ada galat di titik mana pun. Yang terjadi cuma stok yang terlihat lebih
 * banyak daripada isi rak, dan laba yang terlihat lebih besar daripada yang
 * benar-benar didapat.
 */

const AKAR = new URL("../src/", import.meta.url);
const baca = (p: string) => readFileSync(fileURLToPath(new URL(p, AKAR)), "utf8");
const RUTE = baca("modules/menu/routes.ts");
const SERVICE = baca("modules/menu/service.ts");

describe("menu: batas satu tingkat untuk paket", () => {
  it("berkasnya terbaca — bukan lolos karena kosong", () => {
    expect(RUTE.length).toBeGreaterThan(5_000);
    expect(SERVICE.length).toBeGreaterThan(2_000);
  });

  it("perhitungan paket memang BERHENTI di satu tingkat", () => {
    /*
     * Ini premis dari seluruh uji ini. Kalau suatu saat `komponenEfektif`
     * dibuat rekursif, penjaga di bawah tak lagi perlu — dan uji ini yang
     * pertama memberi tahu, alih-alih membiarkan penjaga jadi larangan tanpa
     * sebab yang tak ada yang berani mencabutnya.
     */
    const i = SERVICE.indexOf("export function komponenEfektif");
    expect(i).toBeGreaterThan(0);
    // Diiris dari SESUDAH baris deklarasinya: badan fungsi yang masih memuat
    // namanya sendiri di baris pertama akan selalu "memanggil dirinya".
    const badan = SERVICE.slice(SERVICE.indexOf("{", i), SERVICE.indexOf("\n}", i));
    expect(badan).toContain("katalog.komponenByMenu.get(menu.baseMenuId)");
    // Tak memanggil dirinya sendiri = tak menelusuri dasar dari dasar.
    expect(badan).not.toContain("komponenEfektif(");
  });

  it("menu yang jadi DASAR sebuah paket tak boleh jadi paket", () => {
    const i = RUTE.indexOf("if (selfId && body.tipe === \"paket\")");
    expect(i, "penjaga arah sebaliknya tak ditemukan").toBeGreaterThan(0);
    const blok = RUTE.slice(i, i + 700);
    // Kuncinya: mencari menu LAIN yang `base_menu_id`-nya menunjuk ke menu ini.
    expect(blok).toContain("eq(menus.baseMenuId, selfId)");
    expect(blok).toContain("HTTPException(400");
  });

  it("penjaga arah PERTAMA masih ada — dua-duanya, bukan salah satu", () => {
    // Menghapus yang lama sambil menambah yang baru cuma memindahkan lubangnya.
    expect(RUTE).toContain('base.tipe !== "regular"');
    expect(RUTE).toContain("Menu dasar tidak boleh menu itu sendiri");
  });

  it("penjaganya menyebut paket mana yang menghalangi", () => {
    // "Tidak boleh" tanpa menyebut sebabnya memaksa yang menyunting menebak
    // menu mana di antara ratusan yang harus diubah dulu.
    const i = RUTE.indexOf("eq(menus.baseMenuId, selfId)");
    const blok = RUTE.slice(Math.max(0, i - 400), i + 700);
    expect(blok).toContain("nama: menus.nama");
    expect(blok).toMatch(/dipakai sebagai menu dasar paket/);
  });
});

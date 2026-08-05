import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Penjaga KONFIRMASI KEMASAN untuk MENU PAKET.
 *
 * Form menu menahan simpan dengan dialog bila resepnya tak punya bahan
 * Kemasan TA — sebab tanpa itu `hitungHpp` bawa-pulang dan dine-in
 * menghasilkan angka yang SAMA: biaya dus tak pernah masuk laba-rugi dan stok
 * kemasan tak pernah berkurang.
 *
 * Syaratnya dua paruh: `perluKemasan = adaResep && !punyaKemasan`. Untuk menu
 * PAKET keduanya harus melihat tempat yang sama, karena resep paket TIDAK ada
 * di `komponen` — yang diedit di halaman ini cuma toppingnya, resep menu
 * dasarnya diwarisi (dan `preview` memang menjumlahkannya: `baseHpp + ownHpp`).
 *
 * Dulu hanya `punyaKemasan` yang melihat menu dasar; `adaResep` cuma melihat
 * `komponen`. Akibatnya paket TANPA topping — bentuk paket yang paling lazim,
 * "menu yang sama, harga bundel" — punya `adaResep = false`, jadi
 * `perluKemasan` selalu false dan dialognya tak pernah muncul. Paket atas menu
 * dasar tanpa kemasan lolos simpan diam-diam, persis kasus yang diminta
 * ditanyakan.
 */
const HAL = readFileSync(
  fileURLToPath(new URL("../../web/src/pages/menu/MenuFormPage.tsx", import.meta.url)),
  "utf8",
);

describe("premis: resep paket memang tidak ada di `komponen`", () => {
  it("`preview` menjumlahkan HPP menu dasar dengan HPP topping", () => {
    // Kalau ini berubah, seluruh alasan penjaga di bawah ikut gugur.
    expect(HAL).toContain("hpp: baseHpp + ownHpp,");
  });

  it("dan `punyaKemasan` memang sudah menengok ke menu dasar", () => {
    expect(HAL).toContain(
      'return menus?.find((m) => m.id === baseMenuId)?.komponen.some((k) => k.is_packaging) ?? false;',
    );
  });
});

describe("`adaResep` ikut menengok resep menu dasar untuk paket", () => {
  it("ada perhitungan `resepDasarPaket` yang terpisah", () => {
    expect(HAL).toContain("const resepDasarPaket =");
    expect(HAL).toContain('tipe === "paket" && baseMenuId');
  });

  it("dan `adaResep` menggabungkannya, bukan hanya melihat `komponen`", () => {
    expect(HAL).toContain(
      'komponen.some((k) => k.ingredient_id && angkaDari(k.qty) > 0) || resepDasarPaket;',
    );
  });

  it("syarat dialognya tetap kedua paruh — bukan diganti salah satu", () => {
    expect(HAL).toContain("const perluKemasan = adaResep && !punyaKemasan;");
  });

  it("menu BIASA tak ikut berubah — `resepDasarPaket` false di luar paket", () => {
    // Kalau penjaganya bocor ke menu non-paket, tiap menu kosong akan menagih
    // kemasan sebelum resepnya diisi sama sekali — bising yang justru sengaja
    // dihindari sejak awal.
    const i = HAL.indexOf("const resepDasarPaket =");
    const blok = HAL.slice(i, i + 260);
    expect(i).toBeGreaterThan(0);
    expect(blok).toContain(": false;");
  });

  it("sebabnya ditulis, termasuk kenapa paket tanpa topping tetap punya HPP", () => {
    expect(HAL).toContain("TANPA topping");
    expect(HAL).toContain("tak sepakat di mana resep paket berada");
  });
});

describe("sifat yang sudah benar dan jangan sampai hilang", () => {
  it("dialog konfirmasi masih digerbang `perluKemasan` saat submit", () => {
    expect(HAL).toContain("if (perluKemasan) {");
  });

  it("panel petunjuk di panel resep juga masih memakainya", () => {
    expect(HAL).toContain("{perluKemasan && (");
  });

  it("baris takaran tak terbaca tetap dijaga terpisah", () => {
    expect(HAL).toContain("const qtyTerbuang = komponen");
    expect(HAL).toContain('k.qty.trim() !== "" && !(angkaDari(k.qty) > 0)');
  });
});

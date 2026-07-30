import { describe, expect, it } from "vitest";
import { hitungHpp, qtyEfektif, type KomponenDto } from "@kakarut/shared";
import { komponenEfektif, type KatalogMenu } from "../src/modules/menu/service";

/**
 * BASIS BIAYA sebuah baris pesanan = penyajiannya, bukan pembukuannya.
 *
 * `is_dine_in` menjawab "di mana pesanan dimakan" (pemisahan omzet, label meja
 * pada struk). `sajian_takeaway` menjawab "apakah dusnya terpakai" — dan
 * itulah yang menentukan HPP & pemakaian bahan. Fungsi di bawah adalah aturan
 * yang dipakai `createSale` maupun `hitungUlangBiayaPenjualan`; keduanya harus
 * setuju, kalau tidak membalik penanda akan menghasilkan angka yang berbeda
 * dari kalau pesanannya dibuat bawa-pulang sejak awal.
 */
const sajianTakeaway = (dineIn: boolean, tandaDapur: boolean) => tandaDapur || !dineIn;
const dasarDineIn = (dineIn: boolean, tandaDapur: boolean) =>
  !sajianTakeaway(dineIn, tandaDapur);

describe("basis biaya take away", () => {
  it("dine-in tanpa tanda dapur → biaya dine-in (kemasan dilewati)", () => {
    expect(dasarDineIn(true, false)).toBe(true);
  });

  it("bawa pulang dari kasir → biaya bawa pulang", () => {
    expect(dasarDineIn(false, false)).toBe(false);
  });

  it("dine-in TAPI ditandai TA di papan → biaya bawa pulang (inti perubahan)", () => {
    expect(dasarDineIn(true, true)).toBe(false);
  });

  it("tanda dapur pada baris yang sudah bawa pulang tidak mengubah apa pun", () => {
    expect(dasarDineIn(false, true)).toBe(false);
  });
});

describe("kemasan take away menggerakkan HPP & konsumsi", () => {
  const nasi = { qty: 200, hargaPerUnit: 12, isPackaging: false, isComplement: false };
  const dus = { qty: 1, hargaPerUnit: 1500, isPackaging: true, isComplement: false };
  const sambal = { qty: 20, hargaPerUnit: 50, isPackaging: false, isComplement: true };
  const resep = [nasi, dus, sambal];

  it("selisih HPP bawa pulang vs dine-in = kemasan + separuh pelengkap", () => {
    const bawaPulang = hitungHpp(resep, false);
    const dineIn = hitungHpp(resep, true);
    // dine-in: dus dilewati (1500), sambal separuh (20×50/2 = 500 dihemat)
    expect(bawaPulang - dineIn).toBe(1500 + 500);
  });

  it("resep TANPA kemasan: HPP bawa pulang = HPP dine-in (kenapa form menu memperingatkan)", () => {
    const tanpaKemasan = [nasi];
    expect(hitungHpp(tanpaKemasan, false)).toBe(hitungHpp(tanpaKemasan, true));
  });

  it("kemasan tidak menghasilkan konsumsi saat dine-in, penuh saat bawa pulang", () => {
    const k = { qty: dus.qty, isPackaging: true, isComplement: false };
    expect(qtyEfektif(k, true)).toBe(0);
    expect(qtyEfektif(k, false)).toBe(1);
  });
});

/** Katalog tiruan seminimal mungkin — cukup untuk menguji penggabungan resep. */
function katalog(
  komponen: Record<string, KomponenDto[]>,
  menus: { id: string; tipe: "regular" | "paket"; baseMenuId: string | null }[],
): { katalog: KatalogMenu; menuById: Map<string, (typeof menus)[number]> } {
  return {
    katalog: {
      rows: menus as never,
      categoryNameById: new Map(),
      komponenByMenu: new Map(Object.entries(komponen)),
      branchIdsByMenu: new Map(),
    },
    menuById: new Map(menus.map((m) => [m.id, m])),
  };
}

function komp(ingredientId: string, qty: number): KomponenDto {
  return {
    ingredient_id: ingredientId,
    slug: ingredientId,
    nama: ingredientId,
    qty,
    satuan: "gr",
    track_stok: true,
    harga_per_unit: 10,
    is_packaging: false,
    is_complement: false,
  };
}

describe("komponenEfektif", () => {
  const { katalog: kat, menuById } = katalog(
    { dasar: [komp("nasi", 200)], paket: [komp("kerupuk", 2)] },
    [
      { id: "dasar", tipe: "regular", baseMenuId: null },
      { id: "paket", tipe: "paket", baseMenuId: "dasar" },
      { id: "kosong", tipe: "regular", baseMenuId: null },
    ],
  );

  it("menu reguler = komponennya sendiri", () => {
    const hasil = komponenEfektif(kat, menuById.get("dasar")! as never);
    expect(hasil.map((k) => k.ingredient_id)).toEqual(["nasi"]);
  });

  it("menu paket = topping + resep menu dasarnya", () => {
    const hasil = komponenEfektif(kat, menuById.get("paket")! as never);
    expect(hasil.map((k) => k.ingredient_id).sort()).toEqual(["kerupuk", "nasi"]);
  });

  it("menu tanpa resep = daftar kosong, bukan lempar galat", () => {
    expect(komponenEfektif(kat, menuById.get("kosong")! as never)).toEqual([]);
  });
});

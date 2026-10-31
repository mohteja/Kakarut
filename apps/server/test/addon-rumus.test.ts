import { describe, expect, it } from "vitest";
import type { KomponenDtoPenuh } from "@kakarut/shared";
import {
  hitungHargaMenu,
  hppBaris,
  kebutuhanPorsi,
  resolusiAddon,
  snapDariPilihan,
  tambahKebutuhanBaris,
  type BahanKatalog,
  type GrupKatalog,
  type KatalogMenu,
} from "../src/modules/menu/service";

/**
 * SATU RUMUS harga/HPP/stok baris ber-add-on — dipakai createSale, cek stok,
 * gerbang stok open bill, dan rekalkulasi. Yang dipaku di sini: lantai 0 per
 * baris ("Tanpa mie" tak menambah stok), bahan di luar resep, ×jumlah, aturan
 * dine-in ikut berlaku pada bahan add-on, dan baris TANPA add-on yang tak
 * bergeser satu sen pun dari `hitungHargaMenu`.
 */
function komponen(
  id: string,
  qty: number,
  harga: number,
  o: Partial<KomponenDtoPenuh> = {},
): KomponenDtoPenuh {
  return {
    ingredient_id: id,
    slug: id,
    nama: id,
    qty,
    satuan: "g",
    track_stok: true,
    harga_per_unit: harga,
    is_packaging: false,
    is_complement: false,
    ...o,
  };
}

const bahan = (o: Partial<BahanKatalog> = {}): BahanKatalog => ({
  nama: "x",
  satuan: "g",
  harga_per_unit: 0,
  track_stok: true,
  is_packaging: false,
  is_complement: false,
  ...o,
});

const grup: GrupKatalog[] = [
  {
    id: "g-pedas",
    nama: "Level pedas",
    min_pilih: 1,
    maks_pilih: 1,
    terhapus: false,
    addons: [
      { id: "a-sedang", nama: "Sedang", harga: 0, maks_jumlah: 1, ingredient_id: null, qty_bahan: null, is_active: true, terhapus: false },
      { id: "a-pedas", nama: "Pedas", harga: 0, maks_jumlah: 1, ingredient_id: "cabai", qty_bahan: 5, is_active: true, terhapus: false },
    ],
  },
  {
    id: "g-tambah",
    nama: "Tambahan",
    min_pilih: 0,
    maks_pilih: null,
    terhapus: false,
    addons: [
      { id: "a-mie", nama: "Extra mie", harga: 3000, maks_jumlah: 3, ingredient_id: "mie", qty_bahan: 100, is_active: true, terhapus: false },
      { id: "a-tanpa-sayur", nama: "Tanpa sayur", harga: 0, maks_jumlah: 1, ingredient_id: "sayur", qty_bahan: -50, is_active: true, terhapus: false },
      { id: "a-tanpa-mie", nama: "Tanpa mie", harga: 0, maks_jumlah: 1, ingredient_id: "mie", qty_bahan: -200, is_active: true, terhapus: false },
      { id: "a-telur", nama: "Extra telur", harga: 4000, maks_jumlah: null, ingredient_id: "telur", qty_bahan: 1, is_active: true, terhapus: false },
      { id: "a-box", nama: "Box tambahan", harga: 1000, maks_jumlah: null, ingredient_id: "box", qty_bahan: 1, is_active: true, terhapus: false },
    ],
  },
];

const menu = { id: "m-mie", tipe: "regular", baseMenuId: null } as never;
const katalog: KatalogMenu = {
  rows: [menu],
  categoryNameById: new Map(),
  komponenByMenu: new Map([
    [
      "m-mie",
      [
        komponen("mie", 80, 10),
        komponen("sayur", 30, 2),
        komponen("box", 1, 500, { is_packaging: true }),
        komponen("minyak", 5, 4, { track_stok: false }),
      ],
    ],
  ]),
  branchIdsByMenu: new Map(),
  addonGroupsByMenu: new Map([["m-mie", grup]]),
  ambangFoodCost: 40,
  bahanAddon: new Map([
    ["mie", bahan({ harga_per_unit: 10 })],
    ["sayur", bahan({ harga_per_unit: 2 })],
    ["telur", bahan({ harga_per_unit: 2500 })],
    ["cabai", bahan({ harga_per_unit: 1, track_stok: false })],
    ["box", bahan({ harga_per_unit: 500, is_packaging: true })],
  ]),
};

const snap = (id: string, jumlah = 1) => snapDariPilihan(katalog, "m-mie", [{ id, jumlah }]);

describe("kebutuhanPorsi — resep + delta add-on, dilantai 0", () => {
  it("Extra mie ×2: +200 g di atas resep 80 g", () => {
    expect(kebutuhanPorsi(katalog, menu, false, snap("a-mie", 2)).get("mie")?.qty).toBe(280);
  });

  it("Tanpa mie (−200) pada resep 80 g → 0, bukan −120", () => {
    expect(kebutuhanPorsi(katalog, menu, false, snap("a-tanpa-mie")).get("mie")?.qty).toBe(0);
  });

  it("bahan di LUAR resep ikut masuk (Extra telur)", () => {
    const b = kebutuhanPorsi(katalog, menu, false, snap("a-telur", 2)).get("telur");
    expect(b?.qty).toBe(2);
    expect(b?.resep).toBe(0);
  });

  it("aturan dine-in berlaku pada bahan add-on: kemasan tambahan tak terpakai saat dine-in", () => {
    expect(kebutuhanPorsi(katalog, menu, true, snap("a-box")).get("box")?.qty).toBe(0);
    expect(kebutuhanPorsi(katalog, menu, false, snap("a-box")).get("box")?.qty).toBe(2);
  });
});

describe("tambahKebutuhanBaris — lantai PER BARIS sebelum ditumpuk", () => {
  it("'Tanpa mie' di satu baris tak mengurangi mie baris lain", () => {
    const k = new Map<string, number>();
    tambahKebutuhanBaris(k, katalog, menu, 2, false, snap("a-tanpa-mie"));
    tambahKebutuhanBaris(k, katalog, menu, 1, false, snap("a-mie"));
    // baris 1: 0 g × 2; baris 2: 180 g × 1
    expect(k.get("mie")).toBe(180);
  });

  it("bahan tak terlacak (cabai) tak menghasilkan konsumsi", () => {
    const k = tambahKebutuhanBaris(new Map(), katalog, menu, 1, false, snap("a-pedas"));
    expect(k.has("cabai")).toBe(false);
    expect(k.has("minyak")).toBe(false);
  });

  it("tanpa add-on = resep apa adanya", () => {
    const k = tambahKebutuhanBaris(new Map(), katalog, menu, 3, false);
    expect(Object.fromEntries(k)).toEqual({ mie: 240, sayur: 90, box: 3 });
  });
});

describe("hppBaris", () => {
  it("tanpa add-on PERSIS hitungHargaMenu (dine-in & bawa pulang)", () => {
    for (const dineIn of [false, true]) {
      expect(hppBaris(menu, katalog, dineIn, [])).toBe(hitungHargaMenu(menu, katalog, dineIn));
    }
  });

  it("add-on tanpa bahan tak mengubah HPP", () => {
    expect(hppBaris(menu, katalog, false, snap("a-sedang"))).toBe(hitungHargaMenu(menu, katalog, false));
  });

  it("Extra mie ×2 menambah 200 g × Rp10", () => {
    expect(hppBaris(menu, katalog, false, snap("a-mie", 2)) - hitungHargaMenu(menu, katalog, false)).toBe(2000);
  });

  it("pengurangan dibatasi takaran resep: Tanpa mie mengurangi 80 g, bukan 200 g", () => {
    expect(hppBaris(menu, katalog, false, snap("a-tanpa-mie")) - hitungHargaMenu(menu, katalog, false)).toBe(-800);
  });

  it("bahan tak terlacak tetap masuk HPP", () => {
    expect(hppBaris(menu, katalog, false, snap("a-pedas")) - hitungHargaMenu(menu, katalog, false)).toBe(5);
  });
});

describe("resolusiAddon", () => {
  it("urutan snapshot mengikuti form menu, bukan urutan klik", () => {
    const h = resolusiAddon(katalog, "m-mie", [
      { id: "a-telur", jumlah: 1 },
      { id: "a-mie", jumlah: 2 },
      { id: "a-pedas", jumlah: 1 },
    ]);
    expect(h.ok).toBe(true);
    if (h.ok) {
      expect(h.addons.map((a) => [a.grupNama, a.nama, a.jumlah, a.sortOrder])).toEqual([
        ["Level pedas", "Pedas", 1, 0],
        ["Tambahan", "Extra mie", 2, 1],
        ["Tambahan", "Extra telur", 1, 2],
      ]);
    }
  });

  it("grup wajib ditegakkan; lenien (offline) meloloskan", () => {
    expect(resolusiAddon(katalog, "m-mie", [{ id: "a-mie", jumlah: 1 }]).ok).toBe(false);
    expect(resolusiAddon(katalog, "m-mie", [{ id: "a-mie", jumlah: 1 }], { lenien: true }).ok).toBe(true);
  });

  it("menu tanpa grup + tanpa pilihan → [] (baris lama tetap sah)", () => {
    expect(resolusiAddon(katalog, "menu-lain", [])).toEqual({ ok: true, addons: [] });
  });

  it("id add-on milik menu lain → ditolak", () => {
    expect(resolusiAddon(katalog, "menu-lain", [{ id: "a-mie", jumlah: 1 }]).ok).toBe(false);
  });
});

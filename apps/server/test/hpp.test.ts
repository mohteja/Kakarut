/**
 * Uji rumus HPP terhadap nilai referensi `hpp_wb` dari Excel sumber
 * (HPP BASO revisi) untuk SEMUA resep, plus aturan dine-in, pembulatan,
 * dan rumus Paket Yamin.
 */
import { describe, expect, it } from "vitest";
import {
  foodCostPersen,
  hargaJualBulat,
  hargaPerUnit,
  hargaSaran,
  hargaSaranPaket,
  hitungHpp,
  hitungPb1,
  statusStok,
  type KomponenHpp,
} from "@kakarut/shared";
import seedData from "../src/seed/data/basooopa-backend-data.json";

const data = seedData as unknown as {
  _meta: { komponen_kemasan_take_away: string[]; komponen_complement: string };
  masters: { id: string; harga_beli: number; isi: number }[];
  recipes: {
    menu: string;
    kategori: string;
    mult: number;
    jual: number;
    komponen: { bahan: string; qty: number }[];
    hpp_wb?: number;
  }[];
  paketYamin: { menu: string; base: string; base_mult: number; jual: number }[];
};

const packaging = new Set(data._meta.komponen_kemasan_take_away);
const masterById = new Map(data.masters.map((m) => [m.id, m]));

function komponenOf(komponen: { bahan: string; qty: number }[]): KomponenHpp[] {
  return komponen
    .filter((k) => k.qty > 0)
    .map((k) => {
      const m = masterById.get(k.bahan);
      if (!m) throw new Error(`bahan tidak dikenal: ${k.bahan}`);
      return {
        qty: k.qty,
        hargaPerUnit: hargaPerUnit(m.harga_beli, m.isi),
        isPackaging: packaging.has(k.bahan),
        isComplement: k.bahan === data._meta.komponen_complement,
      };
    });
}

describe("HPP semua resep vs referensi Excel (hpp_wb)", () => {
  for (const r of data.recipes) {
    it(`${r.menu} (${r.kategori})`, () => {
      const hpp = hitungHpp(komponenOf(r.komponen));
      expect(Math.abs(hpp - r.hpp_wb!)).toBeLessThanOrEqual(1);
    });
  }
});

describe("Harga saran & pembulatan", () => {
  it("harga_jual_bulat = ROUND(saran/1000)*1000", () => {
    expect(hargaJualBulat(33986.01)).toBe(34000);
    expect(hargaJualBulat(23375)).toBe(23000);
    expect(hargaJualBulat(4956.55)).toBe(5000);
    expect(hargaJualBulat(1499.99)).toBe(1000);
    expect(hargaJualBulat(1500)).toBe(2000);
  });

  it("food cost % = hpp / harga jual × 100", () => {
    expect(foodCostPersen(16993, 34000)).toBeCloseTo(49.98, 1);
  });

  it("PB1 = round(subtotal × rate%)", () => {
    expect(hitungPb1(34000, 10)).toBe(3400);
  });
});

describe("Aturan dine-in", () => {
  const pba = data.recipes.find((r) => r.menu.startsWith("Premium Basooopa A"))!;
  it("HPP dine-in PBA = HPP − kemasan − 0.5×complement", () => {
    const komponen = komponenOf(pba.komponen);
    const hpp = hitungHpp(komponen);
    const hppDineIn = hitungHpp(komponen, true);
    const plastik = masterById.get("plastik take away")!;
    const kresek = masterById.get("kresek take away")!;
    const complement = masterById.get("complement saos & sambal")!;
    const expected =
      hpp -
      hargaPerUnit(plastik.harga_beli, plastik.isi) -
      hargaPerUnit(kresek.harga_beli, kresek.isi) -
      0.5 * hargaPerUnit(complement.harga_beli, complement.isi);
    expect(hppDineIn).toBeCloseTo(expected, 6);
    expect(hppDineIn).toBeLessThan(hpp);
  });
});

describe("Paket Yamin (rumus khusus pemilik)", () => {
  const toppingCost =
    2 * hargaPerUnit(masterById.get("baso urat kecil")!.harga_beli, masterById.get("baso urat kecil")!.isi) +
    2 * hargaPerUnit(masterById.get("baso aci original")!.harga_beli, masterById.get("baso aci original")!.isi);

  for (const p of data.paketYamin) {
    it(`${p.menu} → Rp${p.jual}`, () => {
      const base = data.recipes.find((r) => r.menu === p.base)!;
      const baseHpp = hitungHpp(komponenOf(base.komponen));
      const saran = hargaSaranPaket(baseHpp, p.base_mult, toppingCost);
      expect(hargaJualBulat(saran)).toBe(p.jual);
    });
  }
});

describe("Status stok", () => {
  it("habis: saldo ≤ 0 dan ada pemakaian", () => {
    expect(statusStok(10, 0, 10)).toBe("habis");
    expect(statusStok(10, 0, 12)).toBe("habis");
  });
  it("menipis: saldo/(awal+produksi) < 15%", () => {
    expect(statusStok(100, 0, 90)).toBe("menipis");
    expect(statusStok(100, 100, 180)).toBe("menipis");
  });
  it("aman", () => {
    expect(statusStok(100, 0, 50)).toBe("aman");
    expect(statusStok(0, 0, 0)).toBe("aman"); // belum ada apa-apa
  });
  it("harga saran reguler", () => {
    expect(hargaSaran(16993, 2)).toBeCloseTo(33986, 0);
  });
});

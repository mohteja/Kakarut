/**
 * Uji logika murni rencana stok dari menu: kebutuhan bahan, bahan pembatas,
 * dan pembulatan baris faktur (batch/pcs).
 */
import { describe, expect, it } from "vitest";
import {
  bahanPembatas,
  jumlahFaktur,
  kebutuhanBahanRencana,
  kekuranganBahan,
  porsiTersedia,
  qtyBahanPerPorsi,
} from "@kakarut/shared";

const komp = (id: string, qty: number, track = true) => ({
  ingredient_id: id,
  qty,
  track_stok: track,
});

describe("kebutuhanBahanRencana", () => {
  it("Σ porsi × qty, dijumlah per bahan lintas menu", () => {
    const menuA = qtyBahanPerPorsi([komp("baso", 5), komp("mie", 1)]);
    const menuB = qtyBahanPerPorsi([komp("baso", 2)]);
    const total = kebutuhanBahanRencana([
      { qtyPerPorsi: menuA, porsi: 10 }, // baso 50, mie 10
      { qtyPerPorsi: menuB, porsi: 20 }, // baso 40
    ]);
    expect(total.get("baso")).toBe(90);
    expect(total.get("mie")).toBe(10);
  });
  it("porsi ≤ 0 diabaikan", () => {
    const m = qtyBahanPerPorsi([komp("baso", 5)]);
    const total = kebutuhanBahanRencana([
      { qtyPerPorsi: m, porsi: 0 },
      { qtyPerPorsi: m, porsi: -3 },
    ]);
    expect(total.size).toBe(0);
  });
});

describe("bahanPembatas", () => {
  const qty = new Map([
    ["baso", 5],
    ["mie", 1],
  ]);
  it("memilih bahan dengan ⌊saldo/qty⌋ terkecil", () => {
    const saldo = new Map([
      ["baso", 100], // 20 porsi
      ["mie", 7], // 7 porsi ← pembatas
    ]);
    expect(bahanPembatas(qty, saldo)).toEqual({ ingredient_id: "mie", porsi: 7 });
  });
  it("selalu konsisten dengan porsiTersedia", () => {
    for (const saldo of [
      new Map([["baso", 100], ["mie", 7]]),
      new Map([["baso", 3], ["mie", 100]]),
      new Map([["baso", 0], ["mie", 0]]),
      new Map<string, number>(),
      new Map([["lain", 50]]),
    ]) {
      expect(bahanPembatas(qty, saldo)?.porsi ?? null).toBe(porsiTersedia(qty, saldo));
    }
  });
  it("bahan tanpa saldo dilewati; tanpa pembatas → null", () => {
    expect(bahanPembatas(qty, new Map())).toBeNull();
    expect(bahanPembatas(new Map(), new Map([["x", 5]]))).toBeNull();
  });
  it("saldo tekor (negatif) → porsi 0", () => {
    const saldo = new Map([
      ["baso", -10],
      ["mie", 100],
    ]);
    expect(bahanPembatas(qty, saldo)).toEqual({ ingredient_id: "baso", porsi: 0 });
  });
});

describe("kekuranganBahan", () => {
  it("kekurangan nyata dihitung apa adanya", () => {
    expect(kekuranganBahan(10, 3)).toBe(7);
    expect(kekuranganBahan(5, -2)).toBe(7); // saldo tekor menambah kekurangan
  });
  it("stok cukup / berlebih → 0", () => {
    expect(kekuranganBahan(3, 3)).toBe(0);
    expect(kekuranganBahan(3, 10)).toBe(0);
  });
  it("noise presisi float TIDAK memicu kekurangan (0.1×3 vs 0.3)", () => {
    expect(kekuranganBahan(0.1 * 3, 0.3)).toBe(0); // butuh 0.30000000000000004
    expect(kekuranganBahan(0.07 * 100, 7)).toBe(0); // butuh 7.000000000000001
  });
});

describe("jumlahFaktur", () => {
  it("produksi dgn isi > 1 → batch dibulatkan ke atas", () => {
    // kurang 100, isi/batch 90 → 2 batch = 180
    expect(jumlahFaktur(100, "produksi", 90, false)).toEqual({ mode: "batch", jumlah: 2, qty: 180 });
    // pas 1 batch
    expect(jumlahFaktur(90, "produksi", 90, false)).toEqual({ mode: "batch", jumlah: 1, qty: 90 });
  });
  it("produksi dgn isi 1 → pcs", () => {
    expect(jumlahFaktur(7.2, "produksi", 1, false)).toEqual({ mode: "pcs", jumlah: 8, qty: 8 });
  });
  it("produksi mengabaikan flag eceran (selalu per batch)", () => {
    expect(jumlahFaktur(100, "produksi", 90, true)).toEqual({ mode: "batch", jumlah: 2, qty: 180 });
  });
  it("beli TANPA eceran → dibulatkan per KEMASAN penuh (isi per kemasan)", () => {
    // kurang 3.2, kemasan isi 48 → 1 kemasan = 48
    expect(jumlahFaktur(3.2, "beli", 48, false)).toEqual({ mode: "batch", jumlah: 1, qty: 48 });
    expect(jumlahFaktur(10, "beli", 48, false)).toEqual({ mode: "batch", jumlah: 1, qty: 48 });
    // kurang 100 → 3 kemasan = 144
    expect(jumlahFaktur(100, "beli", 48, false)).toEqual({ mode: "batch", jumlah: 3, qty: 144 });
    // kelipatan pas → tak over-buy
    expect(jumlahFaktur(96, "beli", 48, false)).toEqual({ mode: "batch", jumlah: 2, qty: 96 });
  });
  it("beli BOLEH eceran → pcs dibulatkan ke atas (perilaku lama)", () => {
    expect(jumlahFaktur(3.2, "beli", 48, true)).toEqual({ mode: "pcs", jumlah: 4, qty: 4 });
    expect(jumlahFaktur(10, "beli", 48, true)).toEqual({ mode: "pcs", jumlah: 10, qty: 10 });
  });
  it("beli isi 1 → pcs (flag tak relevan)", () => {
    expect(jumlahFaktur(3.2, "beli", 1, false)).toEqual({ mode: "pcs", jumlah: 4, qty: 4 });
  });
  it("kurang sangat kecil → minimal 1 pcs/kemasan", () => {
    expect(jumlahFaktur(0.01, "beli", 1, false).jumlah).toBe(1);
    expect(jumlahFaktur(0.01, "beli", 100, false)).toEqual({ mode: "batch", jumlah: 1, qty: 100 });
    expect(jumlahFaktur(0.01, "produksi", 90, false).jumlah).toBe(1);
  });
});

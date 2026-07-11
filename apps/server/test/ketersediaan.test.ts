/**
 * Uji perhitungan sisa porsi menu (ketersediaan) — logika murni tanpa DB.
 */
import { describe, expect, it } from "vitest";
import {
  porsiTersedia,
  qtyBahanPerPorsi,
  type KomponenKetersediaan,
} from "@kakarut/shared";

/** helper ringkas untuk membuat komponen uji */
function k(
  ingredient_id: string,
  qty: number,
  track_stok = true,
): KomponenKetersediaan {
  return { ingredient_id, qty, track_stok };
}

describe("qtyBahanPerPorsi", () => {
  it("menjumlah qty bahan yang sama (paket: komponen sendiri + dasar)", () => {
    // paket: baso muncul di menu sendiri (1) dan menu dasar (2) → total 3/porsi
    const m = qtyBahanPerPorsi([k("baso", 1), k("mie", 1), k("baso", 2)]);
    expect(m.get("baso")).toBe(3);
    expect(m.get("mie")).toBe(1);
  });

  it("mengabaikan bahan tak-terlacak dan qty ≤ 0", () => {
    const m = qtyBahanPerPorsi([k("baso", 1), k("bumbu", 2, false), k("nol", 0)]);
    expect(m.get("baso")).toBe(1);
    expect(m.has("bumbu")).toBe(false);
    expect(m.has("nol")).toBe(false);
  });

  it("MEMPERHITUNGKAN kemasan terlacak (bukan diabaikan)", () => {
    // regresi: kemasan (mis. box/plastik) tetap masuk hitungan — bawa pulang
    // memakainya penuh, jadi kemasan yang menipis adalah pembatas nyata.
    const m = qtyBahanPerPorsi([k("nasi", 1), k("box", 1)]);
    expect(m.get("box")).toBe(1);
  });
});

describe("porsiTersedia", () => {
  it("kemasan terlacak yang menipis membatasi porsi (bug review)", () => {
    // nasi cukup untuk 100 porsi, tapi hanya ada 2 box → maksimal 2 porsi.
    const qty = qtyBahanPerPorsi([k("nasi", 1), k("box", 1)]);
    const saldo = new Map([
      ["nasi", 100],
      ["box", 2],
    ]);
    expect(porsiTersedia(qty, saldo)).toBe(2);
  });

  it("ambil minimum saldo/qty atas semua bahan pembatas", () => {
    const qty = qtyBahanPerPorsi([k("a", 2), k("b", 1)]);
    const saldo = new Map([
      ["a", 10], // 10/2 = 5
      ["b", 3], // 3/1 = 3  ← pembatas
    ]);
    expect(porsiTersedia(qty, saldo)).toBe(3);
  });

  it("membulatkan ke bawah untuk qty pecahan", () => {
    const qty = qtyBahanPerPorsi([k("a", 0.75)]);
    expect(porsiTersedia(qty, new Map([["a", 10]]))).toBe(13); // ⌊10/0.75⌋ = 13
  });

  it("saldo tekor (negatif) dianggap habis → 0, tak pernah negatif", () => {
    const qty = qtyBahanPerPorsi([k("a", 1), k("b", 1)]);
    const saldo = new Map([
      ["a", -5],
      ["b", 100],
    ]);
    expect(porsiTersedia(qty, saldo)).toBe(0);
  });

  it("null bila tak ada bahan pembatas (menu tanpa bahan terlacak)", () => {
    expect(porsiTersedia(new Map(), new Map([["x", 5]]))).toBeNull();
    // semua bahan tak-terlacak → qty map kosong → null
    const qty = qtyBahanPerPorsi([k("a", 1, false)]);
    expect(porsiTersedia(qty, new Map())).toBeNull();
  });

  it("bahan tanpa entri saldo (nonaktif di cabang) tidak membatasi", () => {
    const qty = qtyBahanPerPorsi([k("ada", 1), k("nonaktif", 1)]);
    // hanya "ada" punya saldo → hanya itu yang membatasi
    expect(porsiTersedia(qty, new Map([["ada", 7]]))).toBe(7);
  });

  it("saldo tepat 0 → porsi 0 (Habis)", () => {
    const qty = qtyBahanPerPorsi([k("a", 1)]);
    expect(porsiTersedia(qty, new Map([["a", 0]]))).toBe(0);
  });
});

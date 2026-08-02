import { describe, expect, it } from "vitest";
import {
  hitungUangSetelahRefund,
  nominalRefund,
  qtyDitagih,
  type BarisRefund,
} from "@kakarut/shared";

/**
 * Refund sebagian: yang dikembalikan harus PERSIS yang dibayar pembeli untuk
 * porsi itu — termasuk bagian diskon & PB1 yang melekat padanya.
 */
describe("hitungUangSetelahRefund", () => {
  const asal = { subtotal: 100_000, diskon: 10_000, pb1: 9_000 }; // PB1 10% dari net 90.000
  const utuh = { ...asal, total: 99_000 };

  it("tanpa refund: angkanya tak bergerak sama sekali", () => {
    const baris: BarisRefund[] = [
      { hargaSatuan: 20_000, qty: 3, qtyRefund: 0 },
      { hargaSatuan: 40_000, qty: 1, qtyRefund: 0 },
    ];
    expect(hitungUangSetelahRefund(baris, asal)).toEqual(utuh);
  });

  it("refund 1 dari 3 porsi: diskon & PB1 ikut menyusut sebanding", () => {
    const baris: BarisRefund[] = [
      { hargaSatuan: 20_000, qty: 3, qtyRefund: 1 }, // sisa 2 → 40.000
      { hargaSatuan: 40_000, qty: 1, qtyRefund: 0 }, // 40.000
    ];
    const sesudah = hitungUangSetelahRefund(baris, asal);
    expect(sesudah.subtotal).toBe(80_000);
    expect(sesudah.diskon).toBe(8_000); // 10.000 × 80%
    expect(sesudah.pb1).toBe(7_200); // 10% dari net 72.000
    expect(sesudah.total).toBe(79_200);
    // Pembeli menerima kembali persis porsi yang ia bayar untuk 1 sajian itu.
    expect(nominalRefund(utuh, sesudah)).toBe(19_800);
  });

  it("seluruh sajian dikembalikan: semuanya nol, bukan negatif", () => {
    const baris: BarisRefund[] = [
      { hargaSatuan: 20_000, qty: 3, qtyRefund: 3 },
      { hargaSatuan: 40_000, qty: 1, qtyRefund: 1 },
    ];
    const sesudah = hitungUangSetelahRefund(baris, asal);
    expect(sesudah).toEqual({ subtotal: 0, diskon: 0, pb1: 0, total: 0 });
    expect(nominalRefund(utuh, sesudah)).toBe(99_000);
  });

  it("bertahap: dua refund terpisah = satu refund sekaligus", () => {
    // `qtyRefund` KUMULATIF, jadi tiap hitungan berangkat dari `asal` lagi —
    // diskonnya tak boleh tergerus dua kali.
    const sekaligus = hitungUangSetelahRefund(
      [{ hargaSatuan: 25_000, qty: 4, qtyRefund: 2 }],
      { subtotal: 100_000, diskon: 10_000, pb1: 9_000 },
    );
    const tahap1 = hitungUangSetelahRefund(
      [{ hargaSatuan: 25_000, qty: 4, qtyRefund: 1 }],
      { subtotal: 100_000, diskon: 10_000, pb1: 9_000 },
    );
    const tahap2 = hitungUangSetelahRefund(
      [{ hargaSatuan: 25_000, qty: 4, qtyRefund: 2 }],
      { subtotal: 100_000, diskon: 10_000, pb1: 9_000 },
    );
    expect(tahap2).toEqual(sekaligus);
    // total uang kembali lewat dua tahap = lewat satu tahap
    const utuh4 = { subtotal: 100_000, diskon: 10_000, pb1: 9_000, total: 99_000 };
    expect(nominalRefund(utuh4, tahap1) + nominalRefund(tahap1, tahap2)).toBe(
      nominalRefund(utuh4, sekaligus),
    );
  });

  it("tanpa diskon & tanpa PB1: refund = harga sajiannya apa adanya", () => {
    const polos = { subtotal: 50_000, diskon: 0, pb1: 0 };
    const sesudah = hitungUangSetelahRefund(
      [{ hargaSatuan: 10_000, qty: 5, qtyRefund: 2 }],
      polos,
    );
    expect(sesudah).toEqual({ subtotal: 30_000, diskon: 0, pb1: 0, total: 30_000 });
    expect(nominalRefund({ ...polos, total: 50_000 }, sesudah)).toBe(20_000);
  });

  it("diskon tak pernah membuat total negatif walau pembulatan meleset", () => {
    // diskon 100% — sisa berapa pun, total tak boleh di bawah nol
    const semua = { subtotal: 7, diskon: 7, pb1: 0 };
    const sesudah = hitungUangSetelahRefund(
      [{ hargaSatuan: 1, qty: 7, qtyRefund: 4 }],
      semua,
    );
    expect(sesudah.total).toBeGreaterThanOrEqual(0);
    expect(sesudah.diskon).toBeLessThanOrEqual(sesudah.subtotal);
  });

  it("qtyDitagih tak pernah negatif walau data lama menyimpan refund berlebih", () => {
    expect(qtyDitagih({ qty: 2, qtyRefund: 5 })).toBe(0);
  });

  /**
   * Sifat yang DIANDALKAN rekap tutup kasir: `total + refund_total` harus
   * kembali persis ke nilai yang dulu benar-benar ditagih. Rekap shift memakai
   * itu sebagai angka kotor lalu mengurangi refund yang terjadi di jendelanya
   * sendiri — supaya refund atas transaksi shift kemarin tidak menggeser rekap
   * shift yang sudah ditutup. Kalau penjumlahan nominalnya meleset walau satu
   * rupiah karena pembulatan bertahap, selisih kas ikut meleset.
   */
  it("nominal refund bertahap menjumlah persis ke total asal", () => {
    for (let i = 0; i < 2000; i++) {
      const harga = 333 + ((i * 977) % 40_000);
      const qty = 2 + (i % 8);
      const subtotal = harga * qty;
      const diskon = Math.round((subtotal * (i % 37)) / 100);
      const pb1 = Math.round(((subtotal - diskon) * 10) / 100);
      const asalI = { subtotal, diskon, pb1 };
      let total = subtotal - diskon + pb1;
      const totalAsal = total;
      let refundTotal = 0;
      // Dikembalikan satu porsi demi satu porsi sampai habis — tiap langkah
      // berjangkar ke `asalI`, persis seperti kolom `*_asal` di database.
      for (let r = 1; r <= qty; r++) {
        const sesudah = hitungUangSetelahRefund(
          [{ hargaSatuan: harga, qty, qtyRefund: r }],
          asalI,
        );
        refundTotal += nominalRefund({ ...asalI, total }, sesudah);
        total = sesudah.total;
      }
      expect(total).toBe(0);
      expect(total + refundTotal).toBe(totalAsal);
    }
  });

  it("acak: total sesudah refund tak pernah melebihi total asal", () => {
    for (let i = 0; i < 2000; i++) {
      const harga = 500 + ((i * 137) % 50_000);
      const qty = 1 + (i % 9);
      const refund = i % (qty + 1);
      const subtotal = harga * qty;
      const diskon = Math.round((subtotal * (i % 31)) / 100);
      const pb1 = Math.round(((subtotal - diskon) * 10) / 100);
      const asalI = { subtotal, diskon, pb1 };
      const utuhI = { ...asalI, total: subtotal - diskon + pb1 };
      const sesudah = hitungUangSetelahRefund(
        [{ hargaSatuan: harga, qty, qtyRefund: refund }],
        asalI,
      );
      expect(sesudah.total).toBeLessThanOrEqual(utuhI.total);
      expect(sesudah.total).toBeGreaterThanOrEqual(0);
      expect(nominalRefund(utuhI, sesudah)).toBeGreaterThanOrEqual(0);
    }
  });
});

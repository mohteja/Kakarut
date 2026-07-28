/**
 * Aturan KEMASAN pada kiriman antar-cabang — logika murni tanpa DB.
 *
 * Kaidahnya: barang yang hanya bisa DIBELI per kemasan juga hanya boleh
 * DIKIRIM per kemasan. Predikatnya sengaja dibagi dengan `jumlahFaktur`
 * (belanja) supaya keduanya tak pernah berbeda pendapat.
 */
import { describe, expect, it } from "vitest";
import {
  bergerakPerKemasan,
  cekKirimKemasan,
  jumlahFaktur,
  wajibKelipatanKirim,
} from "@kakarut/shared";

/** Sayur: satuan kerja gr, dibeli per kg (1 kg = 1000 gr), tak boleh eceran. */
const sayur = { isi: 1000, pengadaan: "beli" as const, bolehEceran: false };

describe("bergerakPerKemasan", () => {
  it("beli tak boleh eceran & isi > 1 → per kemasan", () => {
    expect(bergerakPerKemasan("beli", 1000, false)).toBe(true);
  });

  it("beli BOLEH eceran → bebas, walau isi > 1", () => {
    expect(bergerakPerKemasan("beli", 1000, true)).toBe(false);
  });

  it("produksi selalu per batch bila isi > 1, boleh_eceran diabaikan", () => {
    expect(bergerakPerKemasan("produksi", 500, true)).toBe(true);
  });

  it("KIRIM lebih sempit: produksi TIDAK dikunci kelipatan", () => {
    // `isi` bahan produksi = ukuran batch, bukan kemasan fisik. CK memproduksi
    // 100 butir lalu mengirim 40 ke cabang adalah alur normal.
    expect(bergerakPerKemasan("produksi", 100, false)).toBe(true);
    expect(wajibKelipatanKirim("produksi", 100, false)).toBe(false);
    expect(cekKirimKemasan({ qty: 40, isi: 100, pengadaan: "produksi", bolehEceran: false }).ok)
      .toBe(true);
  });

  it("beli tak boleh eceran → kirim TETAP dikunci", () => {
    expect(wajibKelipatanKirim("beli", 1000, false)).toBe(true);
    expect(wajibKelipatanKirim("beli", 1000, true)).toBe(false);
    expect(wajibKelipatanKirim("beli", 1, false)).toBe(false);
  });

  it("isi = 1 (tanpa kemasan) → selalu bebas", () => {
    expect(bergerakPerKemasan("beli", 1, false)).toBe(false);
    expect(bergerakPerKemasan("produksi", 1, false)).toBe(false);
  });

  it("sepakat dengan jumlahFaktur: yang per kemasan dibelanjakan mode batch", () => {
    for (const [pengadaan, isi, eceran] of [
      ["beli", 1000, false],
      ["beli", 1000, true],
      ["produksi", 500, false],
      ["beli", 1, false],
    ] as const) {
      const perKemasan = bergerakPerKemasan(pengadaan, isi, eceran);
      expect(jumlahFaktur(1, pengadaan, isi, eceran).mode).toBe(perKemasan ? "batch" : "pcs");
    }
  });
});

describe("cekKirimKemasan", () => {
  it("kelipatan penuh → boleh (1 kg, 2 kg)", () => {
    expect(cekKirimKemasan({ qty: 1000, ...sayur }).ok).toBe(true);
    expect(cekKirimKemasan({ qty: 3000, ...sayur }).ok).toBe(true);
  });

  it("900 gr dari kemasan 1 kg → DITOLAK, dengan saran bawah & atas", () => {
    const r = cekKirimKemasan({ qty: 900, ...sayur });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.bawah).toBe(0);
      expect(r.atas).toBe(1000);
    }
  });

  it("1.900 gr → saran 1.000 atau 2.000", () => {
    const r = cekKirimKemasan({ qty: 1900, ...sayur });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.bawah).toBe(1000);
      expect(r.atas).toBe(2000);
    }
  });

  it("bahan boleh eceran → 900 gr tetap boleh", () => {
    expect(cekKirimKemasan({ qty: 900, isi: 1000, pengadaan: "beli", bolehEceran: true }).ok).toBe(
      true,
    );
  });

  it("KIRIM HABIS: qty = seluruh sisa → boleh walau bukan kelipatan", () => {
    expect(cekKirimKemasan({ qty: 900, ...sayur, sisa: 900 }).ok).toBe(true);
  });

  it("sisa lebih banyak dari qty → pengecualian kirim-habis TIDAK berlaku", () => {
    expect(cekKirimKemasan({ qty: 900, ...sayur, sisa: 2500 }).ok).toBe(false);
  });

  it("sisa tak diketahui → pengecualian dilewati (tetap ditolak)", () => {
    expect(cekKirimKemasan({ qty: 900, ...sayur }).ok).toBe(false);
  });

  it("toleran terhadap pecahan pembulatan numeric(…,2)", () => {
    expect(cekKirimKemasan({ qty: 999.9999999, ...sayur }).ok).toBe(true);
    expect(cekKirimKemasan({ qty: 2000.0000001, ...sayur }).ok).toBe(true);
  });

  it("isi = 1 → berapa pun boleh (tak ada kemasan yang dilanggar)", () => {
    expect(
      cekKirimKemasan({ qty: 7, isi: 1, pengadaan: "beli", bolehEceran: false }).ok,
    ).toBe(true);
  });
});

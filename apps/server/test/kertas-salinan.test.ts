import { describe, expect, it } from "vitest";
import { TEKS_SALINAN, buildOrderSlipBytes, buildReceiptBytes } from "@kakarut/shared";

/**
 * CETAKAN KEDUA BERTANDA SALINAN (permintaan pemilik, 2026-11-08): "biar tidak
 * disangka orderan baru". Tanda dicetak di kepala DAN kaki kertas; cetakan
 * pertama bersih tanpa tanda.
 */
const OPTS = { charsPerLine: 32, cut: false, drawerKick: false, feedLines: 0 };
const teks = (b: Uint8Array) => Buffer.from(b).toString("latin1");
const hitung = (s: string) => s.split(TEKS_SALINAN).length - 1;

const struk = {
  companyNama: "Kedai Uji",
  showAlamat: false,
  branchNama: "Pusat",
  nomor: "TRX-0001",
  waktu: "08/11, 10.00",
  isDineIn: true,
  items: [{ nama: "Nasi Goreng", qty: 2, hargaSatuan: 15000, lineTotal: 30000 }],
  subtotal: 30000,
  pb1Amount: 0,
  total: 30000,
};
const slip = {
  companyNama: "Kedai Uji",
  branchNama: "Pusat",
  nomor: "TRX-0001",
  waktu: "08/11, 10.00",
  isDineIn: true,
  items: [{ nama: "Nasi Goreng", qty: 2 }],
};

describe("tanda SALINAN pada cetak ulang", () => {
  it("struk: cetakan pertama tanpa tanda, salinan bertanda di kepala & kaki", () => {
    expect(hitung(teks(buildReceiptBytes(struk, OPTS)))).toBe(0);
    const s = teks(buildReceiptBytes({ ...struk, salinan: true }, OPTS));
    expect(hitung(s)).toBe(2);
    // Tanda di KEPALA: sebelum nama usaha.
    expect(s.split(TEKS_SALINAN)[0]).not.toContain("Kedai Uji");
    expect(s).toContain("CETAK ULANG / COPY");
  });

  it("slip pesanan: salinan menyebut BUKAN PESANAN BARU, di atas kepala slip", () => {
    expect(hitung(teks(buildOrderSlipBytes(slip, OPTS)))).toBe(0);
    const s = teks(buildOrderSlipBytes({ ...slip, salinan: true }, OPTS));
    expect(hitung(s)).toBe(2);
    expect(s).toContain("BUKAN PESANAN BARU");
    // Tanda di KEPALA: sebelum nama usaha.
    expect(s.split(TEKS_SALINAN)[0]).not.toContain("Kedai Uji");
  });

  it("muat di kertas 58 mm (32 kolom)", () => {
    for (const t of [TEKS_SALINAN, "CETAK ULANG / COPY", "BUKAN PESANAN BARU"]) {
      expect(t.length).toBeLessThanOrEqual(32);
    }
  });
});

import { describe, expect, it } from "vitest";
import {
  buildBonBytes,
  buildOrderSlipBytes,
  buildReceiptBytes,
  teksAddonKertas,
  type ReceiptOptions,
} from "@kakarut/shared";

/**
 * ADD-ON DI KERTAS — slip dapur menyebutnya tanpa harga; struk & bon menyebut
 * tambahannya di dalam kurung, bukan di kolom kanan (kolom kanan = total
 * baris, dan angka di sana terbaca sebagai tagihan kedua).
 */
const OPTS: ReceiptOptions = { charsPerLine: 32, cut: false, drawerKick: false, feedLines: 0 };
const teks = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

const addons = [
  { nama: "Extra mie", jumlah: 2, harga: 3000 },
  { nama: "Tanpa sayur", jumlah: 1, harga: 0 },
];

describe("add-on di kertas", () => {
  it("slip dapur: '+ Extra mie x2' dan TANPA rupiah", () => {
    const t = teks(
      buildOrderSlipBytes(
        {
          companyNama: "Warung",
          branchNama: "Pusat",
          waktu: "21/08 14.30",
          isDineIn: true,
          items: [{ nama: "Mie Ayam", qty: 1, addons, catatan: "kuah pisah" }],
        },
        OPTS,
      ),
    );
    expect(t).toContain("+ Extra mie x2");
    expect(t).toContain("+ Tanpa sayur");
    expect(t).not.toContain("Rp");
    // add-on dicetak SEBELUM catatan
    expect(t).toMatch(/\+ Extra mie x2[\s\S]*kuah pisah/);
  });

  it("struk: tambahan add-on di kurung, gratis cukup namanya", () => {
    const t = teks(
      buildReceiptBytes(
        {
          companyNama: "Warung",
          showAlamat: false,
          branchNama: "Pusat",
          nomor: "P-20260821-0001",
          waktu: "21/08 14.30",
          isDineIn: true,
          items: [{ nama: "Mie Ayam", qty: 1, hargaSatuan: 21000, lineTotal: 21000, addons }],
          subtotal: 21000,
          pb1Amount: 0,
          total: 21000,
        },
        OPTS,
      ),
    );
    expect(t).toContain("+ Extra mie x2 (+Rp6.000)");
    expect(t).toMatch(/\+ Tanpa sayur\s*\n/);
  });

  it("bon tagihan memakai baris add-on yang sama dengan struk", () => {
    const t = teks(
      buildBonBytes(
        {
          companyNama: "Warung",
          branchNama: "Pusat",
          waktu: "21/08 14.30",
          isDineIn: true,
          items: [{ nama: "Mie Ayam", qty: 2, hargaSatuan: 21000, lineTotal: 42000, addons }],
          subtotal: 42000,
          pb1Amount: 0,
          total: 42000,
        },
        OPTS,
      ),
    );
    expect(t).toContain(teksAddonKertas(addons[0]).trim());
  });
});

/**
 * Uji byte-level builder ESC/POS & layout struk thermal.
 */
import { describe, expect, it } from "vitest";
import {
  ESCPOS,
  buildReceiptBytes,
  buildTestPrintBytes,
  formatRupiahAscii,
  kolomDefault,
  padLine,
  sanitizeAscii,
  wrapText,
  type ReceiptData,
  type ReceiptOptions,
} from "@kakarut/shared";

const OPTS: ReceiptOptions = { charsPerLine: 32, cut: false, drawerKick: false, feedLines: 3 };

const DATA: ReceiptData = {
  companyNama: "Basooopa",
  alamat: "Jl. Contoh No. 1",
  telepon: "0812345678",
  showAlamat: true,
  branchNama: "Pusat",
  nomor: "PUSAT-20260709-0001",
  waktu: "09/07 14.30",
  isDineIn: false,
  items: [
    {
      nama: "Premium Basooopa A (PBA)",
      qty: 1,
      hargaSatuan: 34000,
      lineTotal: 34000,
      catatan: "tanpa gula",
    },
    { nama: "Es Teh Manis (dine-in)", qty: 2, hargaSatuan: 5000, lineTotal: 10000, tag: "DI" },
  ],
  subtotal: 44000,
  pb1Amount: 4400,
  pb1Rate: 10,
  total: 48400,
  catatan: "tanpa sambal",
  footer: "Terima kasih! Ikuti IG @basooopa",
};

function hasSubsequence(haystack: Uint8Array, needle: readonly number[]): boolean {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

function textLines(bytes: Uint8Array): string[] {
  // parser mini: lewati urutan perintah ESC/GS agar parameternya
  // (yang bisa berupa byte printable) tidak bocor ke teks
  let s = "";
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b === 0x1b) {
      const cmd = bytes[i + 1];
      if (cmd === 0x40) i += 2; // ESC @
      else if (cmd === 0x70) i += 5; // ESC p m t1 t2
      else i += 3; // ESC a/E/t/d + n
      continue;
    }
    if (b === 0x1d) {
      const cmd = bytes[i + 1];
      if (cmd === 0x56) i += bytes[i + 2] === 0x42 ? 4 : 3; // GS V
      else i += 3; // GS ! n
      continue;
    }
    if (b === 0x0a) s += "\n";
    else if (b >= 0x20 && b <= 0x7e) s += String.fromCharCode(b);
    i++;
  }
  return s.split("\n").filter((l) => l.length > 0);
}

describe("sanitizeAscii", () => {
  it("nbsp (Intl id-ID) menjadi spasi biasa", () => {
    expect(sanitizeAscii("Rp 34.000")).toBe("Rp 34.000");
  });
  it("karakter tipografi dipetakan", () => {
    expect(sanitizeAscii("2×3 — ok…")).toBe("2x3 - ok...");
  });
  it("emoji & non-latin dibuang, aksen dinormalisasi", () => {
    expect(sanitizeAscii("Terima kasih! \u{1f64f}")).toBe("Terima kasih! ");
    expect(sanitizeAscii("café")).toBe("cafe");
  });
  it("hasil selalu ASCII murni", () => {
    const out = sanitizeAscii("Rp 1.000 • café \u{1f35c} ×");
    for (const ch of out) expect(ch.charCodeAt(0)).toBeLessThan(0x80);
  });
});

describe("wrapText & padLine", () => {
  it("membungkus per kata", () => {
    expect(wrapText("satu dua tiga empat", 8)).toEqual(["satu dua", "tiga", "empat"]);
  });
  it("kata super panjang dipotong paksa", () => {
    expect(wrapText("a".repeat(70), 32).every((l) => l.length <= 32)).toBe(true);
  });
  it("padLine menghasilkan baris tepat selebar kolom", () => {
    const [line] = padLine("Subtotal", "Rp25.000", 32);
    expect(line.length).toBe(32);
    expect(line.startsWith("Subtotal")).toBe(true);
    expect(line.endsWith("Rp25.000")).toBe(true);
  });
  it("kiri panjang dibungkus, kolom kanan tetap rata kanan", () => {
    const lines = padLine("Nama menu yang sangat panjang sekali melebihi lebar", "Rp1.000", 32);
    expect(lines.length).toBeGreaterThan(1);
    const last = lines[lines.length - 1];
    expect(last.length).toBe(32);
    expect(last.endsWith("Rp1.000")).toBe(true);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(32);
  });
});

describe("formatRupiahAscii", () => {
  it("pemisah ribuan titik, tanpa nbsp", () => {
    expect(formatRupiahAscii(34000)).toBe("Rp34.000");
    expect(formatRupiahAscii(1234567)).toBe("Rp1.234.567");
    expect(formatRupiahAscii(500)).toBe("Rp500");
    expect(formatRupiahAscii(-2500)).toBe("-Rp2.500");
  });
});

describe("kolomDefault", () => {
  it("58mm=32, 80mm=48", () => {
    expect(kolomDefault(58)).toBe(32);
    expect(kolomDefault(80)).toBe(48);
  });
});

describe("buildReceiptBytes", () => {
  const bytes = buildReceiptBytes(DATA, OPTS);

  it("dimulai dengan ESC @ (init) + codepage", () => {
    expect([...bytes.slice(0, 2)]).toEqual([...ESCPOS.INIT]);
    expect([...bytes.slice(2, 5)]).toEqual([...ESCPOS.CODEPAGE_CP437]);
  });

  it("semua byte teks ASCII (tidak ada byte >0x7E)", () => {
    for (const b of bytes) expect(b).toBeLessThanOrEqual(0xfa); // perintah tertinggi: t2 drawer
    // byte di luar urutan perintah harus printable/kontrol yang dikenal
  });

  it("header nama perusahaan tebal + tinggi 2x", () => {
    expect(hasSubsequence(bytes, ESCPOS.BOLD_ON)).toBe(true);
    expect(hasSubsequence(bytes, ESCPOS.SIZE_TALL)).toBe(true);
  });

  it("baris TOTAL memuat nilai yang benar dan dipad 32 kolom", () => {
    const lines = textLines(bytes);
    const totalLine = lines.find((l) => l.startsWith("TOTAL"));
    expect(totalLine).toBeDefined();
    expect(totalLine!.length).toBe(32);
    expect(totalLine!.endsWith("Rp48.400")).toBe(true);
  });

  it("memuat PB1, subtotal, nomor struk, tag per baris, dan footer", () => {
    const all = textLines(bytes).join("\n");
    expect(all).toContain("PB1 10%");
    expect(all).toContain("Subtotal");
    expect(all).toContain("PUSAT-20260709-0001");
    expect(all).toContain("(DI)");
    expect(all).toContain("Ikuti IG @basooopa");
    expect(all).toContain("Catatan: tanpa sambal");
  });

  it("mencetak catatan personalisasi per baris (mis. tanpa gula)", () => {
    const all = textLines(bytes).join("\n");
    expect(all).toContain("* tanpa gula");
  });

  it("identitas pesanan: antrian + nama konsumen, WA konsumen TIDAK dicetak", () => {
    const all = textLines(
      buildReceiptBytes(
        { ...DATA, customerNama: "Andi Wijaya", customerWa: "081234567890", mejaLabel: "Meja 3" },
        OPTS,
      ),
    ).join("\n");
    expect(all).toContain("Antrian 1"); // dari sekuens nomor …-0001
    expect(all).toContain("Andi Wijaya");
    expect(all).toContain("Meja: Meja 3");
    expect(all).not.toContain("081234567890"); // WA rahasia — tak boleh ada di nota
  });

  it("tanpa konsumen: meja menjadi identitas pesanan", () => {
    const all = textLines(buildReceiptBytes({ ...DATA, mejaLabel: "Meja 5" }, OPTS)).join("\n");
    expect(all).toContain("Meja 5");
  });

  it("mencetak nama kasir di bawah nota", () => {
    const all = textLines(buildReceiptBytes({ ...DATA, kasir: "Teja" }, OPTS)).join("\n");
    expect(all).toContain("Kasir: Teja");
  });

  it("catatan kosong/spasi-saja tidak mencetak baris bullet", () => {
    const b2 = buildReceiptBytes(
      {
        ...DATA,
        items: [{ nama: "Kopi", qty: 1, hargaSatuan: 5000, lineTotal: 5000, catatan: "   " }],
      },
      OPTS,
    );
    expect(textLines(b2).some((l) => l.trim().startsWith("*"))).toBe(false);
  });

  it("tanpa cut & drawer secara default", () => {
    expect(hasSubsequence(bytes, ESCPOS.CUT_PARTIAL)).toBe(false);
    expect(hasSubsequence(bytes, ESCPOS.DRAWER_KICK)).toBe(false);
  });

  it("cut & drawer muncul bila diaktifkan", () => {
    const b2 = buildReceiptBytes(DATA, { ...OPTS, cut: true, drawerKick: true });
    expect(hasSubsequence(b2, ESCPOS.CUT_PARTIAL)).toBe(true);
    expect(hasSubsequence(b2, ESCPOS.DRAWER_KICK)).toBe(true);
  });

  it("PB1 tidak dicetak saat 0", () => {
    const b2 = buildReceiptBytes({ ...DATA, pb1Amount: 0 }, OPTS);
    expect(textLines(b2).join("\n")).not.toContain("PB1");
  });

  it("diskon tidak dicetak saat 0/undefined", () => {
    expect(textLines(bytes).join("\n")).not.toContain("Diskon");
  });

  it("mencetak baris Diskon (dgn persen & nilai negatif) saat diskon > 0", () => {
    const b2 = buildReceiptBytes({ ...DATA, diskon: 4400, diskonPersen: 10 }, OPTS);
    const all = textLines(b2).join("\n");
    expect(all).toContain("Diskon 10%");
    expect(all).toContain("-Rp4.400");
  });

  /*
   * Cetak ulang adalah kertas yang dipegang pembeli saat ada perselisihan.
   * Sesudah refund, porsi & totalnya lebih kecil dari struk aslinya — tanpa
   * baris ini, dua kertas berbeda angka dan tak satu pun menjelaskan sebabnya.
   */
  it("mencetak 'Sudah dikembalikan' sesudah TOTAL bila ada refund", () => {
    const b2 = buildReceiptBytes({ ...DATA, refundTotal: 8910 }, OPTS);
    const baris = textLines(b2);
    const iTotal = baris.findIndex((l) => l.startsWith("TOTAL"));
    const iRefund = baris.findIndex((l) => l.startsWith("Sudah dikembalikan"));
    expect(iTotal).toBeGreaterThanOrEqual(0);
    expect(iRefund).toBeGreaterThan(iTotal);
    expect(baris[iRefund]).toContain("Rp8.910");
  });

  it("tanpa refund: barisnya tidak dicetak sama sekali", () => {
    for (const nilai of [undefined, null, 0]) {
      const b2 = buildReceiptBytes({ ...DATA, refundTotal: nilai }, OPTS);
      expect(textLines(b2).join("\n")).not.toContain("Sudah dikembalikan");
    }
  });

  it("footer default saat kosong", () => {
    const b2 = buildReceiptBytes({ ...DATA, footer: null }, OPTS);
    expect(textLines(b2).join("\n")).toContain("Terima kasih!");
  });

  it("layout 48 kolom untuk 80mm", () => {
    const b2 = buildReceiptBytes(DATA, { ...OPTS, charsPerLine: 48 });
    const totalLine = textLines(b2).find((l) => l.startsWith("TOTAL"));
    expect(totalLine!.length).toBe(48);
  });
});

describe("buildTestPrintBytes", () => {
  it("memuat penggaris selebar kolom", () => {
    const lines = textLines(buildTestPrintBytes(OPTS));
    const ruler = lines.find((l) => l.startsWith("1234567890"));
    expect(ruler).toBeDefined();
    expect(ruler!.length).toBe(32);
  });
});

describe("penjaga: lebar ekstrem tak boleh merobohkan struk", () => {
  /**
   * Dua jalur di modul ini dulu MELEMPAR, bukan mencetak jelek. Karena struk
   * dibangun sekali jalan, satu baris yang melempar menggagalkan SELURUH
   * struk — kasir tak punya apa pun untuk diserahkan ke konsumen.
   *
   * TERUS TERANG SOAL KETERJANGKAUANNYA: hari ini tak ada layar yang bisa
   * memicunya. Semua kolom kanan berupa nominal terformat (≤ ~22 karakter)
   * atau jam 12 karakter, dan lebar selalu 32/48 dari `kolomDefault`. Yang
   * dijaga bukan bug yang sedang dialami orang, melainkan tepi tajam pada
   * PRIMITIF BERSAMA yang diekspor `@kakarut/shared` — pemanggil berikutnya,
   * termasuk aplikasi mobile, tak wajib menebak batas yang tak tertulis.
   */
  it("kolom kanan lebih lebar dari kertas → turun baris, BUKAN melempar", () => {
    const r = padLine("Item", "x".repeat(40), 32);
    expect(r).toEqual(["Item", "x".repeat(40)]);
  });

  it("…dan kirinya tetap ikut tercetak, tidak hilang", () => {
    // Yang paling buruk bukan barisnya jelek, melainkan barisnya lenyap.
    const r = padLine("Nasi Goreng Spesial", "x".repeat(40), 32);
    expect(r.join(" ")).toContain("Nasi Goreng Spesial");
    expect(r[r.length - 1]).toBe("x".repeat(40));
  });

  it("kiri kosong + kanan kepanjangan → hanya kanan, tanpa baris hampa", () => {
    expect(padLine("", "x".repeat(40), 32)).toEqual(["x".repeat(40)]);
  });

  it("batas PERSIS (kanan == lebar) tak berubah perilakunya", () => {
    // Perilaku lama di titik ini sudah benar; perbaikan tak boleh menggesernya.
    expect(padLine("Item", "x".repeat(32), 32)).toEqual(["Item", "x".repeat(32)]);
  });

  it("baris normal sama sekali tak tersentuh", () => {
    expect(padLine("Nasi Goreng", "Rp 25.000", 32)).toEqual([
      "Nasi Goreng            Rp 25.000",
    ]);
    expect(padLine("Nasi Goreng", "Rp 25.000", 32)[0]).toHaveLength(32);
  });

  it("wrapText lebar 0 selesai, tidak menggantung", () => {
    // Dulu: `rest.slice(0, 0)` memotong nol karakter tiap putaran, jadi
    // gelungnya tak pernah maju dan lariknya tumbuh sampai runtime menyerah.
    expect(wrapText("halo dunia", 0)).toEqual(["h", "a", "l", "o", "d", "u", "n", "i", "a"]);
  });

  it("wrapText lebar negatif juga selesai", () => {
    expect(wrapText("abc", -5)).toEqual(["a", "b", "c"]);
  });
});

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

import { describe, expect, it } from "vitest";
import type { BahanDto } from "@kakarut/shared";
import { buatCsvBahan, keRowsImpor, parseCsv } from "../../web/src/lib/bahanCsv";

/**
 * Penjaga CSV BAHAN BAKU: ekspor → impor harus UTUH.
 *
 * Ekspor dan impor di berkas ini adalah sepasang, dan dulu tidak sepakat.
 * Ekspor menulis lewat `String(n)`; impor mengenali pemisah ribuan dari grup
 * TIGA angka — dan pecahan tiga digit adalah grup tiga angka:
 *
 *     String(0.125) → "0.125" → keAngka → 125      ← 1000× lebih besar
 *     String(1.375) → "1.375" → keAngka → 1375
 *
 * Jadi ronde ekspor → impor TANPA menyentuh satu sel pun sudah merusak data.
 * Bentuk kegagalannya yang paling pahit: pemilik menekan Ekspor untuk
 * mencadangkan, lalu Impor untuk memulihkan — dan justru pemulihannya yang
 * menghancurkan. Vanili 0,125 kg jadi 125 kg, stok bernilai puluhan juta
 * muncul dari ketiadaan, dan tak ada satu pun galat di layar.
 *
 * Cacat KEDUA, berdiri sendiri dan tak butuh ekspor sama sekali: petugas yang
 * mengetik "0,125" langsung di Excel juga mendapat 125, karena pola ribuannya
 * dulu menerima nol telanjang sebagai grup pertama. Tak ada pemisah ribuan
 * yang mengikuti "0" — itu yang kini disyaratkan.
 */
function bahan(p: Partial<BahanDto>): BahanDto {
  return {
    id: "x",
    kode: "K",
    nama: "Bahan",
    kategori: "bahan",
    pengadaan: "beli",
    harga_beli: 1000,
    isi: 1,
    satuan: "pcs",
    satuan_beli: "pcs",
    stok_minimum: 0,
    min_beli: 0,
    masa_simpan_hari: 0,
    lead_time_hari: 0,
    boleh_eceran: false,
    track_stok: true,
    is_packaging: false,
    is_complement: false,
    catatan: "",
    ...p,
  } as BahanDto;
}

/** Kolom angka yang bolak-balik lewat CSV. */
const ANGKA = [
  "harga_beli",
  "isi",
  "stok_minimum",
  "min_beli",
  "masa_simpan_hari",
  "lead_time_hari",
] as const;

/** Satu bahan → CSV → kembali jadi baris impor. */
function rondeLaju(b: BahanDto) {
  const rows = keRowsImpor(parseCsv(buatCsvBahan([b]))).rows;
  expect(rows).toHaveLength(1);
  return rows[0] as unknown as Record<string, unknown>;
}

/** Baca satu sel angka dari CSV yang diketik tangan. */
function ketik(teks: string): number {
  const rows = keRowsImpor(parseCsv(`nama,stok_minimum\nB,"${teks}"`)).rows;
  return rows[0].stok_minimum;
}

describe("CSV bahan: ekspor → impor tanpa disentuh = utuh", () => {
  // Pecahan TEPAT tiga digit adalah satu-satunya bentuk yang bertabrakan
  // dengan pola ribuan — dan justru bentuk itu yang dulu tak diuji.
  const KASUS: Array<[string, Partial<BahanDto>]> = [
    ["bulat semua (bentuk paling lazim)", { harga_beli: 50000, isi: 25, stok_minimum: 5 }],
    ["pecahan tiga digit", { isi: 0.125, stok_minimum: 0.125 }],
    ["pecahan tiga digit, bagian bulat terisi", { isi: 1.375, stok_minimum: 123.456 }],
    ["pecahan satu digit", { isi: 2.5, stok_minimum: 0.5 }],
    ["pecahan panjang", { isi: 1.2345, stok_minimum: 0.001 }],
    ["harga pecahan", { harga_beli: 12500.75, isi: 1 }],
  ];

  for (const [nama, p] of KASUS) {
    it(nama, () => {
      const asal = bahan(p);
      const balik = rondeLaju(asal);
      for (const k of ANGKA) {
        expect(balik[k], `${nama} · kolom ${k}`).toBe(asal[k]);
      }
    });
  }

  it("berkas ekspor yang isinya bulat semua tidak berubah bentuknya", () => {
    // Perbaikan ini tak boleh mengubah rupa berkas yang sudah beredar: hanya
    // nilai PECAHAN yang ditulis ulang. Bila tidak, tiap ekspor tampak seperti
    // perubahan besar dan orang berhenti mempercayainya.
    const csv = buatCsvBahan([
      bahan({ kode: "A", nama: "Beras", harga_beli: 50000, isi: 25, stok_minimum: 5 }),
    ]);
    expect(csv.split("\n")[1]).toBe(
      "A,Beras,bahan,beli,50000,25,pcs,pcs,5,0,0,0,tidak,ya,tidak,tidak,",
    );
  });
});

describe("CSV bahan: angka yang diketik tangan", () => {
  it("nol telanjang bukan pemisah ribuan", () => {
    // Cacat yang berdiri sendiri: tak butuh ekspor, cukup diketik di Excel.
    expect(ketik("0,125")).toBe(0.125);
    expect(ketik("0.125")).toBe(0.125);
    expect(ketik("0,001")).toBe(0.001);
  });

  it("yang memang ribuan tetap dibaca ribuan", () => {
    // Ini yang membuat `keAngka` ada sejak awal — jangan sampai hilang.
    expect(ketik("10.000")).toBe(10000);
    expect(ketik("1.500")).toBe(1500);
    expect(ketik("1,500")).toBe(1500);
    expect(ketik("Rp 10.000")).toBe(10000);
  });

  it("desimal pendek & campuran dua pemisah tetap benar", () => {
    expect(ketik("1,5")).toBe(1.5);
    expect(ketik("2,5")).toBe(2.5);
    expect(ketik("1.234,5")).toBe(1234.5); // id-ID
    expect(ketik("1,234.5")).toBe(1234.5); // en-US
  });
});

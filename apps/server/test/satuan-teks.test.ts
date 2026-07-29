/**
 * Penulisan kuantitas baris kiriman — dijaga ketat karena satu bug nyata:
 * web menulis "Sayur 900 gr" sementara mobile menulis "Sayur 900 kg" pada
 * faktur PB-0058 yang SAMA. Beda 1000×.
 *
 * Semua kasus di bawah diambil langsung dari faktur itu.
 */
import { describe, expect, it } from "vitest";
import { batchTeks, formatAngkaId, qtyTeks } from "@kakarut/shared";

describe("qtyTeks — kasus nyata faktur PB-0058", () => {
  it("Sayur 900 gr (dibeli per kg) → 'gr', BUKAN 'kg'", () => {
    const r = qtyTeks({ qty: 900, satuan: "gr", isi: 1000, satuanBeli: "kg" });
    expect(r.teks).toBe("900 gr");
    expect(r.teks).not.toContain("kg");
    expect(r.setara).toBe("≈ 0,9 kg");
  });

  it("Mie basah 2.000 gr → 'gr', BUKAN 'batch'", () => {
    const r = qtyTeks({ qty: 2000, satuan: "gr", isi: 1000, satuanBeli: "kg" });
    expect(r.teks).toBe("2.000 gr");
    expect(r.teks).not.toContain("batch");
    // kelipatan pas → tanpa "≈", angkanya memang persis 2 kg
    expect(r.setara).toBe("2 kg");
  });

  it("Air Mineral 330 ml: 24 botol → 'botol', BUKAN 'batch'", () => {
    const r = qtyTeks({ qty: 24, satuan: "botol", isi: 24, satuanBeli: "dus" });
    expect(r.teks).toBe("24 botol");
    expect(r.setara).toBe("1 dus");
  });

  it("Air biasa 15.000 ml → 'ml'", () => {
    const r = qtyTeks({ qty: 15000, satuan: "ml", isi: 1000, satuanBeli: "liter" });
    expect(r.teks).toBe("15.000 ml");
    expect(r.setara).toBe("15 liter");
  });
});

describe("qtyTeks — aturan umum", () => {
  it("satuan_beli TAK PERNAH menggantikan satuan kerja, apa pun isinya", () => {
    for (const isi of [1, 2, 24, 1000, 1e6]) {
      const r = qtyTeks({ qty: 7, satuan: "gr", isi, satuanBeli: "kg" });
      expect(r.teks).toBe("7 gr");
    }
  });

  it("bahan tanpa kemasan (isi ≤ 1) → tak ada teks setara", () => {
    expect(qtyTeks({ qty: 5, satuan: "pcs", isi: 1, satuanBeli: "pcs" }).setara).toBeNull();
    expect(qtyTeks({ qty: 5, satuan: "pcs", isi: 0, satuanBeli: "pcs" }).setara).toBeNull();
  });

  it("satuan_beli kosong → tak ada teks setara", () => {
    expect(qtyTeks({ qty: 900, satuan: "gr", isi: 1000, satuanBeli: null }).setara).toBeNull();
    expect(qtyTeks({ qty: 900, satuan: "gr", isi: 1000 }).setara).toBeNull();
  });

  it("isi/satuan_beli boleh tak dikirim sama sekali", () => {
    expect(qtyTeks({ qty: 40, satuan: "butir" })).toEqual({ teks: "40 butir", setara: null });
  });

  it("bukan kelipatan → diberi '≈'; kelipatan pas → tanpa '≈'", () => {
    expect(qtyTeks({ qty: 1500, satuan: "gr", isi: 1000, satuanBeli: "kg" }).setara).toBe(
      "≈ 1,5 kg",
    );
    expect(qtyTeks({ qty: 3000, satuan: "gr", isi: 1000, satuanBeli: "kg" }).setara).toBe("3 kg");
  });

  it("toleran terhadap pecahan pembulatan numeric(…,2)", () => {
    expect(qtyTeks({ qty: 2000.0000001, satuan: "gr", isi: 1000, satuanBeli: "kg" }).setara).toBe(
      "2 kg",
    );
  });

  it("qty 0 tetap tertulis lengkap dengan satuannya", () => {
    expect(qtyTeks({ qty: 0, satuan: "gr" }).teks).toBe("0 gr");
  });
});

describe("formatAngkaId", () => {
  it("gaya Indonesia: titik ribuan, koma desimal", () => {
    expect(formatAngkaId(2000)).toBe("2.000");
    expect(formatAngkaId(0.9)).toBe("0,9");
    expect(formatAngkaId(1234567.891)).toBe("1.234.567,89");
  });
});

describe("batchTeks — berapa kali resep dijalankan", () => {
  it("2.100 ml dari resep 700 ml → 3 batch, bukan sekadar '2.100 ml'", () => {
    const r = batchTeks({ qty: 2100, satuan: "ml", isi: 700, pengadaan: "produksi" });
    expect(r.batch).toBe(3);
    expect(r.teks).toBe("3 batch × 700 ml");
  });

  it("tidak pas → diberi '≈' supaya tak dibaca sebagai angka bulat", () => {
    const r = batchTeks({ qty: 1650, satuan: "ml", isi: 700, pengadaan: "produksi" });
    expect(r.teks).toBe("≈ 2,36 batch × 700 ml");
  });

  it("bahan BELI tak punya batch — membaginya akan mengarang pekerjaan", () => {
    expect(batchTeks({ qty: 900, satuan: "gr", isi: 1000, pengadaan: "beli" }).batch).toBeNull();
  });

  it("isi ≤ 1: tak ada pengelompokan batch ('2.100 batch × 1 ml' tak berarti)", () => {
    expect(batchTeks({ qty: 2100, satuan: "ml", isi: 1, pengadaan: "produksi" }).teks).toBeNull();
    expect(batchTeks({ qty: 2100, satuan: "ml", isi: null, pengadaan: "produksi" }).teks).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { median, statistikHargaLots } from "../src/lib/harga-stats";

describe("median", () => {
  it("kosong → null", () => {
    expect(median([])).toBeNull();
  });

  it("ganjil → nilai tengah (urutan input bebas)", () => {
    expect(median([3000, 1000, 2000])).toBe(2000);
  });

  it("genap → rata-rata dua tengah", () => {
    expect(median([1000, 3000, 5000, 7000])).toBe(4000);
  });

  it("dibulatkan 2 desimal", () => {
    expect(median([0.1, 0.2, 0.24, 0.31])).toBe(0.22);
  });

  it("tidak memodifikasi array input", () => {
    const nilai = [3, 1, 2];
    median(nilai);
    expect(nilai).toEqual([3, 1, 2]);
  });
});

describe("statistikHargaLots", () => {
  it("tanpa lot berharga → semuanya null", () => {
    expect(statistikHargaLots([{ harga_satuan: null, tanggal: "2026-07-01" }])).toEqual({
      harga_terendah: null,
      harga_tertinggi: null,
      harga_median: null,
    });
  });

  it("terendah/tertinggi bawa tanggal kejadiannya; lot tanpa harga dilewati", () => {
    // lot urut TERBARU dulu (sama seperti keluaran riwayat harga)
    const s = statistikHargaLots([
      { harga_satuan: 2000, tanggal: "2026-07-20" },
      { harga_satuan: null, tanggal: "2026-07-15" },
      { harga_satuan: 3000, tanggal: "2026-07-10" },
      { harga_satuan: 1000, tanggal: "2026-07-01" },
    ]);
    expect(s.harga_terendah).toEqual({ harga: 1000, tanggal: "2026-07-01" });
    expect(s.harga_tertinggi).toEqual({ harga: 3000, tanggal: "2026-07-10" });
    expect(s.harga_median).toBe(2000);
  });

  it("harga seri → tanggal paling baru yang dipakai", () => {
    const s = statistikHargaLots([
      { harga_satuan: 1000, tanggal: "2026-07-20" },
      { harga_satuan: 1000, tanggal: "2026-07-01" },
    ]);
    expect(s.harga_terendah).toEqual({ harga: 1000, tanggal: "2026-07-20" });
    expect(s.harga_tertinggi).toEqual({ harga: 1000, tanggal: "2026-07-20" });
  });
});

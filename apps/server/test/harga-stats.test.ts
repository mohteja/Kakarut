import { describe, expect, it } from "vitest";
import { acuanDariLot, median, statistikHargaLots } from "../src/lib/harga-stats";

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

describe("acuanDariLot", () => {
  it("kolam kosong → pakai fallback (harga baris yang barusan dilaporkan)", () => {
    expect(acuanDariLot([], [], 1234)).toBe(1234);
  });

  it("kolam kosong tanpa fallback → null (harga acuan tak disentuh)", () => {
    expect(acuanDariLot([], [], null)).toBeNull();
  });

  it("median lot yang dilaporkan", () => {
    const lots = [
      { id: "a", qty: 2, totalHarga: 2000 }, // 1000/satuan
      { id: "b", qty: 1, totalHarga: 3000 }, // 3000/satuan
      { id: "c", qty: 5, totalHarga: 10000 }, // 2000/satuan
    ];
    expect(acuanDariLot(lots, [], null)).toBe(2000);
  });

  it("lot tanpa harga & lot ber-qty 0 tidak ikut", () => {
    const lots = [
      { id: "a", qty: 1, totalHarga: 1000 },
      { id: "b", qty: 1, totalHarga: null },
      { id: "c", qty: 0, totalHarga: 9_000_000 },
    ];
    expect(acuanDariLot(lots, [], null)).toBe(1000);
  });

  it("baris yang sedang dilaporkan dipakai nilai BARUNYA, bukan yang lama", () => {
    // 'a' masih memegang harga lama 1000/satuan di basis data; laporan baru
    // menaikkannya jadi 5000/satuan. Kolam harus memakai yang baru saja.
    const lots = [
      { id: "a", qty: 1, totalHarga: 1000 },
      { id: "b", qty: 1, totalHarga: 3000 },
      { id: "c", qty: 1, totalHarga: 7000 },
    ];
    const acuan = acuanDariLot(lots, [{ id: "a", qty: 1, totalHarga: 5000 }], null);
    expect(acuan).toBe(5000); // median(3000, 7000, 5000)
  });

  it("TEBAKAN tak pernah masuk kolam — pemanggil hanya mengirim lot terlapor", () => {
    // Inti perbaikan lingkaran umpan balik: faktur yang dibuat tanpa harga
    // memakai tebakan dari harga acuan saat itu. Selama pemanggil menyaring
    // ke lot ber-`laporan_harga_at`, tebakan itu tak bisa menggeser acuan.
    const terlapor = [{ id: "a", qty: 1, totalHarga: 10000 }];
    const tebakanIkut = [...terlapor, { id: "tebakan", qty: 1, totalHarga: 30000 }];
    expect(acuanDariLot(terlapor, [], null)).toBe(10000);
    expect(acuanDariLot(tebakanIkut, [], null)).toBe(20000); // bukti: ikut → hanyut
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

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
  /** Lot nyata (harganya diketik orang) — ringkas supaya kasusnya terbaca. */
  const lot = (harga_satuan: number | null, tanggal: string, qty = 1) => ({
    harga_satuan,
    tanggal,
    qty,
    total_harga: harga_satuan == null ? null : harga_satuan * qty,
    harga_tebakan: false,
  });
  /** Lot TEBAKAN: harganya diturunkan dari harga acuan, tak pernah dilihat orang. */
  const tebakan = (harga_satuan: number, tanggal: string, qty = 1) => ({
    ...lot(harga_satuan, tanggal, qty),
    harga_tebakan: true,
  });

  it("tanpa lot berharga → semuanya null", () => {
    expect(statistikHargaLots([lot(null, "2026-07-01")])).toEqual({
      harga_terendah: null,
      harga_tertinggi: null,
      harga_median: null,
      harga_rata: null,
      jumlah_harga_nyata: 0,
    });
  });

  it("terendah/tertinggi bawa tanggal kejadiannya; lot tanpa harga dilewati", () => {
    // lot urut TERBARU dulu (sama seperti keluaran riwayat harga)
    const s = statistikHargaLots([
      lot(2000, "2026-07-20"),
      lot(null, "2026-07-15"),
      lot(3000, "2026-07-10"),
      lot(1000, "2026-07-01"),
    ]);
    expect(s.harga_terendah).toEqual({ harga: 1000, tanggal: "2026-07-01" });
    expect(s.harga_tertinggi).toEqual({ harga: 3000, tanggal: "2026-07-10" });
    expect(s.harga_median).toBe(2000);
  });

  it("harga seri → tanggal paling baru yang dipakai", () => {
    const s = statistikHargaLots([lot(1000, "2026-07-20"), lot(1000, "2026-07-01")]);
    expect(s.harga_terendah).toEqual({ harga: 1000, tanggal: "2026-07-20" });
    expect(s.harga_tertinggi).toEqual({ harga: 1000, tanggal: "2026-07-20" });
  });

  it("rata-rata TERTIMBANG per qty, bukan rata-rata harga satuan", () => {
    // 1 satuan @1.000 + 9 satuan @3.000 = 28.000 / 10 = 2.800.
    // Rata-rata polos (1000+3000)/2 = 2.000 — beda 40%, dan yang tertimbang
    // yang benar untuk pembelian.
    const s = statistikHargaLots([lot(3000, "2026-07-20", 9), lot(1000, "2026-07-01", 1)]);
    expect(s.harga_rata).toBe(2800);
  });

  it("INTI: lot TEBAKAN tak menyentuh satu pun dari keempat angkanya", () => {
    /*
     * Kasus yang terukur di API sungguhan: satu pembelian nyata 20.000/kg,
     * sisanya belanja tanpa harga yang diisi dari harga acuan lama (10.000).
     *
     * Sebelum perbaikan layar melaporkan Terendah 10.000 · Median 15.000 ·
     * Rata 15.000 — padahal 10.000 tak pernah dibayar siapa pun. Menuruti
     * median itu (dan layarnya menuliskan "Median jadi harga acuan RAB")
     * mengunci acuan 25% di bawah satu-satunya harga yang nyata, dan HPP tiap
     * menu yang memakai bahan ini ikut turun sebesar itu.
     */
    const s = statistikHargaLots([
      tebakan(10000, "2026-07-20"),
      tebakan(10000, "2026-07-15"),
      lot(20000, "2026-07-01"),
    ]);
    expect(s.harga_terendah).toEqual({ harga: 20000, tanggal: "2026-07-01" });
    expect(s.harga_tertinggi).toEqual({ harga: 20000, tanggal: "2026-07-01" });
    expect(s.harga_median).toBe(20000);
    expect(s.harga_rata).toBe(20000);
    expect(s.jumlah_harga_nyata).toBe(1);
  });

  it("…dan PASANGANNYA: harga yang memang nyata tetap dihitung penuh", () => {
    /*
     * Arah sebaliknya, dan ia yang membuat asersi di atas berarti: saringan
     * yang terlalu rakus membuat statistiknya kosong selamanya — kegagalan
     * yang lebih sunyi, sebab layar cuma menampilkan "—" dan tak ada yang
     * tahu angkanya hilang. Semua lot di sini nyata; tak satu pun boleh jatuh.
     */
    const s = statistikHargaLots([
      lot(3000, "2026-07-20"),
      lot(2000, "2026-07-10"),
      lot(1000, "2026-07-01"),
    ]);
    expect(s.harga_median).toBe(2000);
    expect(s.harga_rata).toBe(2000);
    expect(s.jumlah_harga_nyata).toBe(3);
  });

  it("semua lot tebakan → statistiknya KOSONG, bukan angka karangan", () => {
    // Tak ada harga yang pernah dilihat orang = tak ada yang bisa dikatakan.
    // Memulangkan median tebakan di sini akan menutup lingkarannya kembali.
    const s = statistikHargaLots([tebakan(9000, "2026-07-20"), tebakan(9000, "2026-07-01")]);
    expect(s.harga_median).toBeNull();
    expect(s.harga_rata).toBeNull();
    expect(s.jumlah_harga_nyata).toBe(0);
  });
});

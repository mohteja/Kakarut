import { describe, expect, it } from "vitest";
import { hariTerjadwal, statusPerlengkapan } from "../src/modules/perlengkapan/service";

describe("hariTerjadwal (jadwal konsumsi otomatis perlengkapan)", () => {
  it("harian: mulai kemarin tanpa kursor → [kemarin, hari ini]", () => {
    expect(hariTerjadwal("2026-07-18", 1, null, "2026-07-19")).toEqual([
      "2026-07-18",
      "2026-07-19",
    ]);
  });

  it("mulai == hari ini → [hari ini] (inklusif)", () => {
    expect(hariTerjadwal("2026-07-19", 1, null, "2026-07-19")).toEqual(["2026-07-19"]);
  });

  it("per_hari 3: hanya kelipatan 3 hari dari mulai", () => {
    expect(hariTerjadwal("2026-07-01", 3, null, "2026-07-10")).toEqual([
      "2026-07-01",
      "2026-07-04",
      "2026-07-07",
      "2026-07-10",
    ]);
  });

  it("kursor eksklusif: hari <= terakhir_diterapkan tidak diulang", () => {
    expect(hariTerjadwal("2026-07-01", 3, "2026-07-04", "2026-07-10")).toEqual([
      "2026-07-07",
      "2026-07-10",
    ]);
    // kursor di antara dua jadwal → jadwal berikutnya tetap selaras dgn mulai
    expect(hariTerjadwal("2026-07-01", 3, "2026-07-05", "2026-07-10")).toEqual([
      "2026-07-07",
      "2026-07-10",
    ]);
  });

  it("mulai di masa depan → kosong", () => {
    expect(hariTerjadwal("2026-08-01", 1, null, "2026-07-19")).toEqual([]);
  });

  it("lintas batas bulan/tahun tanpa drift", () => {
    expect(hariTerjadwal("2025-12-30", 1, null, "2026-01-02")).toEqual([
      "2025-12-30",
      "2025-12-31",
      "2026-01-01",
      "2026-01-02",
    ]);
  });

  it("cap lookback 366 hari: aturan sangat lama tidak meledak", () => {
    const hasil = hariTerjadwal("2020-01-01", 1, null, "2026-07-19");
    expect(hasil.length).toBeLessThanOrEqual(367);
    expect(hasil[hasil.length - 1]).toBe("2026-07-19");
  });

  it("per_hari < 1 → kosong (jaga-jaga)", () => {
    expect(hariTerjadwal("2026-07-01", 0, null, "2026-07-10")).toEqual([]);
  });
});

describe("statusPerlengkapan", () => {
  it("saldo ≤ 0 → habis", () => {
    expect(statusPerlengkapan(0, 0)).toBe("habis");
    expect(statusPerlengkapan(-1, 5)).toBe("habis");
  });
  it("saldo ≤ minimum → menipis", () => {
    expect(statusPerlengkapan(3, 3)).toBe("menipis");
  });
  it("di atas minimum → aman (minimum 0 → selalu aman bila > 0)", () => {
    expect(statusPerlengkapan(4, 3)).toBe("aman");
    expect(statusPerlengkapan(0.5, 0)).toBe("aman");
  });
});

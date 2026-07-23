import { describe, expect, it } from "vitest";
import { tambahHari } from "../src/lib/time";

describe("tambahHari", () => {
  it("menggeser hari biasa", () => {
    expect(tambahHari("2026-07-23", 5)).toBe("2026-07-28");
  });

  it("lintas bulan", () => {
    expect(tambahHari("2026-07-30", 5)).toBe("2026-08-04");
    expect(tambahHari("2026-01-31", 1)).toBe("2026-02-01");
  });

  it("lintas tahun", () => {
    expect(tambahHari("2026-12-30", 3)).toBe("2027-01-02");
  });

  it("tahun kabisat", () => {
    expect(tambahHari("2024-02-28", 1)).toBe("2024-02-29");
    expect(tambahHari("2024-02-29", 1)).toBe("2024-03-01");
    expect(tambahHari("2023-02-28", 1)).toBe("2023-03-01");
    expect(tambahHari("2024-01-01", 365)).toBe("2024-12-31");
  });

  it("nol dan negatif", () => {
    expect(tambahHari("2026-07-23", 0)).toBe("2026-07-23");
    expect(tambahHari("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("komposisi exp: tiba hari H + masa simpan", () => {
    const tiba = "2026-07-23";
    const masaSimpan = 14;
    expect(tambahHari(tiba, masaSimpan)).toBe("2026-08-06");
  });
});

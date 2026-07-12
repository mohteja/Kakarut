/**
 * Uji logika murni absensi: generator kode karyawan & penentuan cap berikutnya.
 */
import { describe, expect, it } from "vitest";
import { absenTipeBerikutnya, kodeKaryawanDariNama } from "@kakarut/shared";

describe("kodeKaryawanDariNama", () => {
  it("≥2 kata → inisial (maks 4)", () => {
    expect(kodeKaryawanDariNama("Budi Santoso")).toBe("BS");
    expect(kodeKaryawanDariNama("teja hoki indonesia")).toBe("THI");
    expect(kodeKaryawanDariNama("Satu Dua Tiga Empat Lima")).toBe("SDTE"); // dipotong 4
  });
  it("1 kata → 3 huruf pertama, huruf besar", () => {
    expect(kodeKaryawanDariNama("Teja")).toBe("TEJ");
    expect(kodeKaryawanDariNama("Al")).toBe("AL");
  });
  it("abaikan tanda baca saat memecah kata", () => {
    expect(kodeKaryawanDariNama("Budi, Santoso")).toBe("BS");
    expect(kodeKaryawanDariNama("Ana-Maria")).toBe("AM");
  });
  it("fallback 'K' bila nama tak berhuruf", () => {
    expect(kodeKaryawanDariNama("   ")).toBe("K");
    expect(kodeKaryawanDariNama("!!!")).toBe("K");
  });
});

describe("absenTipeBerikutnya", () => {
  it("belum ada cap hari ini → masuk", () => {
    expect(absenTipeBerikutnya(null)).toBe("masuk");
    expect(absenTipeBerikutnya(undefined)).toBe("masuk");
  });
  it("terakhir masuk → keluar", () => {
    expect(absenTipeBerikutnya("masuk")).toBe("keluar");
  });
  it("terakhir keluar → masuk (bisa masuk lagi, mis. re-entry)", () => {
    expect(absenTipeBerikutnya("keluar")).toBe("masuk");
  });
});

import { jarakMeter } from "@kakarut/shared";

describe("jarakMeter (radius absen)", () => {
  it("titik sama = 0 m", () => {
    expect(jarakMeter(-6.2, 106.816666, -6.2, 106.816666)).toBeCloseTo(0, 5);
  });
  it("±111 m per 0.001° lintang", () => {
    const d = jarakMeter(-6.2, 106.816666, -6.201, 106.816666);
    expect(d).toBeGreaterThan(105);
    expect(d).toBeLessThan(118);
  });
  it("Monas → Kota Tua ≈ 4.5-5.5 km", () => {
    const d = jarakMeter(-6.175392, 106.827153, -6.137654, 106.817125);
    expect(d).toBeGreaterThan(4000);
    expect(d).toBeLessThan(5500);
  });
});

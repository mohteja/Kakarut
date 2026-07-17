/**
 * Uji logika murni absensi: generator kode karyawan & penentuan cap berikutnya.
 */
import { describe, expect, it } from "vitest";
import { absenTipeBerikutnya } from "@kakarut/shared";

// Kode karyawan kini 8 digit acak yang di-generate di server (butuh DB untuk uji
// keunikan) → diverifikasi di scripts/verify-api.sh, bukan unit test murni ini.

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

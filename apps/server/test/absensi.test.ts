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

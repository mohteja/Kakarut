import { describe, expect, it } from "vitest";
import { TENGGAT_PESANAN_MENIT, menitMenungguTertua, pesananTerlambat } from "@kakarut/shared";

/**
 * ALARM TENGGAT (permintaan pemilik 2026-11-11): tiap orderan 10 menit; lewat
 * dari itu kotaknya merah, berkedip, dan berbunyi.
 */
const T0 = Date.parse("2026-11-11T10:00:00Z");
const menit = (m: number) => T0 + m * 60000;
const baris = (status: "dikerjakan" | "selesai" | "batal", masukMenit: number) => ({
  status,
  masuk_pada: new Date(menit(masukMenit)).toISOString(),
});

describe("tenggat pesanan", () => {
  it("tenggatnya 10 menit", () => {
    expect(TENGGAT_PESANAN_MENIT).toBe(10);
  });

  it("dihitung dari sajian TERTUA yang masih dikerjakan", () => {
    const items = [baris("selesai", 0), baris("dikerjakan", 3), baris("dikerjakan", 7)];
    expect(menitMenungguTertua(items, menit(12))).toBe(9);
    expect(pesananTerlambat(items, menit(12))).toBe(false);
    expect(pesananTerlambat(items, menit(13))).toBe(true); // tepat 10 menit
  });

  it("ronde tambahan pada bill lama tak langsung terlambat", () => {
    // Bill dibuka menit 0 dan sudah dikirim semua; tambahan masuk menit 30.
    const items = [baris("selesai", 0), baris("dikerjakan", 30)];
    expect(pesananTerlambat(items, menit(35))).toBe(false);
    expect(pesananTerlambat(items, menit(40))).toBe(true);
  });

  it("tanpa sajian yang dikerjakan → tak ada yang ditunggu", () => {
    const items = [baris("selesai", 0), baris("batal", 0)];
    expect(menitMenungguTertua(items, menit(60))).toBeNull();
    expect(pesananTerlambat(items, menit(60))).toBe(false);
  });
});

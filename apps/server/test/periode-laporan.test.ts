import { describe, expect, it } from "vitest";
import { PERIODE, periodeDari, rentangPeriode } from "../../web/src/lib/periode";

/**
 * PERIODE CEPAT LAPORAN — rumusnya diuji di tepi-tepinya, bukan di hari biasa.
 *
 * Rentang yang salah satu hari tak melempar apa pun: laporannya tetap tampil,
 * angkanya masuk akal, dan yang membacanya mengira "minggu lalu" memang
 * segitu. Jadi yang dipaku di sini justru hari-hari tempat rumus kalender
 * biasanya tergelincir: Senin & Minggu (awal/akhir pekan), tanggal 1,
 * pergantian tahun, dan Februari kabisat.
 */
describe("rentangPeriode", () => {
  it("hari biasa (Rabu 14 Okt 2026)", () => {
    const h = "2026-10-14";
    expect(rentangPeriode("hari-ini", h)).toEqual({ dari: h, sampai: h });
    expect(rentangPeriode("kemarin", h)).toEqual({ dari: "2026-10-13", sampai: "2026-10-13" });
    expect(rentangPeriode("minggu-ini", h)).toEqual({ dari: "2026-10-12", sampai: h });
    expect(rentangPeriode("minggu-lalu", h)).toEqual({ dari: "2026-10-05", sampai: "2026-10-11" });
    expect(rentangPeriode("bulan-ini", h)).toEqual({ dari: "2026-10-01", sampai: h });
    expect(rentangPeriode("bulan-lalu", h)).toEqual({ dari: "2026-09-01", sampai: "2026-09-30" });
  });

  it("pekan dimulai SENIN: Minggu masih pekan yang sama, Senin membuka pekan baru", () => {
    // Minggu 11 Okt 2026 — hari terakhir pekan Senin 5 Okt.
    expect(rentangPeriode("minggu-ini", "2026-10-11")).toEqual({ dari: "2026-10-05", sampai: "2026-10-11" });
    expect(rentangPeriode("minggu-lalu", "2026-10-11")).toEqual({ dari: "2026-09-28", sampai: "2026-10-04" });
    // Senin 12 Okt 2026 — pekannya baru satu hari.
    expect(rentangPeriode("minggu-ini", "2026-10-12")).toEqual({ dari: "2026-10-12", sampai: "2026-10-12" });
    expect(rentangPeriode("minggu-lalu", "2026-10-12")).toEqual({ dari: "2026-10-05", sampai: "2026-10-11" });
  });

  it("minggu lalu selalu tujuh hari Senin–Minggu, termasuk yang melintasi bulan & tahun", () => {
    // Jumat 2 Jan 2026 → pekan lalu 22–28 Des 2025.
    expect(rentangPeriode("minggu-lalu", "2026-01-02")).toEqual({ dari: "2025-12-22", sampai: "2025-12-28" });
    expect(rentangPeriode("minggu-ini", "2026-01-02")).toEqual({ dari: "2025-12-29", sampai: "2026-01-02" });
    for (let i = 0; i < 400; i++) {
      const h = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
      const r = rentangPeriode("minggu-lalu", h);
      const dari = new Date(`${r.dari}T00:00:00Z`);
      const sampai = new Date(`${r.sampai}T00:00:00Z`);
      expect(dari.getUTCDay(), `${h}: dari ${r.dari} bukan Senin`).toBe(1);
      expect((sampai.getTime() - dari.getTime()) / 86_400_000, h).toBe(6);
      expect(r.sampai < h, `${h}: minggu lalu menjangkau pekan ini`).toBe(true);
    }
  });

  it("tanggal 1 & pergantian tahun", () => {
    expect(rentangPeriode("kemarin", "2026-03-01")).toEqual({ dari: "2026-02-28", sampai: "2026-02-28" });
    expect(rentangPeriode("bulan-ini", "2026-03-01")).toEqual({ dari: "2026-03-01", sampai: "2026-03-01" });
    expect(rentangPeriode("bulan-lalu", "2026-01-15")).toEqual({ dari: "2025-12-01", sampai: "2025-12-31" });
    expect(rentangPeriode("kemarin", "2026-01-01")).toEqual({ dari: "2025-12-31", sampai: "2025-12-31" });
  });

  it("Februari kabisat & bulan 30 hari", () => {
    expect(rentangPeriode("bulan-lalu", "2028-03-10")).toEqual({ dari: "2028-02-01", sampai: "2028-02-29" });
    expect(rentangPeriode("bulan-lalu", "2026-03-10")).toEqual({ dari: "2026-02-01", sampai: "2026-02-28" });
    expect(rentangPeriode("bulan-lalu", "2026-05-31")).toEqual({ dari: "2026-04-01", sampai: "2026-04-30" });
  });

  it("tak ada periode yang menjangkau sesudah hari ini", () => {
    for (let i = 0; i < 400; i++) {
      const h = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
      for (const { kode } of PERIODE) {
        const r = rentangPeriode(kode, h);
        expect(r.dari <= r.sampai, `${kode} @ ${h}`).toBe(true);
        expect(r.sampai <= h, `${kode} @ ${h} menjangkau masa depan`).toBe(true);
      }
    }
  });
});

describe("periodeDari — dropdown menyebut periode yang SEDANG tampil", () => {
  const h = "2026-10-14";

  it("rentang bernama dikenali; rentang tangan → null", () => {
    expect(periodeDari({ dari: "2026-09-01", sampai: "2026-09-30" }, h)).toBe("bulan-lalu");
    expect(periodeDari({ dari: h, sampai: h }, h)).toBe("hari-ini");
    expect(periodeDari({ dari: "2026-09-03", sampai: "2026-09-30" }, h)).toBeNull();
  });

  it("di hari Senin 'Minggu ini' = 'Hari ini': pilihan orang yang menang", () => {
    const senin = "2026-10-12";
    const r = rentangPeriode("minggu-ini", senin);
    expect(periodeDari(r, senin)).toBe("hari-ini");
    expect(periodeDari(r, senin, "minggu-ini")).toBe("minggu-ini");
    // Tanggal 1: "Bulan ini" = "Hari ini".
    expect(periodeDari(rentangPeriode("bulan-ini", "2026-10-01"), "2026-10-01", "bulan-ini")).toBe("bulan-ini");
  });

  it("pilihan yang tak lagi cocok dengan tanggalnya TIDAK dipakai", () => {
    // Orang memilih "Bulan lalu" lalu menggeser tanggal tangan.
    expect(periodeDari({ dari: "2026-09-05", sampai: "2026-09-30" }, h, "bulan-lalu")).toBeNull();
    expect(periodeDari({ dari: h, sampai: h }, h, "bulan-lalu")).toBe("hari-ini");
  });
});

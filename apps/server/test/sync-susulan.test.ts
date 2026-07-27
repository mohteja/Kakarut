import { describe, expect, it } from "vitest";
import { SUSULAN_TOLERANSI_JAM, dalamToleransiSusulan } from "../src/modules/sync/routes";

/**
 * Batas penautan transaksi susulan ke shift yang sudah ditutup.
 *
 * Konteksnya uang fisik: kasir offline masih melayani setelah shift ditutup
 * dari perangkat lain. Terlalu ketat → transaksi (dan uangnya) hilang; terlalu
 * longgar → sale nyasar ke shift/hari yang salah dan merusak rekonsiliasi kas.
 */
const TZ = "Asia/Jakarta"; // UTC+7, tanpa DST

/** Waktu WIB → Date (UTC+7 tetap, jadi aman ditulis eksplisit). */
function wib(tanggal: string, jam: string): Date {
  return new Date(`${tanggal}T${jam}+07:00`);
}

describe("dalamToleransiSusulan", () => {
  it("menerima transaksi tepat setelah shift ditutup (kasus lapangan: tutup 20.30, jual 20.45)", () => {
    expect(dalamToleransiSusulan(wib("2026-03-10", "20:45"), wib("2026-03-10", "20:30"), TZ)).toBe(
      true,
    );
  });

  it("menerima tepat di batas toleransi", () => {
    const tutup = wib("2026-03-10", "10:00");
    const batas = new Date(tutup.getTime() + SUSULAN_TOLERANSI_JAM * 3_600_000);
    expect(dalamToleransiSusulan(batas, tutup, TZ)).toBe(true);
  });

  it("menolak satu milidetik lewat batas toleransi", () => {
    const tutup = wib("2026-03-10", "10:00");
    const lewat = new Date(tutup.getTime() + SUSULAN_TOLERANSI_JAM * 3_600_000 + 1);
    expect(dalamToleransiSusulan(lewat, tutup, TZ)).toBe(false);
  });

  it("menolak bila sudah beda tanggal bisnis walau jeda masih di bawah 6 jam", () => {
    // tutup 23.50, transaksi 00.30 esok hari → jeda 40 menit tapi hari lain
    expect(dalamToleransiSusulan(wib("2026-03-11", "00:30"), wib("2026-03-10", "23:50"), TZ)).toBe(
      false,
    );
  });

  it("tanggal bisnis dinilai di zona perusahaan, bukan UTC", () => {
    // 2026-03-10T18:30Z = 11 Mar 01.30 WIB; 2026-03-10T16:00Z = 10 Mar 23.00 WIB.
    // Jeda 2,5 jam, tapi di WIB sudah beda hari → ditolak.
    const transaksi = new Date("2026-03-10T18:30:00Z");
    const tutup = new Date("2026-03-10T16:00:00Z");
    expect(dalamToleransiSusulan(transaksi, tutup, TZ)).toBe(false);
    // Di UTC keduanya masih 10 Maret → diterima. Membuktikan tz benar-benar dipakai.
    expect(dalamToleransiSusulan(transaksi, tutup, "UTC")).toBe(true);
  });

  it("menolak waktu sebelum penutupan (itu bukan transaksi susulan)", () => {
    expect(dalamToleransiSusulan(wib("2026-03-10", "20:00"), wib("2026-03-10", "20:30"), TZ)).toBe(
      false,
    );
  });

  it("menerima waktu persis sama dengan penutupan", () => {
    const t = wib("2026-03-10", "20:30");
    expect(dalamToleransiSusulan(t, t, TZ)).toBe(true);
  });
});

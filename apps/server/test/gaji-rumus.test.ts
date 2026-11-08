import { describe, expect, it } from "vitest";
import {
  CUTI_DIBAYAR_BAWAAN,
  akhirPeriode,
  awalPeriodeMemuat,
  hitungSlip,
  menitDariJam,
  telatLembur,
  type GajiHariMasukan,
  type GajiSetelanHitung,
} from "@kakarut/shared";

/**
 * RUMUS PENGGAJIAN (packages/shared/src/gaji.ts) — aturan pemilik 2026-11-08.
 * Tiap uji menyebut satu aturan dengan angka yang bisa dihitung di kepala.
 */
const BULANAN: GajiSetelanHitung = {
  dasar: "bulanan",
  nominal: 2_600_000,
  jam_masuk: "08:00",
  jam_pulang: "16:00",
  toleransi_telat_menit: 10,
  potongan_alpa_per_hari: null, // bawaan 2.600.000 ÷ 26 = 100.000
  potongan_telat_per_kali: 10_000,
  upah_lembur_per_jam: 20_000,
};
const HARIAN: GajiSetelanHitung = { ...BULANAN, dasar: "harian", nominal: 100_000 };

const hadir = (t: string, masuk = 8 * 60, keluar: number | null = 16 * 60): GajiHariMasukan => ({
  tanggal: t, status: "hadir", kategori: null, masuk_menit: masuk, keluar_menit: keluar,
});
const hari = (t: string, status: GajiHariMasukan["status"], kategori: GajiHariMasukan["kategori"] = null): GajiHariMasukan => ({
  tanggal: t, status, kategori, masuk_menit: null, keluar_menit: null,
});
const dasar = { tunjangan: [], cutiDibayar: CUTI_DIBAYAR_BAWAAN, kasbon: [] };

describe("jam & periode", () => {
  it("menitDariJam menolak jam tak sah", () => {
    expect(menitDariJam("08:30")).toBe(510);
    expect(menitDariJam("24:00")).toBeNull();
    expect(menitDariJam(null)).toBeNull();
  });
  it("periode bulanan & periode yang memuat tanggal", () => {
    expect(akhirPeriode("2026-01-25")).toBe("2026-02-24");
    expect(akhirPeriode("2026-02-01")).toBe("2026-02-28");
    expect(akhirPeriode("2026-12-25")).toBe("2027-01-24");
    expect(awalPeriodeMemuat("2026-11-08", 25)).toBe("2026-10-25");
    expect(awalPeriodeMemuat("2026-11-26", 25)).toBe("2026-11-25");
    expect(awalPeriodeMemuat("2026-01-10", 25)).toBe("2025-12-25");
    expect(awalPeriodeMemuat("2026-11-08", 1)).toBe("2026-11-01");
  });
});

describe("telat & lembur", () => {
  it("dalam toleransi bukan telat; lewat toleransi dihitung dari jam masuk", () => {
    expect(telatLembur(BULANAN, 8 * 60 + 10, null).telat_menit).toBe(0);
    expect(telatLembur(BULANAN, 8 * 60 + 11, null).telat_menit).toBe(11);
  });
  it("lembur dibulatkan ke bawah per 30 menit", () => {
    expect(telatLembur(BULANAN, 480, 16 * 60 + 29).lembur_menit).toBe(0);
    expect(telatLembur(BULANAN, 480, 17 * 60 + 59).lembur_menit).toBe(90);
  });
  it("jadwal lewat tengah malam (22:00–06:00)", () => {
    const malam = { jam_masuk: "22:00", jam_pulang: "06:00", toleransi_telat_menit: 0 };
    expect(telatLembur(malam, 22 * 60 + 5, null).telat_menit).toBe(5);
    expect(telatLembur(malam, 22 * 60, 1440 + 7 * 60).lembur_menit).toBe(60);
  });
  it("tanpa jadwal: tak ada telat/lembur", () => {
    expect(telatLembur({ jam_masuk: null, jam_pulang: null, toleransi_telat_menit: 0 }, 900, 1300)).toEqual({ telat_menit: 0, lembur_menit: 0 });
  });
});

describe("hitungSlip", () => {
  it("bulanan: pokok − alpa − telat + lembur + tunjangan + bonus", () => {
    const r = hitungSlip({
      ...dasar,
      setelan: BULANAN,
      tunjangan: [{ nama: "Makan", nominal: 300_000 }],
      bonus: 50_000,
      hari: [
        hadir("2026-11-01", 8 * 60 + 30, 18 * 60), // telat 30 mnt, lembur 120 mnt
        hari("2026-11-02", "alpa"),
        hadir("2026-11-03"),
      ],
    });
    expect(r.gaji_pokok).toBe(2_600_000);
    expect(r.potongan_alpa).toBe(100_000);
    expect(r.telat_kali).toBe(1);
    expect(r.potongan_telat).toBe(10_000);
    expect(r.lembur_menit).toBe(120);
    expect(r.upah_lembur).toBe(40_000);
    expect(r.total).toBe(2_600_000 - 100_000 - 10_000 + 40_000 + 300_000 + 50_000);
  });

  it("cuti dibayar tak dipotong; izin (tak dibayar) dipotong seperti alpa", () => {
    const r = hitungSlip({
      ...dasar,
      setelan: BULANAN,
      hari: [hari("2026-11-01", "cuti", "sakit"), hari("2026-11-02", "cuti", "izin"), hari("2026-11-03", "libur", "mingguan")],
    });
    expect(r.cuti_dibayar).toBe(2);
    expect(r.cuti_tak_dibayar).toBe(1);
    expect(r.potongan_cuti_tak_dibayar).toBe(100_000);
    expect(r.total).toBe(2_500_000);
  });

  it("bulanan diprorata bila bergabung di tengah periode (hari kosong)", () => {
    const r = hitungSlip({
      ...dasar,
      setelan: { ...BULANAN, nominal: 3_000_000 },
      hari: [hari("2026-11-01", "kosong"), hadir("2026-11-02"), hadir("2026-11-03")],
    });
    expect(r.hari_aktif).toBe(2);
    expect(r.gaji_pokok).toBe(2_000_000);
  });

  it("harian: nominal × (hadir + cuti dibayar); alpa tak dibayar tanpa potongan tambahan", () => {
    const r = hitungSlip({
      ...dasar,
      setelan: HARIAN,
      hari: [hadir("2026-11-01"), hadir("2026-11-02"), hari("2026-11-03", "alpa"), hari("2026-11-04", "cuti", "tahunan"), hari("2026-11-05", "cuti", "izin")],
    });
    expect(r.gaji_pokok).toBe(300_000);
    expect(r.potongan_alpa).toBe(0);
    expect(r.potongan_cuti_tak_dibayar).toBe(0);
    expect(r.total).toBe(300_000);
  });

  it("lupa absen pulang: ditandai, lembur tak dihitung", () => {
    const r = hitungSlip({ ...dasar, setelan: BULANAN, hari: [hadir("2026-11-01", 480, null)] });
    expect(r.lupa_pulang).toBe(1);
    expect(r.lembur_menit).toBe(0);
  });

  it("kasbon: min(cicilan, sisa), tak membuat gaji minus; kekurangan dicatat", () => {
    const r = hitungSlip({
      ...dasar,
      setelan: HARIAN,
      hari: [hadir("2026-11-01")], // pokok 100.000
      kasbon: [
        { id: "k1", sisa: 30_000, cicilan_per_periode: 50_000 },
        { id: "k2", sisa: 500_000, cicilan_per_periode: 100_000 },
      ],
    });
    expect(r.kasbon).toEqual([{ id: "k1", nominal: 30_000 }, { id: "k2", nominal: 70_000 }]);
    expect(r.total).toBe(0);

    const minus = hitungSlip({ ...dasar, setelan: BULANAN, penyesuaian: -3_000_000, hari: [hadir("2026-11-01")] });
    expect(minus.total).toBe(0);
    expect(minus.kurang).toBe(400_000);
  });

  it("hari yang BELUM terjadi: bukan alpa, tak memotong prorata bulanan, tak dibayar harian", () => {
    const hari3 = [hadir("2026-11-01"), hari("2026-11-02", "belum"), hari("2026-11-03", "belum")];
    const b = hitungSlip({ ...dasar, setelan: BULANAN, hari: hari3 });
    expect(b.alpa).toBe(0);
    expect(b.gaji_pokok).toBe(2_600_000);
    const h = hitungSlip({ ...dasar, setelan: HARIAN, hari: hari3 });
    expect(h.gaji_pokok).toBe(100_000);
  });

  it("potongan alpa per hari bisa diatur sendiri", () => {
    const r = hitungSlip({ ...dasar, setelan: { ...BULANAN, potongan_alpa_per_hari: 75_000 }, hari: [hari("2026-11-01", "alpa")] });
    expect(r.potongan_alpa).toBe(75_000);
  });
});

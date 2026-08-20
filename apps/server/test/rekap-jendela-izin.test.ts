/**
 * JENDELA HITUNG REKAP ABSEN berlaku untuk CUTI/LIBUR juga, bukan cuma alpa.
 *
 * Layar rekap sudah mencetak kontraknya untuk pembacanya: "Tanggal yang belum
 * lewat, sebelum karyawan bergabung, dan setelah ia keluar tidak pernah
 * dihitung." Dulu hanya cabang alpa yang menurutinya. Terukur pada server
 * sungguhan — bergabung 08-08, cuti 08-12..08-17 disetujui, lalu KELUAR 08-14:
 *
 *   alpa = 4   → berhenti di hari kerja terakhirnya (benar)
 *   cuti = 6   → termasuk 08-15, 08-16, 08-17
 *
 * Tiga hari cuti berbayar untuk orang yang sudah tidak bekerja di sana, di
 * baris yang dibaca pemilik untuk menghitung gaji.
 *
 * Uji ini MENJALANKAN aturannya (`nilaiHariRekap`), bukan mencocokkan teks
 * sumber; jalur HTTP-nya sendiri dijaga §201 verify-api.
 */
import { describe, expect, it } from "vitest";
import { nilaiHariRekap } from "../src/modules/absensi/routes";

const CAP = { masuk: "2026-08-12T01:00:00.000Z", keluar: "2026-08-12T10:00:00.000Z" };
const CUTI = { jenis: "cuti" as const, kategori: "tahunan" as const };
const LIBUR = { jenis: "libur" as const, kategori: "mingguan" as const };
/** Bergabung 08-08, hari kerja terakhir 08-14. */
const JENDELA = { mulai: "2026-08-08", akhir: "2026-08-14" };

describe("nilaiHariRekap — di DALAM jendela (jalur lama, tak boleh bergeser)", () => {
  it("ada cap → hadir, dengan jam-jamnya", () => {
    const h = nilaiHariRekap("2026-08-12", CAP, undefined, JENDELA);
    expect(h.status).toBe("hadir");
    expect(h.masuk).toBe(CAP.masuk);
    expect(h.keluar).toBe(CAP.keluar);
  });
  it("cuti disetujui → cuti, dengan kategorinya", () => {
    const h = nilaiHariRekap("2026-08-12", undefined, CUTI, JENDELA);
    expect(h.status).toBe("cuti");
    expect(h.kategori).toBe("tahunan");
  });
  it("libur disetujui → libur", () => {
    expect(nilaiHariRekap("2026-08-12", undefined, LIBUR, JENDELA).status).toBe("libur");
  });
  it("tak ada apa-apa → alpa", () => {
    expect(nilaiHariRekap("2026-08-12", undefined, undefined, JENDELA).status).toBe("alpa");
  });
  it("cap MENANG atas cuti — hari yang benar-benar bekerja tak jadi cuti", () => {
    expect(nilaiHariRekap("2026-08-12", CAP, CUTI, JENDELA).status).toBe("hadir");
  });
});

describe("nilaiHariRekap — di LUAR jendela", () => {
  it("INTI: cuti sesudah karyawan keluar → kosong, bukan cuti", () => {
    for (const t of ["2026-08-15", "2026-08-16", "2026-08-17"]) {
      expect(nilaiHariRekap(t, undefined, CUTI, JENDELA).status, t).toBe("kosong");
    }
  });
  it("INTI: cuti sebelum karyawan bergabung → kosong", () => {
    expect(nilaiHariRekap("2026-08-07", undefined, CUTI, JENDELA).status).toBe("kosong");
  });
  it("libur pun sama — dua-duanya lewat pintu yang sama", () => {
    expect(nilaiHariRekap("2026-08-15", undefined, LIBUR, JENDELA).status).toBe("kosong");
  });
  it("hari terakhirnya sendiri MASIH terhitung (batasnya inklusif)", () => {
    // Kalau batasnya eksklusif, cuti di hari kerja terakhir ikut hilang —
    // memperbaiki kelebihan hitung dengan kekurangan hitung.
    expect(nilaiHariRekap("2026-08-14", undefined, CUTI, JENDELA).status).toBe("cuti");
    expect(nilaiHariRekap("2026-08-08", undefined, CUTI, JENDELA).status).toBe("cuti");
  });
  it("alpa tetap dijendelai seperti sebelumnya", () => {
    expect(nilaiHariRekap("2026-08-15", undefined, undefined, JENDELA).status).toBe("kosong");
    expect(nilaiHariRekap("2026-08-07", undefined, undefined, JENDELA).status).toBe("kosong");
  });
  it("cap tetap ditampilkan walau di luar jendela — ia fakta, bukan hitungan", () => {
    // Membuangnya akan menyembunyikan kehadiran yang sungguh terjadi.
    expect(nilaiHariRekap("2026-08-20", CAP, undefined, JENDELA).status).toBe("hadir");
  });
  it("bulan yang belum dimulai (akhir null) → semuanya kosong", () => {
    const belum = { mulai: "2026-09-01", akhir: null };
    expect(nilaiHariRekap("2026-09-01", undefined, CUTI, belum).status).toBe("kosong");
    expect(nilaiHariRekap("2026-09-01", undefined, undefined, belum).status).toBe("kosong");
  });
});

describe("baris utuh: penghitungnya harus sama dengan hariannya", () => {
  it("kasus terukur — bergabung 08-08, cuti 08-12..08-17, keluar 08-14", () => {
    const izin = new Map(
      ["12", "13", "14", "15", "16", "17"].map((d) => [`2026-08-${d}`, CUTI] as const),
    );
    const tanggal = Array.from(
      { length: 20 },
      (_, i) => `2026-08-${String(i + 1).padStart(2, "0")}` as const,
    );
    const harian = tanggal.map((t) => nilaiHariRekap(t, undefined, izin.get(t), JENDELA));
    const hitung = (s: string) => harian.filter((h) => h.status === s).length;
    expect(hitung("cuti")).toBe(3); // 08-12, 08-13, 08-14 — berhenti di hari kerja terakhir
    expect(hitung("alpa")).toBe(4); // 08-08..08-11
    expect(hitung("kosong")).toBe(13); // sisanya: sebelum bergabung & sesudah keluar
    expect(hitung("cuti") + hitung("alpa") + hitung("kosong")).toBe(20);
  });
});

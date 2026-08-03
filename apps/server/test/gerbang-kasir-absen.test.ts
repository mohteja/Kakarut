import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { absenTipeBerikutnya } from "@kakarut/shared";

/**
 * Penjaga GERBANG BUKA KASIR — tuduhan yang menciptakan syaratnya sendiri.
 *
 * Gerbang ini punya DUA bacaan, dan dulu hanya satu yang hati-hati:
 *
 *   shiftAktif       `=== null`, ketat. Bacaan gagal (`undefined`) TIDAK
 *                    memunculkan gerbang — kasir tak terkunci di tengah
 *                    antrean, dan server tetap menolak lewat 409
 *                    `kasir_belum_dibuka`. Ini benar; jangan diubah.
 *   absensiHariIni   `= []`, longgar. Bacaan gagal terbaca "belum absen".
 *
 * Yang kedua bukan sekadar label keliru. Kotak amber-nya menyuruh menekan
 * "Absen Sekarang", sementara cap absen BERGANTIAN — `absenTipeBerikutnya`
 * memulangkan `keluar` sesudah `masuk`. Jadi kasir yang SUDAH absen masuk lalu
 * menurut akan mencap KELUAR. Sejak itu `sedangHadir` benar-benar false, dan
 * `POST /shift/buka` menolaknya sungguhan dengan pesan yang tadi cuma
 * karangan layar. Tuduhannya menciptakan syaratnya sendiri, di awal shift,
 * dengan antrean menunggu.
 */
const baca = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

/**
 * SUMBER MENTAH, tanpa pembuang komentar — disengaja.
 *
 * Berkas ini memuat literal regex (`/\D/g`) dan potongan yang menyerupai
 * pembuka komentar, jadi pembuang komentar naif justru MEMAKAN kodenya: 26 KB
 * hilang dan penjaga di bawah hijau/merah karena alasan yang salah. Semua
 * pernyataan di sini berbentuk KODE atau teks layar yang tak muncul di
 * komentar, jadi menyaring tak diperlukan. Yang melarang (`not.toContain`)
 * dibatasi ke potongan di ANTARA dua penanda kode, bukan seluruh berkas.
 */
const KODE = baca("../../web/src/pages/kasir/KasirPage.tsx");

describe("premis: inilah yang membuat 'absen lagi' berbahaya", () => {
  it("cap absen BERGANTIAN — sesudah masuk yang berikutnya keluar", () => {
    expect(absenTipeBerikutnya("masuk")).toBe("keluar");
    expect(absenTipeBerikutnya("keluar")).toBe("masuk");
    expect(absenTipeBerikutnya(null)).toBe("masuk");
  });

  it("dan buka shift MEMANG menuntut sedang-hadir, jadi cap keluar mengunci beneran", () => {
    const shift = baca("../src/modules/shift/routes.ts");
    expect(shift).toMatch(/if \(!\(await sedangHadir\(/);
    expect(shift).toContain("Absen masuk dulu sebelum buka kasir");
  });

  it("`sedangHadir` menilai dari cap TERAKHIR hari itu", () => {
    // Karena itulah satu cap keluar cukup membalik keadaannya.
    const absensi = baca("../src/modules/absensi/routes.ts");
    expect(absensi).toMatch(/return last\?\.tipe === "masuk";/);
  });
});

describe("gerbang: tiga keadaan, bukan dua", () => {
  it("galat absensi diambil dari useQuery", () => {
    expect(KODE).toMatch(/data: absensiHariIni = \[\], error: gagalAbsensi/);
  });

  it("percabangan gagal MENDAHULUI 'sudah absen' dan 'belum absen'", () => {
    const iGagal = KODE.indexOf("{gagalAbsensi ? (");
    const iSudah = KODE.indexOf(") : sudahAbsen ? (");
    expect(iGagal, "percabangan gagal tak ditemukan").toBeGreaterThan(0);
    expect(iSudah).toBeGreaterThan(iGagal);
  });

  it("saat gagal, layarnya TIDAK menyuruh absen lagi", () => {
    const iGagal = KODE.indexOf("{gagalAbsensi ? (");
    const iSudah = KODE.indexOf(") : sudahAbsen ? (");
    const blokGagal = KODE.slice(iGagal, iSudah);
    expect(blokGagal).toContain("tidak terbaca");
    // Tombol "Absen Sekarang" tak boleh hidup di cabang ini.
    expect(blokGagal).not.toContain("Absen Sekarang");
    expect(blokGagal).not.toContain('to="/absen"');
  });

  it("dan justru memperingatkan bahwa cap berikutnya tercatat keluar", () => {
    expect(KODE).toContain("cap berikutnya justru tercatat");
  });

  it("jalur 'memang belum absen' tetap utuh — ini bukan penghapusan syarat", () => {
    expect(KODE).toContain("Anda belum absen masuk");
    expect(KODE).toContain("🖐 Absen Sekarang");
  });
});

/** Sifat tetangganya yang sudah benar dan justru jadi pembanding. */
describe("bacaan shift di komponen yang sama tetap ketat", () => {
  it("`=== null`, bukan `!shiftAktif` — bacaan gagal tak mengunci kasir", () => {
    expect(KODE).toContain("const kasirTutup = isKasir && shiftAktif === null;");
    expect(KODE).not.toMatch(/const kasirTutup = isKasir && !shiftAktif/);
  });

  it("dan itu aman karena server yang jadi penjaga sebenarnya", () => {
    const penjualan = baca("../src/modules/penjualan/routes.ts");
    expect(penjualan).toContain("kasir_belum_dibuka");
    expect(penjualan).toMatch(/isNull\(shifts\.closedAt\)/);
  });

  it("tombol Buka Kasir tidak dimatikan oleh tebakan absen sisi klien", () => {
    // Server yang memutuskan; layar hanya memberi tahu. Kalau tombolnya
    // dimatikan `!sudahAbsen`, bacaan absensi yang gagal akan memblokir beneran.
    expect(KODE).toMatch(/onClick=\{\(\) => bukaKasir\.mutate\(\)\}\s*\n\s*disabled=\{bukaKasir\.isPending\}/);
  });
});

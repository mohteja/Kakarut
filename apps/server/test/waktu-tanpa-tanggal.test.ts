import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * RATCHET: BERKAS YANG MEMAKAI `formatWaktu` TANPA PEMFORMAT TANGGAL WAJIB
 * DIPUTUSKAN — beralasan, dengan namanya.
 *
 * `formatWaktu` di web memulangkan jam-menit saja. Itu benar untuk daftar yang
 * memang sehari, dan salah untuk daftar yang membentang berhari-hari — di sana
 * setiap baris dari setiap hari terbaca sama ("14.32"), persis di halaman yang
 * ada untuk menelusuri yang LAMA. Riwayat SO memakainya telanjang sampai
 * pemilik melaporkannya; sapuan sesudahnya menemukan LIMA berkas lain dengan
 * cacat yang sama, termasuk kartu Beli Perlengkapan yang lahir dari putaran
 * sebelumnya — tabelnya bertanggal, kartunya (bentuk bawaan) tidak.
 *
 * Yang dijaga di sini bukan "semua harus bertanggal" — itu salah untuk Absen
 * dan Riwayat kasir — melainkan bahwa TIAP berkas yang memakai `formatWaktu`
 * tanpa satu pun pemformat tanggal punya KEPUTUSAN tertulis. Meniru
 * `kunci-belum-dibaca.txt` dan `potong-berpenanda`: daftar beralasan, ratchet
 * dua arah.
 *
 * BATASNYA, ditulis supaya "hijau" tak terbaca lebih luas dari yang benar:
 * granularitasnya PER BERKAS. Satu berkas bisa punya satu situs bertanggal dan
 * satu daftar lintas-hari tanpa tanggal, dan ratchet ini tak akan melihatnya.
 * Yang membuatnya tetap berguna: kasus nyata yang melahirkannya (kartu Beli
 * Perlengkapan) justru punya tanggalnya di BERKAS LAIN (`kolom-*.tsx`), jadi
 * berkasnya sendiri memang "tanpa tanggal" — dan tertangkap.
 */

const AKAR = fileURLToPath(new URL("../../web/src/", import.meta.url));
const PEMAKAI_WAKTU = /\bformatWaktu\(/;
const PEMFORMAT_TANGGAL = /\bformatTanggal(?:Ringkas|Jam)?\(|\bwaktuKertasWIB\(/;

/**
 * Berkas yang memakai `formatWaktu` tanpa pemformat tanggal, DAN itu benar.
 * Kuncinya jalur relatif `apps/web/src`; nilainya alasan yang bisa diperiksa.
 */
const DIPUTUSKAN: Record<string, string> = {
  "pages/kasir/RiwayatPage.tsx":
    "daftar SEHARI — `tanggal` state + <input type=\"date\">; harinya sudah di layar",
  "pages/absen/AbsenPage.tsx":
    "GET /absensi bawaannya `tanggalDi(hari ini)`; baris 'Masuk pukul …' konfirmasi sesaat",
  "pages/pengaturan/MejaPage.tsx": "keadaan meja HARI INI — 'Dibereskan 14.32'",
  "pages/pengaturan/MejaStatusPanel.tsx": "keadaan meja HARI INI (panel yang sama)",
};

/** Lima berkas yang diperbaiki putaran ini — tak boleh kembali jam-saja. */
const DIPERBAIKI = [
  "pages/perlengkapan/BeliPerlengkapanPage.tsx",
  "pages/stok/PermintaanStokPage.tsx",
  "pages/TempatSampahPage.tsx",
  "pages/pengaturan/KartuSupplierPage.tsx",
  "pages/stok/StokPerlengkapanTab.tsx",
] as const;

function berkasTsx(dir: string, keluar: string[] = []): string[] {
  for (const nama of readdirSync(dir)) {
    if (nama === "node_modules" || nama === "dist") continue;
    const p = dir + nama;
    if (statSync(p).isDirectory()) berkasTsx(p + "/", keluar);
    else if (nama.endsWith(".tsx")) keluar.push(p);
  }
  return keluar;
}

type Golongan = "bukan-pemakai" | "bertanggal" | "tanpa-tanggal";
function golongkan(isi: string): Golongan {
  if (!PEMAKAI_WAKTU.test(isi)) return "bukan-pemakai";
  return PEMFORMAT_TANGGAL.test(isi) ? "bertanggal" : "tanpa-tanggal";
}

const populasi = berkasTsx(AKAR).map((p) => ({
  nama: p.slice(AKAR.length),
  golongan: golongkan(readFileSync(p, "utf8")),
}));
const pemakai = populasi.filter((b) => b.golongan !== "bukan-pemakai");
const tanpaTanggal = pemakai.filter((b) => b.golongan === "tanpa-tanggal").map((b) => b.nama);

describe("formatWaktu tanpa tanggal — tiap berkas diputuskan", () => {
  it("premis: sapuannya memulangkan populasi web, bukan pecahannya", () => {
    // Sapuan tipis tak menuduh siapa pun — ia hanya berhenti bisa menuduh.
    // 32 berkas pemakai saat ditulis.
    expect(pemakai.length, "pemakai formatWaktu terlalu sedikit — jalur atau regexnya rusak")
      .toBeGreaterThan(25);
    for (const k of Object.keys(DIPUTUSKAN)) {
      expect(populasi.some((b) => b.nama === k), `entri DIPUTUSKAN tak ada di disk: ${k}`).toBe(true);
    }
  });

  it("INTI: berkas formatWaktu-tanpa-tanggal wajib ada di DIPUTUSKAN, dengan namanya", () => {
    const tanpaKeputusan = tanpaTanggal.filter((n) => !(n in DIPUTUSKAN)).sort();
    expect(
      tanpaKeputusan,
      "berkas ini memakai `formatWaktu` (jam-menit saja) tanpa satu pun pemformat " +
        "tanggal. Kalau daftarnya SEHARI, daftarkan di DIPUTUSKAN dengan alasannya; " +
        "kalau lintas-hari, pakai `formatTanggalJam`:\n" +
        tanpaKeputusan.join("\n"),
    ).toEqual([]);
  });

  it("RATCHET: tiap entri DIPUTUSKAN masih memenuhi syaratnya — entri basi merah", () => {
    // Berkas yang kini sudah bertanggal, atau tak lagi memakai formatWaktu,
    // tak boleh tetap terdaftar: entri basi menyembunyikan kemajuan dan
    // pelan-pelan mengubah daftar ini jadi tong sampah.
    const basi = Object.keys(DIPUTUSKAN)
      .filter((k) => !tanpaTanggal.includes(k))
      .sort();
    expect(basi, "entri DIPUTUSKAN yang sudah tak perlu — hapus:\n" + basi.join("\n")).toEqual([]);
  });

  it("PASANGAN: kelima berkas putaran ini bertanggal, dan tak lagi memanggil formatWaktu", () => {
    for (const n of DIPERBAIKI) {
      const isi = readFileSync(AKAR + n, "utf8");
      expect(PEMAKAI_WAKTU.test(isi), `${n} kembali memanggil formatWaktu`).toBe(false);
      expect(/\bformatTanggalJam\(/.test(isi), `${n} kehilangan formatTanggalJam`).toBe(true);
    }
    // Ketiga situs Beli Perlengkapan — kartu, detail, DAN kepala dokumen RAB
    // yang dicetak. Dua yang diperbaiki sementara satunya tidak adalah berkas
    // yang terbelah, persis bentuk yang melahirkan putaran ini.
    const bp = readFileSync(AKAR + "pages/perlengkapan/BeliPerlengkapanPage.tsx", "utf8");
    expect((bp.match(/\bformatTanggalJam\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("PASANGAN: penggolongnya bisa dibuktikan pada masukan sintetis", () => {
    // Kalau regexnya rusak, INTI kosong karena tak ada yang tergolong "tanpa
    // tanggal" — hijau secara hampa. Tiga bentuk yang harus dibedakan.
    expect(golongkan("const x = formatWaktu(a);")).toBe("tanpa-tanggal");
    expect(golongkan("formatWaktu(a); formatTanggalRingkas(a);")).toBe("bertanggal");
    expect(golongkan("formatTanggalJam(a);")).toBe("bukan-pemakai");
    expect(golongkan("waktuKertasWIB(a); formatWaktu(a);")).toBe("bertanggal");
    // Nama yang cuma MIRIP tak boleh lolos: `formatWaktuStruk(` bukan `formatWaktu(`.
    expect(golongkan("formatWaktuStruk(a);")).toBe("bukan-pemakai");
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Penjaga "BELUM ADA ≠ TIDAK TERBACA" pada dua layar cuti/libur.
 *
 * Keduanya memakai `data: x = []`, jadi bacaan yang DITOLAK mendarat sebagai
 * daftar kosong — dan keduanya mengubah kekosongan itu menjadi PERNYATAAN:
 *
 * 1. `PengajuanCutiSection` (halaman Absen, semua peran) berbunyi "Belum ada
 *    pengajuan. Tekan Ajukan". Yang membacanya menurut — lalu server menolak
 *    409 "Sudah ada pengajuan Anda pada tanggal yang bertindih — batalkan dulu
 *    yang lama", sedangkan satu-satunya layar yang punya tombol Batalkan sedang
 *    bersikeras tak ada apa pun untuk dibatalkan. Perintahnya buntu.
 *    Ditambah: `alasan_tolak` hanya muncul di daftar ini, jadi penolakan
 *    beserta alasannya ikut lenyap tanpa suara.
 *
 * 2. `RekapAbsenPage` (owner/admin) berbunyi "Tidak ada pengajuan pada saringan
 *    ini" dengan saringan bawaan `menunggu` — yaitu "tak ada yang perlu
 *    di-ACC". Kartu "Pengajuan menunggu" ikut menulis 0. Padahal cuti yang tak
 *    pernah di-ACC dihitung TIDAK HADIR oleh rekap di tab sebelah halaman yang
 *    sama; halaman itu sudah menulis "—" untuk angka rekapnya sendiri, tapi
 *    angka pengajuannya luput.
 *
 * Uji ini menjaga TEKS layarnya, karena persis di situlah cacatnya hidup.
 */
const baca = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const SECTION = baca("../../web/src/components/PengajuanCutiSection.tsx");
const REKAP = baca("../../web/src/pages/absen/RekapAbsenPage.tsx");

/** Buang komentar supaya kalimat di dalamnya tak dikira kode yang hidup. */
const kode = (s: string) =>
  s
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

const SECTION_KODE = kode(SECTION);
const REKAP_KODE = kode(REKAP);

describe("premis: kedua layar memang menjatuhkan bacaan gagal jadi daftar kosong", () => {
  it("keduanya memakai bawaan `= []`", () => {
    // Kalau suatu hari bawaannya hilang (mis. jadi `data: daftar`), pola
    // salahnya berubah dan penjagaan di bawah perlu ditinjau ulang.
    expect(SECTION_KODE).toMatch(/data: daftar = \[\]/);
    expect(REKAP_KODE).toMatch(/data: pengajuan = \[\]/);
    expect(REKAP_KODE).toMatch(/data: menunggu = \[\]/);
  });

  it("server memang menolak pengajuan yang bertindih dengan pesan 'batalkan dulu yang lama'", () => {
    // Inilah yang membuat kalimat "Belum ada pengajuan" jadi jalan buntu, bukan
    // sekadar kurang informatif. Bila pesan servernya berubah, alasan uji ini
    // ikut berubah.
    const routes = baca("../src/modules/pengajuan/routes.ts");
    expect(routes).toContain("batalkan dulu yang lama");
    expect(routes).toMatch(/inArray\(leaveRequests\.status, \["menunggu", "disetujui"\]\)/);
  });

  it("dan rekap absen memang menghitung cuti yang belum disetujui sebagai TIDAK HADIR", () => {
    // Taruhan kartu "Pengajuan menunggu": yang tak di-ACC bukan cuma tertunda,
    // ia berubah jadi alpa di tab sebelah.
    const routes = baca("../src/modules/pengajuan/routes.ts");
    expect(routes).toMatch(/eq\(leaveRequests\.status, "disetujui"\)/);
    expect(REKAP).toContain("sudah disetujui");
  });
});

describe("halaman Absen: daftar pengajuan sendiri", () => {
  it("galatnya diambil dari useQuery, bukan dibuang", () => {
    expect(SECTION_KODE).toMatch(/data: daftar = \[\], error: gagalDaftar/);
  });

  it("saat gagal, layarnya TIDAK berkata 'Belum ada pengajuan'", () => {
    // Percabangan gagal harus mendahului percabangan kosong; kalau urutannya
    // terbalik, daftar kosong karena gagal tetap jatuh ke kalimat yang salah.
    const iGagal = SECTION_KODE.indexOf("gagalDaftar ? (");
    const iKosong = SECTION_KODE.indexOf("daftar.length === 0 ? (");
    expect(iGagal, "percabangan gagal tak ditemukan").toBeGreaterThan(0);
    expect(iKosong).toBeGreaterThan(iGagal);
  });

  it("dan mengatakan apa yang sebenarnya terjadi, termasuk risiko 409-nya", () => {
    expect(SECTION_KODE).toContain("tidak terbaca");
    // Frasa yang TIDAK terpotong pembungkus baris JSX — pelajaran lama: regex
    // yang melintasi pergantian baris hijau/merah karena format, bukan isi.
    expect(SECTION_KODE).toContain("pengajuan lama yang belum tampil di sini");
    // Pesan galat aslinya ikut ditampilkan, bukan cuma kalimat umum.
    expect(SECTION_KODE).toMatch(/<ErrorText error=\{gagalDaftar\} \/>/);
  });
});

describe("Rekap Absen: daftar & hitungan pengajuan", () => {
  it("kedua galatnya diambil", () => {
    expect(REKAP_KODE).toMatch(/data: pengajuan = \[\], error: gagalPengajuan/);
    expect(REKAP_KODE).toMatch(/data: menunggu = \[\], error: gagalMenunggu/);
  });

  it("kartu 'Pengajuan menunggu' menulis '—', bukan 0, saat bacaannya ditolak", () => {
    expect(REKAP_KODE).toContain('value={gagalMenunggu ? "—" : menunggu.length}');
    // Nada oranye = "ada yang perlu ditindak". Angka yang tak diketahui tak
    // boleh memakainya, dan tak boleh pula tampak tenang seperti nol.
    expect(REKAP_KODE).toContain(
      'nada={!gagalMenunggu && menunggu.length > 0 ? "text-orange-600" : undefined}',
    );
  });

  it("hitungan pada label tab ikut padam", () => {
    expect(REKAP_KODE).toMatch(/Pengajuan \{!gagalMenunggu && menunggu\.length > 0 &&/);
  });

  it("tabel pengajuan tidak lagi berkata 'tidak ada' saat ia tak tahu", () => {
    expect(REKAP_KODE).toMatch(/kosong=\{\s*gagalPengajuan \? \(/);
    expect(REKAP_KODE).toContain("tidak terbaca");
    // Kalimat lamanya tetap ada — untuk daftar yang MEMANG kosong.
    expect(REKAP_KODE).toContain("Tidak ada pengajuan pada saringan ini.");
    expect(REKAP_KODE).toMatch(/<ErrorText error=\{gagalPengajuan\} \/>/);
  });

  it("perbaikannya lewat prop `kosong` — jadi tabel desktop & kartu HP ikut keduanya", () => {
    // Menyembunyikan <TabelResponsif> hanya akan membetulkan salah satu bila
    // suatu saat percabangannya dipasang di dalam komponen itu.
    //
    // Sejak prop `galat` ada (lihat gagal-muat-bukan-kosong.test.ts), `kosong`
    // tak lagi dirender langsung: ia jadi CADANGAN di dalam `isiKosong`, dan
    // `isiKosong` itulah yang dipasang di kedua tampilan. Jaminannya persis
    // sama — apa pun yang dilewatkan halaman ini sampai ke dua-duanya — jadi
    // patokannya ikut pindah ke simpul barunya, bukan dilonggarkan.
    const t = baca("../../web/src/components/TabelResponsif.tsx");
    expect(t).toContain("const isiKosong = galat ? (");
    expect(t, "`kosong` harus tetap jadi cadangan saat tak ada galat").toMatch(
      /\)\s*:\s*\(\s*kosong\s*\);/,
    );
    expect(t.match(/\{isiKosong\}/g) ?? []).toHaveLength(2);
  });
});

/** Sifat sekitarnya yang sudah benar dan tak boleh ikut rusak. */
describe("penjagaan tetangga tetap utuh", () => {
  it("angka rekap absen tetap '—' saat rekapnya sendiri gagal", () => {
    expect(REKAP_KODE).toContain('value={error ? "—" : totalHadir}');
    expect(REKAP_KODE).toContain('value={error ? "—" : totalAlpa}');
  });

  it("galat diperiksa sebelum isLoading — spinner tak berputar selamanya", () => {
    const iGalat = REKAP_KODE.indexOf("error ? (");
    const iMuat = REKAP_KODE.indexOf("isLoading || !rekap ?");
    expect(iGalat).toBeGreaterThan(0);
    expect(iMuat).toBeGreaterThan(iGalat);
  });

  it("daftar 'saya' tetap memakai ?saya=1", () => {
    expect(SECTION_KODE).toContain('api<PengajuanRow[]>("/pengajuan?saya=1")');
  });
});

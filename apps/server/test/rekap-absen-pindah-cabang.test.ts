import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Penjaga REKAP ABSEN TERHADAP PINDAH CABANG.
 *
 * Rekap absen menjahit tiga tabel, dan ketiganya memakai makna `branch_id`
 * yang BERBEDA:
 *
 *   memberships.branchId   penugasan BERJALAN — bisa diubah kapan saja lewat
 *                          `PATCH /users/:id` (pindah cabang)
 *   attendances.branchId   FAKTA SEJARAH — di mana cap itu terjadi, tak pernah
 *                          diperbarui
 *   leaveRequests.branchId POTRET saat pengajuan dikirim, juga tak diperbarui
 *
 * Daftar karyawannya diambil dari yang PERTAMA, sedangkan fakta hadir & cuti
 * disaring dengan yang KEDUA dan KETIGA. Selama tak ada yang pindah cabang
 * ketiganya sejalan; begitu seseorang dipindah, ketiganya berselisih:
 *
 *  - Rekap cabang BARU: orangnya terdaftar (penugasan berjalan), tapi cap dan
 *    cuti dari sebelum pindah masih bercabang LAMA sehingga dibuang. Tanggal
 *    yang sebenarnya HADIR — dan cuti yang sudah di-ACC — jatuh jadi ALPA.
 *  - Rekap cabang LAMA: orangnya tak terdaftar sama sekali, jadi riwayat asli
 *    di cabang itu tak bisa dilihat dari mana pun.
 *  - "Semua cabang": benar. Jadi bulan yang sama terbaca dua macam tergantung
 *    saringan, dan tak ada yang mengatakannya.
 *
 * Taruhannya bukan kosmetik: angka itu kartu "Total tidak hadir" di layar yang
 * sama, dan halamannya mencetak klaim bahwa hanya tanggal di luar masa kerja
 * yang tidak dihitung.
 *
 * SIFAT YANG DIJAGA: memilih cabang hanya mengubah SIAPA yang terdaftar —
 * tidak pernah mengubah angka siapa pun yang terdaftar. Itu ditegakkan dengan
 * menyaring fakta per ORANG (daftarnya sudah dipersempit), bukan per cabang.
 */
const baca = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const ABSENSI = baca("../src/modules/absensi/routes.ts");
const PENGAJUAN = baca("../src/modules/pengajuan/routes.ts");
const USERS = baca("../src/modules/users/routes.ts");

const tanpaKomentar = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const ABSENSI_KODE = tanpaKomentar(ABSENSI);
const PENGAJUAN_KODE = tanpaKomentar(PENGAJUAN);

/**
 * Potongan sumber mulai dari sebuah penanda sampai akhir berkas.
 *
 * Dipakai untuk larangan yang berlaku HANYA di dalam satu blok. Menyaring
 * cap per cabang benar di tempat lain — `sedangHadir` menanyakan "sudah absen
 * di cabang INI?" untuk gerbang buka-shift, dan `GET /pengajuan` menyaring
 * daftarnya per cabang. Larangan seluruh berkas akan ikut membunuh keduanya.
 */
const sejak = (s: string, penanda: string) => {
  const i = s.indexOf(penanda);
  expect(i, `penanda tak ditemukan: ${penanda}`).toBeGreaterThan(0);
  return s.slice(i);
};

describe("premis: pindah cabang memang bisa terjadi, dan dua kolom lain tak ikut pindah", () => {
  it("`PATCH /users/:id` memang menulis ulang `memberships.branchId`", () => {
    // Tanpa ini seluruh cacatnya cuma teori.
    expect(tanpaKomentar(USERS)).toMatch(/branchId: targetBranch \?\? null/);
    expect(tanpaKomentar(USERS)).toMatch(
      /body\.branch_id !== undefined \? body\.branch_id : member\.branchId/,
    );
  });

  it("cap absen menyimpan cabang TEMPAT KEJADIAN dan tak pernah diperbarui", () => {
    // `catatAbsen` menulis branchId sekali saat insert; tak ada UPDATE di mana pun.
    expect(ABSENSI_KODE).toMatch(/\.insert\(attendances\)[\s\S]{0,200}branchId: opts\.branchId/);
    expect(ABSENSI_KODE).not.toMatch(/update\(attendances\)/);
  });

  it("cabang pada pengajuan juga potret sekali-tulis", () => {
    expect(PENGAJUAN_KODE).toMatch(/branchId: m\?\.branchId \?\? null/);
    expect(PENGAJUAN_KODE).not.toMatch(/set\(\{[\s\S]{0,120}branchId/);
  });
});

describe("rekap menyaring fakta PER ORANG, bukan per cabang", () => {
  it("daftar karyawan tetap dipersempit oleh cabang — itu memang gunanya saringan", () => {
    expect(ABSENSI_KODE).toMatch(/branchId \? eq\(memberships\.branchId, branchId\) : undefined/);
  });

  it("id karyawan diturunkan dari daftar itu", () => {
    expect(ABSENSI_KODE).toMatch(/const idKaryawan = karyawan\.map\(\(k\) => k\.user_id\)/);
  });

  it("cap absen disaring dengan id karyawan, BUKAN dengan cabang", () => {
    const rekap = sejak(ABSENSI_KODE, '.get("/rekap"');
    expect(rekap).toContain("inArray(attendances.userId, idKaryawan)");
    // Bentuk lama, dilarang DI DALAM /rekap saja: `sedangHadir` memang berhak
    // menanyakan "sudah absen di cabang INI?" untuk gerbang buka-shift.
    expect(rekap).not.toContain("attendances.branchId");
  });

  it("cuti/libur juga per orang", () => {
    expect(ABSENSI_KODE).toMatch(
      /pengajuanDisetujuiPadaRentang\(\s*auth\.company_id!,\s*dari,\s*sampai,\s*idKaryawan,?\s*\)/,
    );
    const fn = sejak(PENGAJUAN_KODE, "export async function pengajuanDisetujuiPadaRentang");
    expect(fn).toContain("inArray(leaveRequests.userId, userIds)");
    // Sekali lagi hanya di dalam fungsinya — `GET /pengajuan` boleh menyaring
    // daftarnya per cabang, itu daftar, bukan penjahitan rekap.
    expect(fn).not.toContain("leaveRequests.branchId");
  });

  it("daftar kosong tidak berubah jadi 'ambil semua'", () => {
    // `inArray(x, [])` bukan jaring pengaman yang boleh diandalkan, dan
    // menghapus penyaringnya saat daftar kosong akan menarik SELURUH
    // perusahaan. Keduanya dijaga dengan hubung-singkat eksplisit.
    expect(ABSENSI_KODE).toMatch(/idKaryawan\.length === 0\s*\?\s*\[\]/);
    expect(PENGAJUAN_KODE).toMatch(/if \(userIds\?\.length === 0\) return \[\]/);
  });
});

/**
 * Sifat sekitarnya yang sudah benar dan tak boleh ikut rusak saat menyentuh
 * berkas ini — semuanya penjagaan yang sudah dibayar mahal sebelumnya.
 */
describe("penjagaan tetangga tetap utuh", () => {
  it("batas bulan karyawan arsip/baru tetap dibandingkan sebagai TANGGAL SETEMPAT", () => {
    // Pernah salah sebagai timestamp UTC: yang diarsipkan 00:00–07:00 WIB
    // tanggal 1 dianggap keluar bulan lalu dan lenyap dari rekap arsip.
    expect(ABSENSI_KODE).toMatch(/tanggalDi\(tz, k\.bergabung\) <= sampai/);
    expect(ABSENSI_KODE).toMatch(/tanggalDi\(tz, k\.arsip\) >= dari/);
  });

  it("jendela hitung per karyawan masih dipotong bergabung & arsip", () => {
    expect(ABSENSI_KODE).toMatch(/const mulaiHitung = \(\) => \{|const mulaiHitung = \(\(\) =>/);
    expect(ABSENSI_KODE).toContain("const akhirHitung");
    // Kalimat di sini dulu berbunyi "hanya ALPA yang tunduk pada jendela —
    // hadir/cuti tetap ditampilkan", dan itulah bugnya, tertulis. Cuti yang
    // di-ACC melewati tanggal seseorang KELUAR tetap terhitung: 3 hari cuti
    // berbayar untuk orang yang sudah tidak bekerja di sana. Aturannya kini
    // `nilaiHariRekap`, dan dijalankan langsung di rekap-jendela-izin.test.ts —
    // yang tersisa di sini cuma penanda bahwa rekapnya memakai aturan itu,
    // bukan salinan sendiri.
    expect(ABSENSI_KODE).toMatch(/const hari = nilaiHariRekap\(/);
    expect(ABSENSI_KODE).not.toMatch(/if \(dalamJendela\) \{\s*alpa\+\+/);
  });

  it("bulan wajib 01–12 — pola longgar melahirkan tanggal mustahil lalu 500", () => {
    expect(ABSENSI_KODE).toMatch(/\/\^\\d\{4\}-\(0\[1-9\]\|1\[0-2\]\)\$\//);
  });

  it("rekap tetap owner/admin saja walau grupnya terbuka", () => {
    expect(ABSENSI_KODE).toMatch(/\.get\("\/rekap", requireRole\("owner", "admin"\)/);
  });

  it("hanya pengajuan DISETUJUI yang mengubah alpa jadi cuti/libur", () => {
    expect(PENGAJUAN_KODE).toMatch(/eq\(leaveRequests\.status, "disetujui"\)/);
  });
});

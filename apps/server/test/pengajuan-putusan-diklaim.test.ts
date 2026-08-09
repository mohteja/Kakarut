import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * PUTUSAN PENGAJUAN DIKLAIM, BUKAN SEKADAR DIPERIKSA.
 *
 * `PATCH /pengajuan/:id` membaca statusnya, menolak bila bukan `menunggu`, lalu
 * menulis putusannya. Dulu UPDATE-nya `WHERE id = …` saja — tanpa syarat status
 * sama sekali, bentuk paling longgar dari pola ini.
 *
 * Dua atasan yang memutus pengajuan yang SAMA di saat bersamaan — owner
 * menyetujui, admin menolak — sama-sama membaca `menunggu` (READ COMMITTED tak
 * memperlihatkan tulisan yang belum di-commit), lalu sama-sama menulis.
 * Penulis terakhir menang DIAM-DIAM: keduanya dibalas 200, keduanya mengira
 * putusannya berlaku, dan `diputus_oleh` hanya merekam salah satunya tanpa
 * petunjuk bahwa yang lain pernah terjadi. Karyawannya bisa diberi tahu
 * "disetujui" sementara catatannya berbunyi "ditolak".
 *
 * `DELETE` punya kerabatnya, dan lebih tajam: pemohon hanya boleh membatalkan
 * selama `menunggu`, tapi syarat itu dulu tak ikut di WHERE-nya. Pembatalan
 * yang datang tepat saat atasan menyetujui akan MENANG — pengajuan yang sudah
 * disetujui lenyap tanpa jejak, sementara atasannya sudah dibalas 200.
 *
 * Idiomnya bukan rekaan: persetujuan penyesuaian opname di modul stok
 * menghadapi persoalan yang sama dan sudah lama memakai UPDATE bersyarat +
 * periksa barisnya. Uji ini mematok jalur pengajuan menyusulnya.
 */
const AKAR = fileURLToPath(new URL("../../../", import.meta.url));
const SRC = readFileSync(AKAR + "apps/server/src/modules/pengajuan/routes.ts", "utf8");

const PATCH = (() => {
  const i = SRC.indexOf('.patch("/:id"');
  expect(i, "handler putusan tak ditemukan").toBeGreaterThan(0);
  return SRC.slice(i, SRC.indexOf('.delete("/:id"', i));
})();
const HAPUS = (() => {
  const i = SRC.indexOf('.delete("/:id"');
  expect(i, "handler pembatalan tak ditemukan").toBeGreaterThan(0);
  return SRC.slice(i, i + 2000);
})();

describe("pengajuan: putusan & pembatalan diklaim", () => {
  it("putusan ditulis lewat UPDATE BERSYARAT status='menunggu'", () => {
    // Inti perbaikannya. `WHERE id` saja membuat putusan kedua menimpa yang
    // pertama tanpa suara.
    expect(
      /eq\(leaveRequests\.status, "menunggu"\)/.test(PATCH),
      "UPDATE putusan tanpa syarat status — dua atasan bisa saling menimpa diam-diam",
    ).toBe(true);
  });

  it("hasil UPDATE putusan diperiksa, bukan dibuang", () => {
    // UPDATE yang mencocokkan NOL baris bukan galat; tanpa pemeriksaan ini
    // yang kalah tetap dibalas 200.
    expect(PATCH).toMatch(/\.returning\(\{ id: leaveRequests\.id \}\)/);
    expect(PATCH).toMatch(/if \(diputus\.length === 0\)/);
  });

  it("pembatalan oleh PEMOHON membawa syarat status di WHERE-nya", () => {
    // Memeriksa di atas lalu menghapus tanpa syarat membuat pembatalan menang
    // atas persetujuan yang sedang berjalan.
    expect(HAPUS).toMatch(/manajemen \? \[\] : \[eq\(leaveRequests\.status, "menunggu"\)\]/);
    expect(HAPUS).toMatch(/if \(dihapus\.length === 0\)/);
  });

  it("manajemen TETAP boleh menghapus kapan saja", () => {
    /*
     * Syaratnya sengaja hanya untuk pemohon — owner/admin memang boleh
     * menghapus putusan yang salah ACC. Menyamakan keduanya akan menutup jalur
     * perbaikan yang sah.
     */
    expect(HAPUS).toContain("manajemen ? [] :");
  });

  it("keduanya ter-scope perusahaan di WHERE, bukan hanya di pembacaan", () => {
    expect(PATCH).toContain("eq(leaveRequests.companyId, auth.company_id!)");
    expect(HAPUS).toContain("eq(leaveRequests.companyId, auth.company_id!)");
  });
});

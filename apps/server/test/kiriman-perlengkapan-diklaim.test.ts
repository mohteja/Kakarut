import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * KIRIMAN PERLENGKAPAN DIKLAIM, BUKAN SEKADAR DIPERIKSA.
 *
 * `terimaKirimanPerlengkapan` dulu membaca kiriman, menolak bila statusnya
 * bukan `dikirim`, lalu di dalam transaksi membalik statusnya dengan
 * `UPDATE … WHERE id = …` — TANPA syarat status — dan menulis sepasang mutasi
 * stok. Rangkaian itu hanya menangkap percobaan BERURUTAN.
 *
 * Dua orang menekan "Terima" pada kiriman yang sama di saat bersamaan
 * sama-sama membaca status `dikirim` (READ COMMITTED tak memperlihatkan
 * tulisan yang belum di-commit), jadi keduanya lolos penjaganya dan keduanya
 * menulis mutasinya: stok dikreditkan DUA KALI di cabang tujuan dan didebit
 * dua kali di cabang asal — permanen, dan tanpa jejak selain dua baris mutasi
 * kembar ber-nomor kiriman sama.
 *
 * Tak ada pengaman lain yang menahannya, dan itu sudah diperiksa:
 * `supply_mutations_auto_uq` PARSIAL (`WHERE tipe = 'auto'`) sedangkan baris
 * ini ber-tipe `kirim`/`terima`, dan mutasinya lahir ber-status bawaan
 * `disetujui` sehingga langsung terhitung di seluruh pembaca saldo.
 *
 * Balapannya butuh dua transaksi serentak melawan Postgres, jadi yang dipatok
 * di sini SYARAT pada UPDATE-nya dan PEMERIKSAAN hasilnya — dua sifat yang
 * membuat klaimnya mengikat, dan yang tak bisa disimpulkan dari satu
 * permintaan tunggal.
 */
const AKAR = fileURLToPath(new URL("../../../", import.meta.url));
const SRC = readFileSync(AKAR + "apps/server/src/modules/perlengkapan/service.ts", "utf8");

/** Badan `terimaKirimanPerlengkapan` saja. */
const FN = (() => {
  const i = SRC.indexOf("export async function terimaKirimanPerlengkapan");
  expect(i, "terimaKirimanPerlengkapan tak ditemukan").toBeGreaterThan(0);
  return SRC.slice(i, i + 3400);
})();

describe("perlengkapan: kiriman diklaim saat diterima", () => {
  it("status dibalik lewat UPDATE BERSYARAT status='dikirim'", () => {
    // Inti perbaikannya. `WHERE id = …` saja membuat dua penerima sama-sama
    // lolos dan sama-sama menulis mutasi stok.
    expect(
      /eq\(supplyTransfers\.status, "dikirim"\)/.test(FN),
      "UPDATE penerimaan tanpa syarat status — dua penerima bisa sama-sama menulis mutasi",
    ).toBe(true);
  });

  it("hasil UPDATE diperiksa, bukan dibuang", () => {
    // UPDATE yang mencocokkan NOL baris bukan galat. Tanpa pemeriksaan ini,
    // yang kalah balapan tetap lanjut menulis mutasinya.
    expect(FN).toMatch(/\.returning\(\{ id: supplyTransfers\.id \}\)/);
    expect(FN).toMatch(/if \(klaim\.length === 0\)/);
  });

  it("yang kalah TIDAK menulis mutasi stok apa pun", () => {
    // Urutannya yang menentukan: pemeriksaan harus mendahului insert mutasi.
    const iCek = FN.indexOf("if (klaim.length === 0)");
    const iMutasi = FN.indexOf("insert(supplyMutations)");
    expect(iCek, "pemeriksaan klaim tak ditemukan").toBeGreaterThan(0);
    expect(iMutasi, "insert mutasi tak ditemukan").toBeGreaterThan(0);
    expect(
      iCek < iMutasi,
      "mutasi stok ditulis SEBELUM klaimnya diperiksa — jendela dobelnya terbuka",
    ).toBe(true);
  });

  it("yang kalah dibalas sama dengan percobaan berurutan", () => {
    // Sebab baru akan membuat klien memperlakukannya sebagai kegagalan asing.
    // Percobaan berurutan sudah lama dibalas "Kiriman sudah diterima" 400.
    const cocok = FN.match(/Kiriman sudah diterima/g) ?? [];
    expect(cocok.length, "balasan kalah-balapan harus memakai pesan yang sama").toBeGreaterThanOrEqual(2);
  });
});

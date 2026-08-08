import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * SATU OPEN BILL TAK BOLEH JADI DUA PENJUALAN.
 *
 * `createSale` membaca bill-nya, menolak kalau `closed_at` sudah terisi, lalu
 * di ujung transaksi menutupnya dengan `UPDATE … WHERE closed_at IS NULL`.
 * Rangkaian itu hanya menangkap kasus BERURUTAN. Dua kasir yang menekan
 * "bayar" pada bill yang sama di saat bersamaan sama-sama membaca `closed_at`
 * masih kosong — READ COMMITTED tak memperlihatkan tulisan yang belum
 * di-commit — jadi keduanya lolos penjaganya dan keduanya MENERBITKAN
 * PENJUALAN. Yang kedua lalu gagal mengunci bill-nya, tapi diam-diam: `UPDATE`
 * yang tak mencocokkan satu baris pun bukan galat. Satu bill, dua transaksi,
 * tamu tertagih dua kali.
 *
 * Obatnya mengunci barisnya saat dibaca — idiom yang SUDAH dipakai
 * `refundSajian` di modul yang sama, untuk bahaya yang persis sama.
 *
 * Balapan sungguhan butuh dua transaksi serentak melawan Postgres, jadi yang
 * dipatok di sini KUNCI dan PEMERIKSAAN HASILNYA — dua sifat yang membuat
 * penjaganya benar-benar mengikat, dan yang tak bisa disimpulkan dari hasil
 * satu permintaan tunggal. Perilaku ujung-ke-ujungnya dijaga verify-api.
 */
const AKAR = fileURLToPath(new URL("../../../", import.meta.url));
const SRC = readFileSync(AKAR + "apps/server/src/modules/penjualan/service.ts", "utf8");

/** Blok `if (params.openBillId) { … }` — tempat bill dibaca & diperiksa. */
const BLOK = (() => {
  const i = SRC.indexOf("if (params.openBillId) {");
  expect(i, "blok pembacaan open bill tak ditemukan").toBeGreaterThan(0);
  return SRC.slice(i, SRC.indexOf("const barisBill", i));
})();

describe("open bill: dikunci saat dibayar", () => {
  it("bill dibaca dengan FOR UPDATE, bukan pembacaan biasa", () => {
    // Inti seluruh perbaikan. Tanpa kunci, penjaga `closedAt` di bawahnya cuma
    // menangkap percobaan kedua yang datang SESUDAH yang pertama selesai.
    expect(
      /\.for\("update"\)/.test(BLOK),
      "SELECT open bill tanpa FOR UPDATE — dua kasir bisa sama-sama lolos penjaganya",
    ).toBe(true);
  });

  it("kunci diambil SEBELUM penjaga closedAt dievaluasi", () => {
    // Mengunci sesudah memeriksa tak ada gunanya: keputusannya sudah diambil
    // dari snapshot yang basi.
    const iKunci = BLOK.indexOf('.for("update")');
    const iJaga = BLOK.indexOf("if (bill.closedAt)");
    expect(iKunci, "FOR UPDATE tak ditemukan").toBeGreaterThan(0);
    expect(iJaga, "penjaga closedAt tak ditemukan").toBeGreaterThan(0);
    expect(iKunci < iJaga, "penjaga closedAt dievaluasi SEBELUM barisnya dikunci").toBe(true);
  });

  it("penutupan bill memeriksa apakah benar-benar mengunci satu baris", () => {
    /*
     * `UPDATE … WHERE closed_at IS NULL` yang mencocokkan NOL baris berarti
     * bill-nya sudah ditutup pihak lain — dan penjualan yang barusan dibuat
     * seharusnya tak pernah ada. Membiarkannya lewat persis itulah yang dulu
     * menerbitkan transaksi kedua tanpa jejak.
     */
    const i = SRC.indexOf("closedAt: new Date(), saleId: sale.id");
    expect(i, "penutupan bill tak ditemukan").toBeGreaterThan(0);
    const sesudah = SRC.slice(i, i + 700);
    expect(sesudah).toContain(".returning(");
    expect(sesudah).toMatch(/if \(kunci\.length === 0\)/);
    expect(sesudah).toContain("bill_sudah_dibayar");
  });

  it("penolakannya memakai sebab yang sudah dikenal klien, bukan galat baru", () => {
    // `bill_sudah_dibayar` sudah dipakai jalur berurutan dan sudah ditangani
    // antrean offline: kiriman kembar aman dibuang. Sebab baru akan membuat
    // klien memperlakukannya sebagai kegagalan yang tak dikenal.
    expect(BLOK).toContain("bill_sudah_dibayar");
    expect(BLOK).toContain("bill_dibatalkan");
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * UANG WAJIB MENYATU DENGAN PERPINDAHAN TAHAP — satu transaksi, bukan dua.
 *
 * `POST /produksi/tahap/:fakturId` punya DUA jalur. Jalur maju-sebagian selalu
 * menulis `fakturDana` di dalam transaksi yang memindahkan tahap. Jalur
 * faktur-utuh dulu tidak: transaksinya ditutup lebih dulu, lalu pencairan
 * ditulis dengan `db` — koneksi terpisah, di luar jaminan atomiknya.
 *
 * Bila penulisan itu gagal (koneksi putus, timeout, constraint), fakturnya
 * SUDAH terlanjur maju tahap sementara pencairannya tak tercatat sama sekali.
 * Dan itu tak bisa diulang: percobaan kedua ditolak "Tahap tidak berurutan"
 * karena statusnya sudah pindah. Uang yang benar-benar keluar lenyap dari
 * pembukuan — hanya bisa dibetulkan lewat entri manual, kalau ada yang sadar.
 *
 * Uji ini menjaga invariannya secara STRUKTURAL, bukan runtime: kegagalan
 * koneksi di tengah transaksi tak bisa dipentaskan lewat HTTP tanpa menyuntik
 * galat ke lapisan basis data. Yang dikunci di sini adalah bentuk kodenya,
 * supaya jalur ini tak bisa diam-diam kembali ke pola lama.
 */
const RUTE = readFileSync(
  fileURLToPath(new URL("../src/modules/produksi/routes.ts", import.meta.url)),
  "utf8",
);

describe("produksi /tahap: pencairan dana ikut transaksi tahapnya", () => {
  it("tak ada satu pun penulisan dana lewat handle `db`", () => {
    // Ini bentuk bugnya yang dulu. Kalau muncul lagi di mana pun di berkas
    // ini, ia membawa kembali akibat yang sama.
    expect(RUTE).not.toContain("db.insert(fakturDana)");
    expect(RUTE).not.toContain("catatRealisasiDana(db,");
  });

  it("kedua jalur menulis `fakturDana` dengan `tx`", () => {
    // Jalur maju-sebagian DAN jalur faktur-utuh. Dua-duanya, bukan salah satu:
    // asimetri antar jalur di berkas yang sama persis yang jadi bugnya.
    const pakaiTx = RUTE.split("await tx.insert(fakturDana).values({").length - 1;
    expect(pakaiTx).toBeGreaterThanOrEqual(2);
  });

  it("realisasi dana juga lewat `tx`", () => {
    expect(RUTE).toContain("await catatRealisasiDana(tx, {");
  });

  it("penjaga `diperbarui.length === 0` ADA DI DALAM transaksi", () => {
    /*
     * Penjaganya harus mendahului penulisan uang DAN berada di dalam
     * transaksi. Melempar di sana me-rollback, dan itu yang benar: kalau tak
     * satu pun baris berpindah tahap, tak ada uang yang boleh ikut tercatat.
     * Kalau penjaga ini terlempar keluar transaksi lagi, urutannya rusak dan
     * uang bisa tertulis untuk faktur yang tak bergerak.
     */
    const iJaga = RUTE.indexOf("if (diperbarui.length === 0) {");
    const iTutup = RUTE.indexOf("          return diperbarui;\n        });");
    expect(iJaga, "penjaga tak ditemukan").toBeGreaterThan(0);
    expect(iTutup, "penutup transaksi tak ditemukan").toBeGreaterThan(0);
    expect(iJaga).toBeLessThan(iTutup);

    const iDana = RUTE.indexOf("await tx.insert(fakturDana).values({", iJaga);
    expect(iDana).toBeGreaterThan(iJaga);
    expect(iDana).toBeLessThan(iTutup);
  });

  it("log jejak SENGAJA tetap di luar transaksi", () => {
    /*
     * Bukan kelalaian, dan bukan pula yang lupa ikut dipindahkan. Gagal
     * mencatat jejak tidak boleh membatalkan perpindahan tahap dan pencairan
     * yang sudah sah — konsisten dengan pemanggilan `catatLogFaktur(db, …)`
     * lain di repo ini. Uji ini mengunci pembedaan itu supaya "konsistensi"
     * tidak dijadikan alasan menyeretnya masuk kelak.
     */
    expect(RUTE).toContain("await catatLogFaktur(db, {");
  });
});

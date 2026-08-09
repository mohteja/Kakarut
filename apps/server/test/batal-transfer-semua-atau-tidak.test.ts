import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * PEMBATALAN TRANSFER: SEMUA BARIS ATAU TIDAK SAMA SEKALI.
 *
 * `POST /transfer-stok/:fakturId/batal` memeriksa bahwa SELURUH barisnya masih
 * `menunggu`, lalu menghapusnya lewat UPDATE bersyarat. Keduanya pernyataan
 * TERPISAH. Bila cabang tujuan menerima SEBAGIAN barisnya tepat di selanya,
 * UPDATE-nya hanya mencocokkan sisanya — dan karena penjaganya dulu cuma
 * `hapus.length === 0`, hasil `> 0` dilaporkan `ok`.
 *
 * Yang terjadi sebenarnya pembatalan SEBAGIAN: sebagian stok kembali ke asal,
 * sebagian sudah mendarat di tujuan, dan pengirim mengira transfernya batal
 * utuh. Tak ada galat, tak ada jejak — hanya `jumlah_baris` yang lebih kecil
 * dari yang ia kirim, dan tak ada yang membandingkannya.
 *
 * Jawabannya bukan rekaan: `terima-sebagian` di modul penerimaan menghadapi
 * persoalan yang IDENTIK dan menyelesaikannya dengan melempar 409 dari DALAM
 * transaksi supaya seluruhnya rollback. Uji ini mematok jalur transfer memakai
 * idiom yang sama, sebab dua jalur yang menghadapi bahaya sama sebaiknya tidak
 * berbeda jawaban.
 */
const AKAR = fileURLToPath(new URL("../../../", import.meta.url));
const SRC = readFileSync(AKAR + "apps/server/src/modules/transfer/routes.ts", "utf8");

/** Badan handler `/:fakturId/batal` saja. */
const BATAL = (() => {
  const i = SRC.indexOf('.post("/:fakturId/batal"');
  expect(i, "handler batal transfer tak ditemukan").toBeGreaterThan(0);
  return SRC.slice(i);
})();

describe("batal transfer: semua baris atau tidak sama sekali", () => {
  it("menuntut jumlah baris terhapus SAMA dengan yang diperiksa", () => {
    // Inti perbaikannya. `length === 0` saja meloloskan pembatalan sebagian.
    expect(
      /res\.length !== baris\.length/.test(BATAL),
      "penjaga masih memakai 'tak ada satu pun', bukan 'semuanya' — pembatalan sebagian lolos sebagai ok",
    ).toBe(true);
  });

  it("penolakannya dilempar dari DALAM transaksi supaya rollback", () => {
    /*
     * Melempar di luar transaksi akan meninggalkan sebagian baris terlanjur
     * terhapus — justru keadaan separuh yang hendak dicegah.
     */
    const iTx = BATAL.indexOf("db.transaction(");
    const iCek = BATAL.indexOf("res.length !== baris.length");
    expect(iTx, "transaksi tak ditemukan di jalur batal").toBeGreaterThan(0);
    expect(iCek, "penjaga jumlah tak ditemukan").toBeGreaterThan(0);
    expect(iTx < iCek, "penjaga dievaluasi di LUAR transaksi — rollback-nya tak terjadi").toBe(true);
  });

  it("UPDATE-nya tetap bersyarat status 'menunggu'", () => {
    // Penjaga jumlah hanya bermakna kalau UPDATE-nya sendiri masih menolak
    // baris yang statusnya sudah berpindah.
    expect(BATAL).toContain('eq(productions.status, "menunggu")');
    expect(BATAL).toMatch(/isNull\(productions\.deletedAt\)/);
  });

  it("pesannya sama dengan idiom yang sudah ada, bukan sebab baru", () => {
    // "muat ulang lalu coba lagi" sudah dipakai jalur ini dan `terima-sebagian`.
    expect(BATAL).toContain("muat ulang lalu coba lagi");
  });
});

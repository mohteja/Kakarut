import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * PERINTAH SINKRON DIKLAIM SEBELUM DIEKSEKUSI, BUKAN SESUDAH.
 *
 * `/sync` dulu memakai pola SELECT → eksekusi → INSERT `onConflictDoNothing`.
 * Yang dijaga hanya BARIS LEDGER-nya, bukan efek sampingnya: dua permintaan
 * ber-`client_ref` sama yang datang bersamaan sama-sama melihat ledger kosong,
 * sama-sama memanggil `createSale`, lalu yang kedua kalah di unique index dan
 * hasilnya dibuang diam-diam. Ledger tampak rapi satu baris; penjualannya dua.
 *
 * Jendelanya selebar SELURUH eksekusi, dan itu bukan teori: `/sync` menggilas
 * batch secara BERURUTAN, mobile mengirim sampai 100 perintah sekali jalan, dan
 * `receiveTimeout`-nya 30 detik. Antrean panjang sesudah lama offline adalah
 * kasus paling lambat SEKALIGUS kasus pemakaian utamanya — klien menyerah,
 * mundur sebentar, lalu mengirim ulang batch yang sama selagi server masih
 * menggilas yang pertama.
 *
 * Maka barisnya dipesan lebih dulu dalam SATU pernyataan atomik
 * (`INSERT … onConflictDoNothing().returning()`): yang menang mengeksekusi,
 * yang kalah tak pernah menyentuh eksekutornya.
 *
 * Balapannya sendiri butuh dua permintaan sungguhan, jadi yang dipatok di sini
 * URUTANNYA — satu-satunya sifat yang membuat klaim itu ada gunanya. Perilaku
 * ujung-ke-ujungnya dijaga verify-api.
 */
const AKAR = fileURLToPath(new URL("../../../", import.meta.url));
const SYNC = readFileSync(AKAR + "apps/server/src/modules/sync/routes.ts", "utf8");

/** Badan perulangan `for (const cmd of commands)` — tempat seluruh aturan ini hidup. */
const LOOP = (() => {
  const i = SYNC.indexOf("for (const cmd of commands) {");
  expect(i, "perulangan perintah sinkron tak ditemukan").toBeGreaterThan(0);
  return SYNC.slice(i);
})();

describe("sinkron: klaim atomik sebelum eksekusi", () => {
  it("klaim (INSERT) datang SEBELUM eksekutor dipanggil", () => {
    // Inti seluruh perbaikan, dan satu-satunya yang tak bisa disimpulkan dari
    // hasil akhir: kalau urutannya terbalik lagi, ledger tetap rapi dan
    // dobelnya tetap tak terlihat.
    const iKlaim = LOOP.indexOf(".onConflictDoNothing()");
    const iExec = LOOP.indexOf("EKSEKUTOR[cmd.tipe]");
    expect(iKlaim, "klaim atomik tak ditemukan di perulangan").toBeGreaterThan(0);
    expect(iExec, "pemanggilan eksekutor tak ditemukan").toBeGreaterThan(0);
    expect(
      iKlaim < iExec,
      "eksekutor dipanggil SEBELUM barisnya diklaim — jendela dobelnya terbuka lagi",
    ).toBe(true);
  });

  it("klaim memakai `.returning()` — menang/kalahnya harus terbaca", () => {
    // `onConflictDoNothing()` tanpa `returning()` sukses diam-diam baik saat
    // menang maupun kalah; tanpa hasilnya, pemanggil tak bisa membedakan.
    expect(LOOP).toMatch(/\.onConflictDoNothing\(\)\s*\.returning\(/);
    expect(LOOP).toContain("if (!klaim) {");
  });

  it("penutupan ledger memakai UPDATE, bukan INSERT kedua", () => {
    // Barisnya sudah ada sejak sebelum eksekusi. INSERT lagi di akhir berarti
    // pola lamanya kembali — dan hasilnya bisa dibuang diam-diam lagi.
    const iTutup = LOOP.indexOf("simpanStatus, kode: simpanKode");
    expect(iTutup, "penutupan ledger tak ditemukan").toBeGreaterThan(0);
    expect(LOOP.slice(iTutup - 400, iTutup)).toContain("db\n      .update(syncCommands)");
  });

  it("jalur cepat TIDAK memulangkan klaim yang masih berjalan sebagai hasil", () => {
    // `berjalan` bukan hasil. Memulangkannya sebagai `sudah_ada` akan membuat
    // klien mengira perintahnya selesai padahal masih dikerjakan — dan
    // menghapusnya dari antrean sebelum hasilnya pernah ada.
    expect(LOOP).toContain("if (ada && ada.status !== BERJALAN) {");
  });

  it("klaim yang kalah TIDAK ikut tercatat sebagai kegagalan", () => {
    /*
     * "Sedang diproses" bukan penolakan. Menyimpannya ke ledger akan membekukan
     * perintah yang justru sedang sukses: retry berikutnya membaca `gagal`
     * tersimpan dan tak pernah mencoba lagi. Karena itu jalurnya `continue`
     * SEBELUM blok penyimpanan mana pun.
     */
    const iSedang = LOOP.indexOf('sebab: "sedang_diproses"');
    expect(iSedang, "balasan sedang_diproses tak ditemukan").toBeGreaterThan(0);
    const sesudah = LOOP.slice(iSedang, iSedang + 260);
    expect(sesudah).toContain("continue;");
    expect(
      /db\s*\n?\s*\.(insert|update)\(syncCommands\)/.test(sesudah),
      "balasan sedang_diproses menyentuh ledger — ia harus lewat tanpa menulis apa pun",
    ).toBe(false);
  });

  it("klaim basi bisa diambil alih, dan ambil-alihnya sendiri atomik", () => {
    // Tanpa ambil-alih, satu proses yang mati di tengah membekukan perintahnya
    // SELAMANYA — obatnya jadi lebih buruk daripada penyakitnya. Tapi ambil-alih
    // harus lewat UPDATE bersyarat, supaya dua pengambil pun hanya satu lolos.
    expect(LOOP).toContain("eq(syncCommands.status, BERJALAN)");
    expect(LOOP).toMatch(/lt\(syncCommands\.createdAt,/);
    expect(LOOP).toContain("if (!rebut) {");
    // Ambang basinya harus JAUH lebih lama daripada satu batch terpanjang;
    // terlalu pendek justru mengembalikan dobel yang hendak dicegah.
    const m = /const KLAIM_BASI_MENIT = (\d+);/.exec(SYNC);
    expect(m, "ambang klaim basi tak ditemukan").not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(10);
  });
});

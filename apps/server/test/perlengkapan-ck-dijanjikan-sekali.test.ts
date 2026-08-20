/**
 * STOK CK PERLENGKAPAN HANYA BOLEH DIJANJIKAN SEKALI.
 *
 * Ledger perlengkapan baru bergerak SAAT DITERIMA: `terimaKirimanPerlengkapan`
 * menulis debit CK dan kredit cabang sekaligus. Selama barang di jalan, saldo
 * CK masih memuatnya utuh — dan pemeriksaan "stok CK cukup" membaca saldo itu
 * apa adanya. Terukur, CK berisi 10 pcs, dua permintaan BERURUTAN:
 *
 *   Toko A minta → KP-0026, 10 pcs   (saldo CK terbaca 10)
 *   Toko B minta → KP-0032, 10 pcs   (saldo CK MASIH terbaca 10)
 *   keduanya diterima → CK = −10, A = 10, B = 10
 *
 * PERILAKUNYA dijaga §202 verify-api lewat HTTP sungguhan — termasuk asersi
 * kekekalan (CK + A + B tetap 10) yang merah untuk setiap cara stok CK bocor,
 * bukan hanya cara yang kebetulan sudah terpikirkan.
 *
 * Yang tersisa di sini adalah BENTUKNYA, dan hanya yang tak bisa dilihat dari
 * luar: pemeriksaan yang benar tapi dikerjakan di luar transaksi tetap lolos
 * §202 (dua permintaan berurutan) sambil tetap salah untuk dua permintaan
 * bersamaan. Uji ini karena itu berupa source-pin — bentuk yang lemah, dan
 * dipakai justru karena bedanya tak punya bekas yang bisa diamati pada beban
 * uji satu-per-satu.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const baca = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const SERVICE = baca("../src/modules/perlengkapan/service.ts");
const STOK = baca("../src/modules/stok/service.ts");

/** Badan `buatKirimanPerlengkapan` saja — larangan di bawah tak boleh bocor ke fungsi lain. */
const BUAT = (() => {
  const i = SERVICE.indexOf("export async function buatKirimanPerlengkapan");
  expect(i, "buatKirimanPerlengkapan tak ditemukan").toBeGreaterThan(0);
  const j = SERVICE.indexOf("\nexport ", i + 10);
  return SERVICE.slice(i, j > 0 ? j : undefined);
})();

describe("keputusan kirim diambil DI DALAM transaksi, di belakang kunci", () => {
  it("kunci kirim diambil sebagai perintah pertama transaksinya", () => {
    // Saldo diturunkan dari ledger — tak ada baris stok yang bisa dikunci —
    // jadi tanpa kunci ini dua permintaan bersamaan sama-sama membaca saldo
    // lama dan sama-sama lolos, persis seperti kasus berurutan di atas.
    expect(BUAT).toMatch(/db\.transaction\(async \(tx\) => \{\s*await kunciKirimCabang\(tx,/);
  });

  it("saldo & barang-di-jalan dibaca dari `tx`, bukan dari `db`", () => {
    // Membacanya dari `db` menempatkan bacaannya DI LUAR kunci — benar untuk
    // percobaan berurutan, tetap salah untuk yang bersamaan.
    expect(BUAT).toMatch(/saldoSatuPerlengkapan\(params\.supplyId, ckId, tx\)/);
    expect(BUAT).toMatch(/qtyPerlengkapanDalamJalan\(tx,/);
  });

  it("yang dibandingkan saldo DIKURANGI yang masih di jalan", () => {
    expect(BUAT).toMatch(/const siapKirim = saldoCk - dalamJalan;/);
    expect(BUAT).toMatch(/if \(params\.qty > siapKirim\)/);
    // Bentuk lama: membandingkan saldo mentah. Dilarang di dalam fungsi ini saja.
    expect(BUAT).not.toMatch(/if \(params\.qty > saldoCk\)/);
  });

  it("penolakannya menyebut berapa yang di jalan — bukan angka yang membingungkan", () => {
    // "Stok CK tidak cukup (saldo CK 10)" pada CK yang saldonya memang 10
    // membaca seperti galat sistem, bukan seperti keterangan.
    expect(BUAT).toContain("sudah dikirim & menunggu diterima");
  });
});

describe("ruang kunci terpisah dari bahan baku", () => {
  it("bawaan `kunciKirimCabang` menghasilkan kunci yang PERSIS sama seperti dulu", () => {
    // Kalau bawaannya bergeser, seluruh pemanggil lama diam-diam pindah antrean
    // dan penjagaan bahan baku yang sudah dibayar mahal ikut lepas.
    expect(STOK).toMatch(/ruang = "kirim",/);
    expect(STOK).toMatch(/hashtext\(\$\{`\$\{ruang\}:\$\{companyId\}:\$\{branchId\}`\}\)/);
  });

  it("perlengkapan memakai ruangnya sendiri", () => {
    // Dua ledger yang tak pernah saling mengurangi; menaruhnya di kunci yang
    // sama hanya membuat kiriman perlengkapan menunggu kiriman bahan baku.
    expect(BUAT).toContain('"kirim-perlengkapan"');
  });
});

describe("permintaan yang ditolak tidak boleh lenyap", () => {
  const OTOMATIS = (() => {
    const i = SERVICE.indexOf("export async function permintaanOtomatisPerlengkapan");
    expect(i, "permintaanOtomatisPerlengkapan tak ditemukan").toBeGreaterThan(0);
    const j = SERVICE.indexOf("\nexport ", i + 10);
    return SERVICE.slice(i, j > 0 ? j : undefined);
  })();

  it("stok CK yang dipakai menghitung sudah dikurangi barang di jalan", () => {
    expect(OTOMATIS).toMatch(/const dalamJalanCk = dalamJalan\.get\(r\.id\) \?\? 0;/);
    expect(OTOMATIS).toMatch(/r\.saldo_ck \?\? 0\) - dalamJalanCk/);
  });

  it("dan diambil SEKALI di luar loop — bukan satu kueri per item", () => {
    expect(OTOMATIS).toMatch(/const dalamJalan = cab\.ckId\s*\?\s*await qtyPerlengkapanDalamJalan\(/);
  });

  it("penolakan menolkan `kirim` supaya kekurangannya jatuh ke faktur beli", () => {
    // Dulu `if (!("error" in hasil))` menelannya: cabang yang ditolak tak dapat
    // kiriman, tak dapat faktur beli, dan tak muncul di `tak_bisa_kirim` —
    // permintaannya lenyap tanpa satu pun jejak di layar.
    expect(OTOMATIS).toMatch(/if \("error" in hasil\) \{[\s\S]{0,900}kirim = 0;/);
    expect(OTOMATIS).toMatch(/const sisa = kekurangan - kirim;/);
  });
});

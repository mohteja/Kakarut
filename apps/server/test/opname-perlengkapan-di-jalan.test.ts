/**
 * OPNAME PERLENGKAPAN vs BARANG DI JALAN.
 *
 * Ledger perlengkapan baru bergerak SAAT DITERIMA. Barang yang sudah berangkat
 * karena itu sudah tidak ada di rak CK tapi masih utuh di ledgernya — dan
 * layar opname menyodorkan angka ledger itu sebagai "Sistem". Terukur, CK
 * berisi 10 pcs yang seluruhnya sudah dikirim:
 *
 *   petugas menghitung rak → 0 (memang kosong)
 *   opname di-ACC          → koreksi −10
 *   toko menekan Terima    → debit   −10
 *   CK = −10, Toko = 10, total = 0 dari 10 yang ada
 *
 * PERILAKUNYA dijaga §203 verify-api lewat HTTP sungguhan, termasuk kekekalan
 * (CK + Toko tetap 10) dan pasangan yang membedakan "membandingkan angka rak"
 * dari "mematikan opname".
 *
 * Yang tersisa di sini satu hal yang TAK BISA dilihat dari luar, dan justru
 * paling mudah lepas: server dan LAYAR harus membandingkan angka yang sama.
 * Kalau layar tetap menampilkan saldo buku sementara server membandingkan
 * angka rak, petugas melihat "Sistem 10" di depan rak kosong, mengetik 0, dan
 * layar menjanjikan koreksi −10 yang tak pernah terjadi — permintaan yang
 * dituruti setengah, bentuk yang lebih membingungkan daripada bug aslinya.
 * §203 tak bisa melihat layar; uji ini yang menjaganya.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const baca = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const SERVICE = baca("../src/modules/perlengkapan/service.ts");
const LAYAR = baca("../../web/src/pages/stok/OpnamePerlengkapanPage.tsx");

/** Badan `buatOpnamePerlengkapan` saja — larangan tak boleh bocor ke fungsi lain. */
const OPNAME = (() => {
  const i = SERVICE.indexOf("export async function buatOpnamePerlengkapan");
  expect(i, "buatOpnamePerlengkapan tak ditemukan").toBeGreaterThan(0);
  const j = SERVICE.indexOf("\nexport ", i + 10);
  return SERVICE.slice(i, j > 0 ? j : undefined);
})();

describe("server membandingkan angka RAK, bukan angka buku", () => {
  it("barang di jalan diambil sekali untuk seluruh item sesi", () => {
    expect(OPNAME).toMatch(/const dalamJalan = await qtyPerlengkapanDalamJalan\(tx,/);
  });

  it("pembandingnya saldo DIKURANGI yang di jalan", () => {
    expect(OPNAME).toMatch(/const diRak = saldo - \(dalamJalan\.get\(it\.supply_id\) \?\? 0\);/);
    expect(OPNAME).toMatch(/const selisih = it\.qty_fisik - diRak;/);
    // Bentuk lama, dilarang di dalam fungsi ini saja.
    expect(OPNAME).not.toMatch(/const selisih = it\.qty_fisik - saldo;/);
  });

  it("arsip opname merekam angka pembanding itu, bukan ledger mentah", () => {
    // `systemQty` yang menyimpan ledger mentah membuat riwayat opname
    // menceritakan perbandingan yang tak pernah terjadi.
    expect(OPNAME).toMatch(/systemQty: diRak,/);
    expect(OPNAME).not.toMatch(/systemQty: saldo,/);
  });

  it("dan angkanya memang tersedia di DTO yang dibaca layar", () => {
    expect(SERVICE).toMatch(/dalam_jalan: dalamJalan\.get\(r\.id\) \?\? 0,/);
  });
});

describe("layar menampilkan angka yang SAMA dengan yang dibandingkan server", () => {
  it("layar punya satu tempat yang menghitungnya", () => {
    expect(LAYAR).toMatch(/function diRak\(r: PerlengkapanRowDto\): number \{\s*return r\.saldo - r\.dalam_jalan;/);
  });

  it("selisih di layar dihitung dari angka rak", () => {
    expect(LAYAR).toMatch(/return angkaDari\(v\) - diRak\(r\);/);
    expect(LAYAR).not.toMatch(/return angkaDari\(v\) - r\.saldo;/);
  });

  it("tombol \"= sistem\" mengisi angka rak, bukan saldo buku", () => {
    // Tombol yang mengisi saldo buku akan MEMBUAT selisih palsu sendiri —
    // petugas menekannya untuk bilang "sesuai", lalu justru menaikkan stok.
    expect(LAYAR).toMatch(/teksAngka\(diRak\(r\)\)/);
    expect(LAYAR).not.toMatch(/teksAngka\(r\.saldo\)/);
  });

  it("dan barang di jalan disebutkan, bukan disembunyikan", () => {
    // Angka "Sistem" yang lebih kecil dari saldo tanpa keterangan akan terbaca
    // sebagai stok yang hilang. Sebabnya harus ada di layar yang sama.
    expect(LAYAR).toContain("di jalan (tak ikut dihitung)");
    expect(LAYAR).toMatch(/r\.dalam_jalan > 0 &&/);
  });
});

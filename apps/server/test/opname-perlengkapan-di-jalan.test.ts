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
  it("pembandingnya diambil dari `saldoDiRakPerlengkapan`, sekali untuk seluruh sesi", () => {
    expect(OPNAME).toMatch(/const rak = await saldoDiRakPerlengkapan\(tx,/);
    expect(OPNAME).toMatch(/const selisih = it\.qty_fisik - diRak;/);
    // Bentuk lama, dilarang di dalam fungsi ini saja.
    expect(OPNAME).not.toMatch(/const selisih = it\.qty_fisik - saldo;/);
  });

  it("dan helper itu memang mengurangi barang di jalan", () => {
    const fn = SERVICE.slice(SERVICE.indexOf("export async function saldoDiRakPerlengkapan"));
    expect(fn).toMatch(/await qtyPerlengkapanDalamJalan\(exec, companyId, branchId, supplyIds\)/);
    expect(fn).toMatch(/peta\.set\(id, -\(dalamJalan\.get\(id\) \?\? 0\)\)/);
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

  it("KETIGA pintu memakai helper yang sama — bukan tiga salinan aritmetika", () => {
    /*
     * Inilah sifat yang sebenarnya dijaga. Tiga endpoint menanyakan hal yang
     * sama kepada orang yang sama di halaman yang sama, dan ketiganya dulu
     * salah dengan cara yang identik:
     *
     *   POST /perlengkapan/opname        → CK −10, total 0 dari 10
     *   POST /perlengkapan/stok-awal     → CK −10, total 0 dari 10
     *   POST /perlengkapan/:id/koreksi   → CK −10, total 0 dari 10
     *
     * Menambalnya satu per satu hanya menunda pintu keempat. Yang dipatok di
     * sini: tak satu pun dari mereka menghitung pengurangannya sendiri.
     */
    const RUTE = baca("../src/modules/perlengkapan/routes.ts");
    const pintu = [
      RUTE.slice(RUTE.indexOf('"/stok-awal"'), RUTE.indexOf('"/opname"')),
      RUTE.slice(RUTE.indexOf('"/:id/koreksi"'), RUTE.indexOf('"/:id/koreksi"') + 1800),
      OPNAME,
    ];
    for (const blok of pintu) {
      expect(blok.length, "blok pintu tak ditemukan").toBeGreaterThan(100);
      expect(blok).toMatch(/saldoDiRakPerlengkapan\(/);
      // Tak ada yang boleh mengurangi sendiri — itu salinan keempat aturannya.
      expect(blok).not.toMatch(/dalamJalan\.get\(/);
    }
  });
});

describe("layar menampilkan angka yang SAMA dengan yang dibandingkan server", () => {
  /*
   * Bentuk uji ini BERUBAH, dan sebabnya layak dicatat.
   *
   * Versi sebelumnya memakukan dua ekspresi terpisah — `r.saldo - r.dalam_jalan`
   * di satu berkas dan `diRak(r)` di berkas lain — yang justru BUKTI bahwa
   * aturannya disalin. Sisi server sudah dipusatkan jadi
   * `saldoDiRakPerlengkapan`, tapi dua salinan sebaris tertinggal di klien, di
   * perubahan yang justru berargumen menentang penyalinan itu.
   *
   * Sekarang keduanya lewat `saldoDiRak` dari @kakarut/shared, dan yang dipatok
   * adalah SIFATNYA: tak satu pun layar boleh menghitung pengurangannya
   * sendiri. Salinan ketiga akan merah sebelum lahir.
   */
  const LAYAR_PERLENGKAPAN = [
    ["OpnamePerlengkapanPage", LAYAR],
    ["StokPerlengkapanTab", baca("../../web/src/pages/stok/StokPerlengkapanTab.tsx")],
  ] as const;

  it("tak satu pun layar menghitung `saldo - dalam_jalan` sendiri", () => {
    for (const [nama, isi] of LAYAR_PERLENGKAPAN) {
      expect(isi, nama).toMatch(/saldoDiRak\(/);
      expect(isi, nama).not.toMatch(/\.saldo\s*-\s*\w*\.?dalam_jalan/);
    }
  });

  it("dan keduanya mengambilnya dari rumah yang sama", () => {
    for (const [nama, isi] of LAYAR_PERLENGKAPAN) {
      expect(isi, nama).toMatch(/import \{[^}]*saldoDiRak[^}]*\} from "@kakarut\/shared"/);
    }
  });

  it("helper bersamanya memang mengurangi barang di jalan", () => {
    const H = baca("../../../packages/shared/src/perlengkapan-rak.ts");
    expect(H).toMatch(/return r\.saldo - r\.dalam_jalan;/);
    expect(H).toMatch(/export function adaDiJalan/);
  });

  it("selisih di layar opname dihitung dari angka rak", () => {
    expect(LAYAR).toMatch(/return angkaDari\(v\) - saldoDiRak\(r\);/);
    expect(LAYAR).not.toMatch(/return angkaDari\(v\) - r\.saldo;/);
  });

  it("tombol \"= sistem\" mengisi angka rak, bukan saldo buku", () => {
    // Tombol yang mengisi saldo buku akan MEMBUAT selisih palsu sendiri —
    // petugas menekannya untuk bilang "sesuai", lalu justru menaikkan stok.
    expect(LAYAR).toMatch(/teksAngka\(saldoDiRak\(r\)\)/);
    expect(LAYAR).not.toMatch(/teksAngka\(r\.saldo\)/);
  });

  it("dan barang di jalan disebutkan, bukan disembunyikan", () => {
    // Angka "Sistem" yang lebih kecil dari saldo tanpa keterangan akan terbaca
    // sebagai stok yang hilang. Sebabnya harus ada di layar yang sama.
    expect(LAYAR).toContain("di jalan (tak ikut dihitung)");
    for (const [nama, isi] of LAYAR_PERLENGKAPAN) {
      expect(isi, nama).toMatch(/adaDiJalan\(r\)/);
    }
  });
});

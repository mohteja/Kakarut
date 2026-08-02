import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hppSatuanBaru } from "../src/modules/penjualan/rekalkulasi";

/**
 * Penjaga HARGA POKOK HISTORIS pada hitung-ulang biaya penjualan.
 *
 * `sales.total_hpp` bukan taksiran hari ini — `GET /laporan` menjumlahnya apa
 * adanya sebagai harga pokok penjualan periode itu. Sementara harga bahan
 * BERGERAK SENDIRI: Laporan Harga menyetel `ingredients.harga_beli` ke median
 * riwayat pembelian tiap kali belanja dilaporkan.
 *
 * Cacatnya: hitung-ulang memakai katalog HARI INI untuk setiap baris, dan
 * `refundSajian` memanggilnya pada tiap refund. Merefund satu porsi dari
 * transaksi bulan lalu menulis ulang HPP SELURUH transaksi itu dengan harga
 * bulan ini — laba-rugi bulan lalu berubah tanpa ada yang menyentuhnya.
 * Transaksi yang tak pernah direfund tetap beku pada harga jualnya, jadi satu
 * laporan berisi dua dasar harga sekaligus.
 *
 * Angka di bawah sengaja dibuat DRIFT: biaya historis tak pernah sama dengan
 * biaya hari ini. Tanpa itu, menanam ulang cacatnya menghasilkan angka yang
 * kebetulan sama dan seluruh berkas ini lolos tanpa menjaga apa pun.
 */

/** Biaya satu porsi saat transaksi terjadi (harga bahan waktu itu). */
const HISTORIS = 8000;
/** Biaya satu porsi pada basis DINE-IN, harga hari ini — sudah naik. */
const DINEIN_KINI = 9000;
/** Basis BAWA PULANG hari ini = dine-in + kemasan (kemasan hari ini 1.500). */
const TA_KINI = 10500;

describe("harga pokok per porsi sesudah hitung-ulang", () => {
  it("baris yang tak disentuh: angkanya TIDAK bergerak", () => {
    // Inti temuannya. Refund tak mengubah penyajian baris mana pun, jadi
    // seluruh barisnya lewat sini — dan semuanya harus tetap historis.
    expect(
      hppSatuanBaru({
        hppLama: HISTORIS,
        basisBerubah: false,
        hppBasisBaru: DINEIN_KINI,
        hppBasisLama: TA_KINI,
      }),
    ).toBe(HISTORIS);
  });

  it("dine-in → bawa pulang: historis + kemasan hari ini, bukan harga hari ini", () => {
    // Harga kemasan lama tak tersimpan di mana pun, jadi selisihnya memakai
    // harga hari ini — tapi TINGKAT historisnya tetap utuh.
    expect(
      hppSatuanBaru({
        hppLama: HISTORIS,
        basisBerubah: true,
        hppBasisBaru: TA_KINI,
        hppBasisLama: DINEIN_KINI,
      }),
    ).toBe(HISTORIS + (TA_KINI - DINEIN_KINI));
  });

  it("bawa pulang → dine-in: kemasan hari ini dilepas dari angka historis", () => {
    expect(
      hppSatuanBaru({
        hppLama: HISTORIS,
        basisBerubah: true,
        hppBasisBaru: DINEIN_KINI,
        hppBasisLama: TA_KINI,
      }),
    ).toBe(HISTORIS - (TA_KINI - DINEIN_KINI));
  });

  it("bolak-balik TA → dine-in → TA kembali PERSIS ke angka semula", () => {
    const ke = (lama: number, baru: number, dari: number) =>
      hppSatuanBaru({
        hppLama: lama,
        basisBerubah: true,
        hppBasisBaru: baru,
        hppBasisLama: dari,
      });
    const ta = ke(HISTORIS, TA_KINI, DINEIN_KINI);
    const balik = ke(ta, DINEIN_KINI, TA_KINI);
    const lagi = ke(balik, TA_KINI, DINEIN_KINI);
    expect(balik).toBe(HISTORIS);
    expect(lagi).toBe(ta);
  });

  it("menekan tombol yang sama dua kali: selisih nol, angka tetap", () => {
    // Endpoint `/sajian` menyetel penandanya tanpa memeriksa nilai lamanya,
    // jadi baris yang sudah TA bisa ditandai TA lagi. Itu bukan perubahan.
    expect(
      hppSatuanBaru({
        hppLama: HISTORIS,
        basisBerubah: true,
        hppBasisBaru: TA_KINI,
        hppBasisLama: TA_KINI,
      }),
    ).toBe(HISTORIS);
  });

  it("tak pernah negatif — biaya minus akan jadi 'laba' palsu di laporan", () => {
    expect(
      hppSatuanBaru({
        hppLama: 500,
        basisBerubah: true,
        hppBasisBaru: 2000,
        hppBasisLama: 9000,
      }),
    ).toBe(0);
  });
});

/**
 * Aturannya harus TERPASANG, bukan sekadar ada.
 *
 * Pelajaran yang sama dengan `pg-galat.test.ts`: fungsi yang benar tapi tak
 * dipanggil menjaga persis nol hal. Di sini lebih halus lagi — ketiga pemanggil
 * harus menyebutkan baris MANA yang berubah, dan pemanggil yang salah menyebut
 * `"semua"` akan menulis ulang seluruh pembukuan tepat seperti cacat aslinya.
 */
describe("hitung-ulang & pemanggilnya menyebut basis yang berubah", () => {
  const baca = (rel: string) =>
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
  const rekalkulasi = baca("../src/modules/penjualan/rekalkulasi.ts");
  const refund = baca("../src/modules/penjualan/refund.ts");
  const pesanan = baca("../src/modules/pesanan/routes.ts");

  it("rekalkulasi memakai hppSatuanBaru, bukan harga hari ini langsung", () => {
    expect(rekalkulasi).toMatch(/hppSatuan = hppSatuanBaru\(\{/);
    expect(rekalkulasi).toMatch(/hppLama: b\.hppSatuan/);
    expect(rekalkulasi).toMatch(
      /basisBerubah: basisBerubah === "semua" \|\| basisBerubah\.has\(b\.id\)/,
    );
  });

  it("refund menyatakan TIDAK ada penyajian yang berubah", () => {
    expect(refund).toMatch(
      /hitungUlangBiayaPenjualan\([^)]*TANPA_UBAH_BASIS\s*\)/,
    );
    expect(refund).not.toMatch(/hitungUlangBiayaPenjualan\([^)]*"semua"/);
  });

  it("papan pesanan menyebut baris yang ditandai — satu baris atau semua", () => {
    expect(pesanan).toMatch(
      /hitungUlangBiayaPenjualan\(tx, id, auth\.company_id!, new Set\(\[itemId\]\)\)/,
    );
    expect(pesanan).toMatch(
      /hitungUlangBiayaPenjualan\(tx, id, auth\.company_id!, "semua"\)/,
    );
  });
});

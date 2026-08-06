import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hitungPb1, tarifPb1Struk } from "@kakarut/shared";

/**
 * PERSEN PB1 DI ATAS KERTAS HARUS MENGHASILKAN NOMINAL DI SEBELAHNYA.
 *
 * Struk thermal mencetak `PB1 10%` berdampingan dengan rupiahnya
 * (`packages/shared/src/receipt.ts`). Persennya dulu diambil dari setelan
 * perusahaan HARI INI — dan penjualan tak pernah menyimpan tarifnya sendiri
 * (tak seperti diskon, yang `diskon_persen`-nya ikut tersimpan). Selama tarif
 * tak pernah diubah, keduanya cocok karena KEBETULAN.
 *
 * Dua jalan membuatnya meleset, keduanya lewat tombol yang memang ada:
 *
 *   1. Owner mengubah tarif 10% → 11% di Pengaturan Perusahaan, lalu struk
 *      lama dicetak ulang dari Riwayat Transaksi (`RiwayatPage` → ReceiptModal
 *      → "Cetak Thermal"). Kertasnya menulis "PB1 11%" di sebelah angka yang
 *      10% dari netnya.
 *   2. Refund sebagian: PB1-nya diprorata dari PB1 asal, jadi tak harus sama
 *      dengan hasil tarif mana pun.
 *
 * Layarnya tak pernah kena — struk di layar memang tak menampilkan persen PB1
 * sama sekali. Yang salah hanya kertas yang dibawa pulang tamu, dan tak ada
 * seorang pun di toko yang melihatnya.
 *
 * Aturannya sekarang: persen hanya dicetak bila TERBUKTI menghasilkan
 * nominalnya. Tidak terbukti → `null` → "PB1" tanpa persen.
 */
const AKAR = fileURLToPath(new URL("../../../", import.meta.url));
const STRUK = readFileSync(AKAR + "apps/web/src/pages/kasir/ReceiptModal.tsx", "utf8");
const CETAK = readFileSync(AKAR + "packages/shared/src/receipt.ts", "utf8");

describe("tarif yang dicetak selalu menghasilkan nominal yang dicetak", () => {
  it("pulang-pergi untuk nilai & tarif yang wajar di F&B", () => {
    // Sapuan, bukan satu contoh: yang dijaga adalah SIFATNYA — apa pun yang
    // dikembalikan harus memproduksi ulang nominalnya.
    for (const net of [10_000, 12_345, 33_333, 47_500, 99_999, 1_000_000]) {
      for (const rate of [5, 7.5, 10, 11, 12.5]) {
        const pb1 = hitungPb1(net, rate);
        const tarif = tarifPb1Struk(net, 0, pb1);
        expect(tarif, `net=${net} rate=${rate} pb1=${pb1}`).not.toBeNull();
        expect(hitungPb1(net, tarif!), `net=${net} rate=${rate}`).toBe(pb1);
      }
    }
  });

  it("dan untuk nilai wajar itu tarifnya memang tarif yang disetel owner", () => {
    // Sekadar "menghasilkan nominal yang sama" belum cukup: tamu membandingkan
    // persennya dengan papan harga & struk sebelumnya.
    expect(tarifPb1Struk(100_000, 0, hitungPb1(100_000, 10))).toBe(10);
    expect(tarifPb1Struk(47_500, 0, hitungPb1(47_500, 7.5))).toBe(7.5);
    expect(tarifPb1Struk(33_333, 0, hitungPb1(33_333, 10))).toBe(10);
  });

  it("diskon ikut dipotong dulu — PB1 dihitung atas NET, bukan subtotal", () => {
    // Kalau netnya salah, tarifnya ikut salah dan tetap "terbukti" terhadap
    // pembagi yang keliru. Diskon 20.000 dari 100.000 → net 80.000.
    const pb1 = hitungPb1(80_000, 10); // 8.000
    expect(tarifPb1Struk(100_000, 20_000, pb1)).toBe(10);
    // Tanpa memotong diskon: 8.000/100.000 = 8% — angka yang tak pernah ada.
    expect(tarifPb1Struk(100_000, 0, pb1)).toBe(8);
  });

  it("memilih tarif TERSEDERHANA saat pembulatan menyisakan banyak jawaban", () => {
    // net 1.234 dengan tarif 10% → PB1 123. Pembagian balik memberi 9,9675%,
    // dan 9,97% memang menghasilkan 123 juga — tapi yang disetel owner 10%.
    const pb1 = hitungPb1(1_234, 10);
    expect(pb1).toBe(123);
    expect(hitungPb1(1_234, 9.97), "9,97% juga menghasilkan 123").toBe(123);
    expect(tarifPb1Struk(1_234, 0, pb1)).toBe(10);
  });
});

describe("menolak menebak — yang tak terbukti tak dicetak", () => {
  it("nominal yang tak bisa dihasilkan tarif mana pun → null", () => {
    // Di net besar, dua tarif 2-desimal berdekatan berselisih lebih dari satu
    // rupiah (100.000 × 0,01% = 10), jadi ada nominal yang TIDAK bisa dicapai
    // tarif mana pun. Ke situlah hasil prorata refund bisa mendarat.
    const net = 100_000;
    const takTerjelaskan = [10_001, 10_003, 10_005, 10_007, 10_009].filter(
      (n) => tarifPb1Struk(net, 0, n) === null,
    );
    // Polaritasnya penting: kalau ternyata SEMUA nominal bisa dijelaskan,
    // cabang `null` tak pernah terjadi dan uji ini tak menjaga apa pun.
    expect(
      takTerjelaskan,
      "tak satu pun nominal tak terjelaskan — cabang null tak teruji",
    ).not.toHaveLength(0);
    // Dan yang memang tak terjelaskan tetap tak terjelaskan setelah diskon.
    expect(tarifPb1Struk(120_000, 20_000, 10_005)).toBeNull();
  });

  it("tarif di luar yang bisa disetel perusahaan tak dianggap jawaban", () => {
    // Batasnya [0, 100] — itu yang dijepit form Pengaturan Perusahaan. Nominal
    // yang hanya bisa dijelaskan oleh tarif di atas 100% berarti TAK ADA
    // penjelasannya.
    expect(hitungPb1(1_000, 100), "100% masih sah").toBe(1_000);
    expect(tarifPb1Struk(1_000, 0, 1_000)).toBe(100);
    expect(tarifPb1Struk(1_000, 0, 1_500), "150% mustahil disetel").toBeNull();

    // BATAS JUJUR: pada net yang sangat kecil, banyak tarif waras menghasilkan
    // nominal yang sama, dan yang terpilih belum tentu yang disetel owner —
    // Rp 2 dari net Rp 3 memang 67%. Ini tak bisa diperbaiki dari sini
    // (tarifnya tak pernah disimpan), dan tak terjangkau di lapangan: harga
    // menu termurah pun ribuan rupiah. Dipatok supaya jadi keputusan, bukan
    // kejutan.
    expect(tarifPb1Struk(3, 0, 2)).toBe(67);
  });

  it("net nol / negatif / PB1 nol → null, tanpa membagi nol", () => {
    expect(tarifPb1Struk(0, 0, 0)).toBeNull();
    expect(tarifPb1Struk(50_000, 50_000, 5_000)).toBeNull(); // net 0
    expect(tarifPb1Struk(50_000, 60_000, 5_000)).toBeNull(); // net negatif
    expect(tarifPb1Struk(100_000, 0, 0)).toBeNull();
    // Seluruh sajian direfund → semuanya nol; struk cetak ulang tetap terbuka.
    expect(tarifPb1Struk(0, 0, 5_000)).toBeNull();
  });
});

describe("struk memakainya, dan `null` benar-benar berarti tanpa persen", () => {
  it("ReceiptModal menurunkan tarif dari penjualannya sendiri", () => {
    expect(STRUK).toContain(
      "pb1Rate: tarifPb1Struk(data.sale.subtotal, data.sale.diskon, data.sale.pb1Amount)",
    );
    expect(STRUK).toContain('import { qtyDitagih, tarifPb1Struk } from "@kakarut/shared";');
  });

  it("dan TIDAK lagi mengambilnya dari setelan perusahaan hari ini", () => {
    // Inti perbaikannya. Tanpa patokan ini, menambahkan `?? company.pb1Rate`
    // sebagai "cadangan" akan mengembalikan bug-nya utuh — cadangan itu justru
    // yang paling sering dipakai, karena `null` memang keluar saat tarifnya
    // sudah berubah.
    expect(STRUK).not.toContain("company?.pb1Rate");
    expect(STRUK).not.toContain("company.pb1Rate");
  });

  it("pencetak ESC/POS memang menyembunyikan persen saat tarifnya null", () => {
    // Kalau baris ini berubah jadi tanpa syarat, `null` akan tercetak sebagai
    // "PB1 null%" — dan semua uji di atas jadi tak ada artinya.
    expect(CETAK).toContain("`PB1${data.pb1Rate ? ` ${data.pb1Rate}%` : \"\"}`");
  });
});

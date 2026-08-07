import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { rataPerPorsi } from "../src/lib/bep";

/**
 * BEP HARUS MENGHITUNG MARGIN SESUDAH DISKON.
 *
 * "Berapa porsi supaya biaya tetap tertutup?" = `biaya_tetap ÷ margin per
 * porsi`. Marginnya dulu disusun dari omzet KOTOR baris nota
 * (`harga_satuan × porsi`), sementara potongan yang benar-benar diberikan kasir
 * hidup di tingkat NOTA (`sales.diskon`) dan tak pernah ikut.
 *
 * Arah salahnya yang berbahaya: margin tampak lebih besar → BEP menjawab lebih
 * KECIL. Layar yang tugasnya menjawab "berapa supaya tidak rugi" justru jadi
 * yang paling optimistis, dan owner menutup hari merasa sudah aman padahal
 * belum. Diskon 10% pada margin 40% menggeser kebutuhan porsi seperempatnya.
 *
 * Sekaligus dua layar berhenti berselisih: `GET /laporan` sudah memakai
 * `omzet − diskon − HPP` untuk `estimasi_profit`; BEP kini memakai rumus yang
 * sama, dibagi porsi.
 */
const AKAR = fileURLToPath(new URL("../../../", import.meta.url));
const baca = (p: string) => readFileSync(AKAR + p, "utf8");

describe("rataPerPorsi: diskon ikut, PB1 tidak", () => {
  it("tanpa diskon: margin = (omzet − HPP) ÷ porsi", () => {
    // Jangkar: pada nota tanpa potongan, hasilnya harus sama persis dengan
    // rumus lama — perbaikan ini tidak boleh menggeser yang sudah benar.
    expect(rataPerPorsi({ subtotal: 200_000, diskon: 0, hpp: 120_000, qty: 10 })).toEqual({
      harga: 20_000,
      margin: 8_000,
    });
  });

  it("DENGAN diskon: potongannya benar-benar mengurangi margin", () => {
    // 200.000 − 20.000 = 180.000 bersih; margin (180.000 − 120.000) ÷ 10.
    const r = rataPerPorsi({ subtotal: 200_000, diskon: 20_000, hpp: 120_000, qty: 10 })!;
    expect(r).toEqual({ harga: 18_000, margin: 6_000 });
    // Dan angkanya HARUS lebih kecil daripada versi kotor — kalau tidak,
    // diskonnya tak berpengaruh dan uji di atas lulus karena kebetulan.
    const kotor = rataPerPorsi({ subtotal: 200_000, diskon: 0, hpp: 120_000, qty: 10 })!;
    expect(r.margin).toBeLessThan(kotor.margin);
    expect(r.harga).toBeLessThan(kotor.harga);
  });

  it("BEP-nya sendiri jadi lebih BESAR, bukan lebih kecil", () => {
    // Inti akibatnya, dinyatakan dalam satuan yang dibaca owner: porsi.
    const biayaTetap = 30_000_000;
    const porsi = (m: number) => Math.ceil(biayaTetap / m);
    const kotor = rataPerPorsi({ subtotal: 200_000, diskon: 0, hpp: 120_000, qty: 10 })!;
    const bersih = rataPerPorsi({ subtotal: 200_000, diskon: 20_000, hpp: 120_000, qty: 10 })!;
    expect(porsi(kotor.margin)).toBe(3_750);
    expect(porsi(bersih.margin)).toBe(5_000);
    expect(porsi(bersih.margin)).toBeGreaterThan(porsi(kotor.margin));
  });

  it("diskon menghabiskan seluruh margin → margin negatif, bukan disembunyikan", () => {
    // Rute memang menolak margin ≤ 0 dengan 400; yang penting fungsinya JUJUR
    // melaporkan negatif, bukan menjepitnya ke nol dan melahirkan BEP palsu.
    const r = rataPerPorsi({ subtotal: 200_000, diskon: 100_000, hpp: 120_000, qty: 10 })!;
    expect(r.margin).toBeLessThan(0);
  });

  it("porsi nol → null (bukan Infinity/NaN), supaya basis katalog dipakai", () => {
    expect(rataPerPorsi({ subtotal: 0, diskon: 0, hpp: 0, qty: 0 })).toBeNull();
    // Rentang tanpa penjualan tapi ADA uang tersisa dari filter lain tetap null:
    // penyebutnya yang menentukan, bukan pembilangnya.
    expect(rataPerPorsi({ subtotal: 500_000, diskon: 0, hpp: 100_000, qty: 0 })).toBeNull();
    expect(rataPerPorsi({ subtotal: 100, diskon: 0, hpp: 0, qty: -3 })).toBeNull();
  });
});

describe("BEP & Laporan memakai definisi laba yang SAMA", () => {
  const LAPORAN = baca("apps/server/src/modules/laporan/routes.ts");

  it("rute /bep benar-benar memanggil rataPerPorsi", () => {
    // Tanpa ini, fungsi di atas bisa saja benar sendirian sementara rutenya
    // masih menghitung caranya yang lama.
    const mulai = LAPORAN.indexOf('.get("/bep"');
    expect(mulai, "penangan /laporan/bep tak ditemukan").toBeGreaterThan(0);
    const BEP = LAPORAN.slice(mulai);
    expect(BEP).toContain("rataPerPorsi({");
    expect(BEP).toContain("diskon: Number(uang?.diskon ?? 0)");
  });

  it("/bep tidak lagi menyusun margin dari omzet KOTOR baris", () => {
    // `omzetDitagihSql` sah dipakai `/laporan` untuk rincian per menu, tapi di
    // dalam blok BEP ia berarti margin kembali mengabaikan diskon.
    const BEP = LAPORAN.slice(LAPORAN.indexOf('.get("/bep"'));
    expect(
      BEP.includes("omzetDitagihSql"),
      "BEP memakai omzet kotor baris lagi — diskon nota akan hilang dari margin",
    ).toBe(false);
  });

  it("`estimasi_profit` di /laporan tetap omzet − diskon − HPP", () => {
    // Patokan arah-balik: kalau SUATU saat `/laporan` yang berubah, kesepakatan
    // dua layar ini putus dari sisi seberang — dan uji ini yang merah lebih
    // dulu, bukan angkanya yang diam-diam berselisih.
    expect(LAPORAN).toContain("estimasi_profit: omzet - totalDiskon - totalHpp");
  });
});

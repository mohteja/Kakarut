import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * AUDIT INVARIAN HARUS BENAR-BENAR BERJALAN, DAN BERJALAN DI TEMPAT YANG TEPAT.
 *
 * Basis data ini punya **delapan** `CHECK` untuk **59 tabel** — terhitung dari
 * katalog Postgres. Selebihnya invarian hidup di kode: Zod di pintu, penjaga di
 * dalam transaksi, kunci baris saat dua orang menekan tombol yang sama.
 * Semuanya diuji satu per satu, tapi tak satu pun menjawab pertanyaan yang
 * sebenarnya — **adakah baris yang melanggarnya?**
 *
 * `audit:invarian` menanyakan itu ke datanya, dan CI menjalankannya SESUDAH
 * `verify-api.sh`. Urutan itu seluruh nilainya: pada basis data yang baru
 * di-seed, audit ini hijau tanpa menyatakan apa pun. Yang bermakna adalah
 * hijau SESUDAH 2.700+ asersi melewatinya lewat rute sungguhan — penjualan,
 * refund bertahap, transfer stok, opname, produksi, sinkron offline, dan
 * mengosongkan Tempat Sampah.
 *
 * Uji ini tak menjalankan auditnya (ia butuh basis data). Yang dijaga: skripnya
 * ada, invariannya tak menyusut diam-diam, dan langkah CI-nya masih terpasang
 * di urutan yang benar.
 */
const SKRIP = readFileSync(
  fileURLToPath(new URL("../src/scripts/audit-invarian.ts", import.meta.url)),
  "utf8",
);
const CI = readFileSync(fileURLToPath(new URL("../../../.github/workflows/ci.yml", import.meta.url)), "utf8");
const PKG = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"));

/** Jumlah invarian saat audit ini dipasang. Boleh naik; turun berarti ada yang dicabut. */
const DASAR = 26;

describe("audit invarian basis data terpasang & tak menyusut", () => {
  it("skripnya terdaftar sebagai npm script", () => {
    expect(PKG.scripts["audit:invarian"]).toContain("audit-invarian.ts");
  });

  it("CI menjalankannya SESUDAH verify-api, bukan sebelum", () => {
    const iVerify = CI.indexOf("bash scripts/verify-api.sh\n");
    const iAudit = CI.indexOf("audit:invarian -w @kakarut/server");
    expect(iVerify, "langkah verify-api hilang dari CI").toBeGreaterThan(0);
    expect(iAudit, "langkah audit invarian hilang dari CI").toBeGreaterThan(0);
    expect(
      iAudit,
      "audit invarian harus berjalan SESUDAH verify-api — pada basis data " +
        "yang baru di-seed ia hijau tanpa menyatakan apa pun",
    ).toBeGreaterThan(iVerify);
  });

  it("jumlah invarian tak menyusut", () => {
    const n = (SKRIP.match(/^\s*\{\s*$|^\s*\{ nama:/gm) ?? []).length;
    const namaCount = (SKRIP.match(/nama:\s*"/g) ?? []).length;
    expect(
      namaCount,
      `invarian berkurang (${namaCount} < ${DASAR}). Mencabut satu invarian ` +
        "berarti menyatakan ia tak lagi diandaikan kode — tulis alasannya, " +
        "jangan hanya menghapus barisnya",
    ).toBeGreaterThanOrEqual(DASAR);
    expect(n).toBeGreaterThan(0);
  });

  it("invarian yang paling tak bisa jadi CHECK biasa masih ada", () => {
    /*
     * Identitas uangnya menyilang empat kolom sekaligus, dan ia menahan SELURUH
     * jalur yang menulis angka penjualan — `createSale`, refund bertahap,
     * rekalkulasi HPP — dengan satu kalimat.
     *
     * Kecocokan tanda `qty` dengan `tipe` bergantung pada enum di kolom lain,
     * dan ia lahir dari kesalahanku sendiri: invarian pertamaku
     * `supply_mutations.qty >= 0` menuduh 58 baris yang justru BENAR, sebab
     * TANDA-nya yang membawa arah.
     */
    expect(SKRIP).toContain("total - (subtotal - diskon + pb1_amount)");
    expect(SKRIP).toContain("tipe IN ('masuk','terima') AND qty <= 0");
    expect(SKRIP).toContain("tipe IN ('pakai','auto','kirim') AND qty >= 0");
    expect(SKRIP).toContain("qty_refund > qty");
    expect(SKRIP).toContain("sale_id IS NOT NULL AND pernah_jadi_penjualan = false");
  });

  it("auditnya GAGAL (exit != 0) saat ada yang dilanggar", () => {
    // Audit yang cuma mencetak tak menahan apa pun di CI.
    expect(SKRIP, "audit tak pernah keluar dengan status gagal").toMatch(
      /if \(gagal > 0\) process\.exit\(1\)/,
    );
    expect(SKRIP, "hitungan pelanggarnya tak pernah dinaikkan").toMatch(/gagal \+= 1/);
  });

  it("catatan kenapa `CHECK` saja tak cukup masih tertulis", () => {
    // Kalau alasannya hilang, orang berikutnya wajar mengira audit ini
    // duplikat dari constraint dan membuangnya.
    expect(SKRIP).toContain("KENAPA BUKAN `CHECK` SAJA");
    expect(SKRIP).toContain("supply_mutations.qty >= 0");
  });
});

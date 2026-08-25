import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * FAKTA YANG DISIMPAN SEBAGAI PENUNJUK HILANG SAAT YANG DITUNJUK DIHAPUS.
 *
 * `open_bills.sale_id` adalah FK ber-`ON DELETE SET NULL`. Ia dipakai bukan
 * sebagai penunjuk melainkan sebagai BUKTI SEBUAH PERISTIWA — "bill ini sudah
 * jadi penjualan". Begitu penjualannya dihapus permanen, Postgres menihilkan
 * penunjuknya, dan buktinya ikut hilang.
 *
 * TERUKUR ujung ke ujung lewat HTTP, dan pemicunya tindakan pemilik yang biasa
 * saja — mengosongkan Tempat Sampah:
 *
 *     bill dibayar          → sale_id terisi,  closed_at terisi
 *     penjualan dihapus     → sampah dikosongkan
 *     → sale_id = NULL,       closed_at TETAP terisi
 *
 *     GET /pesanan   → bill yang SUDAH DIBAYAR muncul lagi sebagai kartu
 *                      pesanan aktif di layar kasir/dapur
 *     bayar ulang    → {"sebab":"bill_dibatalkan"}, bukan "bill_sudah_dibayar"
 *
 * Yang kedua bukan salah kata. Catatan di `penjualan/service.ts` menulis
 * sendiri bedanya: `bill_sudah_dibayar` berarti kiriman ulangnya kembar dan
 * aman dibuang dari antrean; `bill_dibatalkan` berarti "membuang perintahnya
 * berarti kehilangan satu transaksi sungguhan". Jadi klien offline MENAHAN
 * perintah yang tak akan pernah berhasil.
 *
 * Perbaikannya memisahkan FAKTA dari PENUNJUK: `pernah_jadi_penjualan`.
 *
 * BATAS UJI INI: ia menjaga dua pemakai yang SUDAH diketahui, bukan menyapu
 * seluruh kode mencari pemakaian FK-nullable sebagai bukti peristiwa. Sapuan
 * begitu butuh tahu mana FK yang `SET NULL` — dan itu ada di katalog basis
 * data, bukan di kode. Yang bisa dijaga statis: daftar 18 FK `SET NULL` di
 * `schema.ts` tak bertambah diam-diam.
 */
const SRC = fileURLToPath(new URL("../src", import.meta.url));
const SCHEMA = readFileSync(join(SRC, "db/schema.ts"), "utf8");
const SERVICE = readFileSync(join(SRC, "modules/penjualan/service.ts"), "utf8");
const PESANAN = readFileSync(join(SRC, "modules/pesanan/routes.ts"), "utf8");

function berkasTs(dir: string): string[] {
  const keluar: string[] = [];
  for (const nama of readdirSync(dir)) {
    const p = join(dir, nama);
    if (statSync(p).isDirectory()) keluar.push(...berkasTs(p));
    else if (nama.endsWith(".ts")) keluar.push(p);
  }
  return keluar;
}

describe("bukti peristiwa tak boleh disimpan sebagai FK yang bisa dinihilkan", () => {
  it("premis: `open_bills.sale_id` memang FK ber-ON DELETE SET NULL", () => {
    // Kalau kebijakannya kelak berubah, seluruh alasan berkas ini berubah juga
    // — dan ia harus ditinjau ulang, bukan dibiarkan menjaga hantu.
    expect(SCHEMA).toMatch(/saleId:\s*uuid\("sale_id"\)[\s\S]{0,160}onDelete:\s*"set null"/);
  });

  it("kolom faktanya ada, notNull, dan berdefault", () => {
    // `notNull().default(false)` penting: tanpa default, baris lama jadi NULL
    // dan `eq(..., false)` tak pernah cocok — bill lama hilang dari layar.
    expect(SCHEMA).toMatch(
      /pernahJadiPenjualan:\s*boolean\("pernah_jadi_penjualan"\)\.notNull\(\)\.default\(false\)/,
    );
  });

  it("migrasinya MENGISI ULANG baris lama", () => {
    /*
     * Tanpa isi ulang, penerapan migrasinya SENDIRI yang memicu cacatnya: tiap
     * bill yang sudah dibayar berdiri dengan `false` dan sejak itu terbaca
     * "dibatalkan". Pemicunya bukan lagi penghapusan penjualan, melainkan
     * deploy-nya.
     */
    const dir = fileURLToPath(new URL("../drizzle", import.meta.url));
    const isi = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .join("\n");
    expect(isi, "kolom faktanya tak pernah dibuat migrasi").toContain("pernah_jadi_penjualan");
    expect(isi, "baris lama tak diisi ulang dari sale_id").toMatch(
      /UPDATE "open_bills" SET "pernah_jadi_penjualan" = true WHERE "sale_id" IS NOT NULL/,
    );
  });

  it("createSale MENANDAI faktanya saat menutup bill", () => {
    expect(SERVICE, "penutupan bill tak menandai pernahJadiPenjualan").toMatch(
      /closedAt: new Date\(\),[\s\S]{0,400}pernahJadiPenjualan: true/,
    );
  });

  it("alasan 409 diturunkan dari FAKTA, bukan dari penunjuknya saja", () => {
    // `bill.saleId` sendirian pernah jadi satu-satunya sumbernya — dan itu yang
    // membuat bill dibayar terbaca dibatalkan.
    expect(SERVICE).toMatch(/bill\.pernahJadiPenjualan \|\| bill\.saleId/);
    expect(SERVICE, "kolomnya harus ikut dibaca dari basis data").toMatch(
      /pernahJadiPenjualan: openBills\.pernahJadiPenjualan/,
    );
  });

  it("layar pesanan menyaring dengan FAKTA-nya juga", () => {
    expect(PESANAN, "filter pesanan masih bersandar pada saleId saja").toMatch(
      /eq\(openBills\.pernahJadiPenjualan, false\)/,
    );
    // …dan `isNull(saleId)` DIPERTAHANKAN: bill yang baru saja dibayar pada
    // deploy lama belum tentu sudah bertanda. Dua syarat, bukan penggantian.
    expect(PESANAN).toMatch(/isNull\(openBills\.saleId\)/);
  });

  it("daftar FK `SET NULL` tak bertambah tanpa ditinjau", () => {
    /*
     * 18 FK `ON DELETE SET NULL` di seluruh schema, dan tiap satu adalah medan
     * yang bisa berubah jadi null tanpa kode mana pun memintanya. Yang baru
     * wajib ditimbang: apakah ada yang membaca medan itu sebagai BUKTI, bukan
     * sekadar sebagai tautan?
     */
    const jumlah = (SCHEMA.match(/onDelete:\s*"set null"/g) ?? []).length;
    expect(
      jumlah,
      "jumlah FK ON DELETE SET NULL berubah. Untuk yang baru: adakah kode yang " +
        "membacanya sebagai BUKTI sebuah peristiwa? Kalau ya, faktanya harus " +
        "disimpan terpisah — lihat `pernah_jadi_penjualan`",
    ).toBe(18);
  });

  it("PASANGAN: pemindainya membaca berkas yang benar & tak hijau karena kosong", () => {
    expect(SCHEMA.length).toBeGreaterThan(10_000);
    expect(berkasTs(SRC).length).toBeGreaterThan(50);
    expect(SERVICE).toContain("createSale");
    expect(PESANAN).toContain("openBills");
  });
});

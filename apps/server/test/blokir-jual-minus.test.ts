import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * SETELAN "TOLAK PESANAN MELEBIHI STOK" — YANG TAK BOLEH BERGESER.
 *
 * Diminta pemakainya sesudah keluhan stok minus. Perilakunya sendiri dipatok
 * verify-api §198 lewat HTTP sungguhan (19 asersi). Yang dijaga DI SINI adalah
 * tiga hal yang tak bisa dilihat dari satu permintaan HTTP mana pun:
 *
 *   1. BAWAANNYA MATI — dan bawaan itu hidup di berkas MIGRASI, bukan di
 *      `schema.ts`. Mengubah `schema.ts` saja tak mengubah database mana pun
 *      yang sudah ada; sebaliknya, migrasi baru ber-`DEFAULT true` akan
 *      menyalakan gerbang ini pada SETIAP tenant berjalan sekaligus. Terbukti
 *      saat membuktikan uji ini merah: menyetel `schema.ts` ke `true` tidak
 *      membuat satu asersi pun jatuh, karena database uji dibangun dari
 *      migrasi.
 *   2. DUA PENGECUALIAN jalur (bayar bill & sinkron offline) masih tertulis di
 *      syarat gerbangnya.
 *   3. Aturan resep→bahan hanya punya SATU implementasi.
 */

const SRV = new URL("../src/", import.meta.url);
const baca = (p: string, dari: URL = SRV) =>
  readFileSync(fileURLToPath(new URL(p, dari)), "utf8");

describe("bawaan MATI dipatok di migrasi, bukan cuma di schema.ts", () => {
  it("kolomnya lahir dengan DEFAULT false", () => {
    /*
     * Menyalakannya untuk tenant yang sudah berjalan akan menghentikan
     * penjualan menu mana pun yang bahannya terlanjur bersaldo minus —
     * keadaan yang lazim pada data lama. Itu harus jadi keputusan sadar
     * pemiliknya, bukan efek samping pembaruan.
     */
    const migrasi = baca("../drizzle/0100_perpetual_sharon_carter.sql");
    expect(migrasi).toContain('"blokir_jual_minus" boolean DEFAULT false NOT NULL');
    expect(migrasi).not.toContain("DEFAULT true");
  });

  it("schema.ts menyebut bawaan yang SAMA dengan migrasinya", () => {
    // Dua sumber kebenaran yang berbeda pendapat soal bawaan adalah cara
    // paling sunyi untuk menyalakan gerbang ini di tenant berikutnya.
    expect(baca("db/schema.ts")).toContain(
      'blokirJualMinus: boolean("blokir_jual_minus").notNull().default(false)',
    );
  });
});

describe("dua jalur yang SENGAJA dilewati gerbang", () => {
  it("syarat gerbang menyebut keduanya", () => {
    /*
     * Keduanya karena alasan yang sama: pesanannya SUDAH terjadi, jadi
     * menolaknya tak mencegah apa pun.
     *
     *   · `openBillId` — bill yang sedang dibayar; masakannya sudah dikerjakan
     *     sejak bill tayang di papan dapur.
     *   · `transaksiSusulan` — sinkron offline; menolaknya MENGHAPUS penjualan
     *     sungguhan, sebab antrean klien menandai perintah yang ditolak server
     *     sebagai `gagal` dan tak pernah mengirimnya lagi.
     */
    const svc = baca("modules/penjualan/service.ts");
    expect(svc).toContain(
      "if (company.blokirJualMinus && !params.openBillId && !params.transaksiSusulan) {",
    );
  });

  it("jalur sinkron benar-benar menandai dirinya susulan", () => {
    // Tanpa penanda ini pengecualian di atas tak pernah menyala, dan tiap
    // transaksi offline yang stoknya kurang ditolak permanen.
    expect(baca("modules/sync/routes.ts")).toContain("transaksiSusulan: true");
  });
});

describe("aturan resep → bahan cuma punya satu implementasi", () => {
  it("pemeriksa dan pencatat memanggil fungsi yang sama", () => {
    /*
     * Gerbang yang memakai aturan berbeda dari pencatatnya akan menolak
     * pesanan yang sebenarnya cukup — atau meloloskan yang tidak — dan tak ada
     * yang bisa menjelaskan sebabnya kepada kasir.
     */
    expect(baca("modules/menu/service.ts")).toContain("export function tambahKebutuhanBahan(");
    for (const p of ["modules/penjualan/service.ts", "modules/open-bill/routes.ts"]) {
      expect(baca(p), p).toContain("tambahKebutuhanBahan(");
    }
  });

  it("tak ada yang menguraikan resep dengan tangan lagi", () => {
    // Bentuk lamanya: `qtyEfektif(...) * item.qty` di dalam loop
    // `komponenEfektif`. Satu-satunya tempat yang boleh memuatnya kini adalah
    // helper-nya sendiri.
    const nakal = ["modules/penjualan/service.ts", "modules/open-bill/routes.ts"].filter((p) =>
      /qtyEfektif\(/.test(baca(p)),
    );
    expect(nakal).toEqual([]);
  });
});

describe("saldo dibaca di dalam transaksi penulisan", () => {
  it("`hitungSaldoCabang` menerima executor, dan gerbang mengoper `tx`", () => {
    // Saldo yang dibaca di luar transaksi penulisan adalah saldo dunia lain:
    // keputusan yang dibuat atasnya tak dijamin masih benar saat tulisannya
    // mendarat.
    expect(baca("modules/stok/service.ts")).toContain(
      'exec: Pick<typeof db, "select" | "execute"> = db,',
    );
    expect(baca("modules/penjualan/service.ts")).toContain(
      "bahanKurang(tx, params.companyId, params.branchId, konsumsi)",
    );
  });

  it("saldo yang SUDAH minus tetap dihitung kurang", () => {
    // Pengecualian untuk saldo minus akan membebaskan justru bahan yang paling
    // bermasalah. Keputusan sadar pemiliknya; dipatok supaya tak diperlunak
    // diam-diam saat ada yang mengeluh.
    const svc = baca("modules/stok/service.ts");
    const i = svc.indexOf("export async function bahanKurang(");
    expect(i).toBeGreaterThan(0);
    const blok = svc.slice(i, svc.indexOf("\n}", i));
    expect(blok).toContain("if (r.saldo < perlu - 1e-9) {");
    expect(blok).not.toMatch(/r\.saldo\s*>\s*0\s*&&/);
  });
});

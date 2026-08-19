import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * `/tahap` HARUS DIKLAIM SEBELUM DIEKSEKUSI.
 *
 * Endpoint ini tidak bisa dibuat idempoten dari isinya sendiri. "Majukan 3 dari
 * baris ini" membaca qty baris apa adanya, dan cabang SPLIT hanya MENGURANGI
 * qty induknya tanpa menyentuh statusnya — jadi CAS `(id, status, qty)` yang
 * menjaga jalur "maju penuh" tak menjaga apa pun di sini: kiriman kedua membaca
 * qty yang sudah berkurang, cocok lagi, lalu memotong lagi.
 *
 * TERUKUR pada faktur 8 pcs, "terima 3" terkirim dua kali:
 *
 *   tanpa client_ref → dua baris 3 pcs masuk stok (saldo +6), sisa tugas
 *                      belanja menyusut dari 5 jadi 2;
 *   dengan client_ref → satu baris 3 pcs (saldo +3), sisa tetap 5.
 *
 * Artinya barang yang tak pernah datang tercatat datang, dan yang masih harus
 * dibeli tercatat lebih sedikit daripada yang sebenarnya. Dua-duanya sunyi:
 * Σqty faktur tetap 8, jadi tak ada angka yang terlihat janggal.
 *
 * Yang dijaga uji ini: klaimnya ADA, MEMBUNGKUS SELURUH badan handler, dan
 * kliennya benar-benar mengirim identitas permintaannya. Ketiganya bisa hilang
 * sendiri-sendiri, dan hilangnya tak menimbulkan gejala apa pun sampai ada yang
 * menekan tombol dua kali.
 */

const AKAR = new URL("../src/", import.meta.url);
const baca = (p: string, dari: URL = AKAR) => readFileSync(fileURLToPath(new URL(p, dari)), "utf8");
const RUTE = baca("modules/produksi/routes.ts");

describe("server: /tahap memakai klaim idempoten bersama", () => {
  it("berkasnya terbaca — bukan lolos karena kosong", () => {
    expect(RUTE.length).toBeGreaterThan(10_000);
  });

  it("`client_ref` diterima di TahapBody", () => {
    const i = RUTE.indexOf("const TahapBody = z.object({");
    expect(i).toBeGreaterThan(0);
    const blok = RUTE.slice(i, RUTE.indexOf("\n});", i));
    expect(blok).toContain("client_ref: clientRefField");
  });

  it("memakai helper BERSAMA, bukan salinan logika klaim", () => {
    // Alasan helper itu dibagi tertulis di `idempoten.ts`: jalur kedelapan yang
    // muncul kelak tak boleh bisa lupa memakainya. Salinan di sini akan jadi
    // salinan yang bergeser sendiri.
    expect(RUTE).toContain('} from "../sync/idempoten"');
    expect(RUTE).toContain("await denganKlaimIdempoten(");
  });

  it("klaim membungkus SELURUH badan handler, bukan sebagian", () => {
    /*
     * Klaim yang dipasang di tengah handler menjaga separuh: pemeriksaan yang
     * berjalan sebelumnya (bahan kurang, kiriman beralamat, CAS) sudah
     * mengeksekusi query dan melempar di luar lindungannya.
     *
     * Diperiksa dengan URUTAN posisi: klaimnya harus datang SEBELUM query
     * pertama handler ini, dan `return c.json(data)` harus jadi keluarnya.
     */
    const iPost = RUTE.indexOf('.post("/tahap/:fakturId"');
    expect(iPost).toBeGreaterThan(0);
    const blok = RUTE.slice(iPost, RUTE.indexOf("\n    })", iPost));
    const iKlaim = blok.indexOf("await denganKlaimIdempoten(");
    const iQuery = blok.indexOf("await db");
    expect(iKlaim).toBeGreaterThan(0);
    expect(iQuery).toBeGreaterThan(0);
    expect(iKlaim, "klaim harus mendahului query pertama handler").toBeLessThan(iQuery);
    expect(blok).toContain("return c.json(data);");
  });

  it("tak ada `return c.json` lain di dalam badan yang diklaim", () => {
    // Jalan keluar kedua akan melewati penutupan ledger: hasilnya tak tercatat,
    // jadi kiriman ulang mengeksekusi ulang — persis bug yang ditutup.
    const iPost = RUTE.indexOf('.post("/tahap/:fakturId"');
    const blok = RUTE.slice(iPost, RUTE.indexOf("\n    })", iPost));
    expect(blok.split("return c.json(").length - 1).toBe(1);
  });
});

const WEB = new URL("../../web/src/", import.meta.url);

describe("web: kedua tombol /tahap mengirim identitas permintaannya", () => {
  /*
   * Perbaikan server saja TIDAK menutup apa pun untuk pengguna yang ada:
   * `client_ref` opsional, dan tanpa kiriman dari klien, klaimnya dilewati
   * begitu saja. Terukur: tanpa `client_ref` saldonya tetap naik 6.
   */
  const HALAMAN = [
    "pages/produksi/TahapPage.tsx",
    "pages/produksi/TambahStokPage.tsx",
  ];

  it.each(HALAMAN)("%s mengirim client_ref pada /tahap", (rel) => {
    const isi = baca(rel, WEB);
    const i = isi.indexOf("/tahap/");
    expect(i, "pemanggilan /tahap tak ditemukan — jangkarnya usang").toBeGreaterThan(0);
    expect(isi.slice(i, i + 400)).toContain("client_ref");
  });

  it.each(HALAMAN)("%s memakai ref yang BERTAHAN, bukan uuid baru tiap kirim", (rel) => {
    // `client_ref: uuidV4()` ditulis langsung di badan permintaan berarti tiap
    // percobaan punya identitas berbeda — persis keadaan sebelum perbaikan,
    // dengan biaya tambahan satu baris ledger per percobaan.
    const isi = baca(rel, WEB);
    const i = isi.indexOf("client_ref");
    expect(isi.slice(i, i + 120)).not.toMatch(/client_ref:\s*uuidV4\(\)/);
    expect(isi).toContain("refTahap");
  });

  it("ref dilepas saat SUKSES — bukan dipegang selamanya", () => {
    // Tanpa pelepasan, permintaan kedua yang SAH (mis. maju tahap berikutnya
    // dari halaman yang sama) akan memulangkan hasil yang pertama tanpa
    // mengeksekusi apa pun — kebalikan dari bug ini, sama diamnya.
    expect(baca("pages/produksi/TahapPage.tsx", WEB)).toContain("refTahap.current = null");
    expect(baca("pages/produksi/TambahStokPage.tsx", WEB)).toContain("refTahap.current.delete(");
  });

  it("TambahStokPage memakai ref PER FAKTUR, bukan satu untuk sehalaman", () => {
    // Daftar itu memulai faktur mana pun. Satu ref bersama membuat faktur kedua
    // memulangkan hasil faktur pertama tanpa mengeksekusi apa pun.
    const isi = baca("pages/produksi/TambahStokPage.tsx", WEB);
    expect(isi).toContain("new Map<string, string>()");
  });
});

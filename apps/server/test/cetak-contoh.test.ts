import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { contohFakturBelanja, contohStruk } from "../../web/src/lib/contoh-cetak";

/**
 * CETAK CONTOH.
 *
 * Sebelum ini, satu-satunya cara melihat bagaimana struk keluar dari printer
 * adalah MELAKUKAN TRANSAKSI SUNGGUHAN. Jadi tiap kali kertas diganti, printer
 * dipindah, atau footer cabang disunting, seseorang menjual sesuatu lalu
 * membatalkannya — dan pembatalan itu masuk laporan.
 *
 * Dua hal yang dijaga di sini, dan keduanya mudah dibatalkan tanpa sadar:
 *
 * 1. CONTOH DIGAMBAR OLEH KOMPONEN YANG SAMA dengan yang dipakai kasir.
 *    Pratinjau yang punya kode gambarnya sendiri akan bergeser dari aslinya,
 *    dan pratinjau yang bergeser lebih buruk daripada tak ada — ia mengatakan
 *    tata letaknya beres justru ketika tidak.
 *
 * 2. CONTOH TERTANDA SEBAGAI CONTOH. Struk contoh tercetak di atas kertas yang
 *    sama dengan nota sungguhan, lalu tergeletak di meja kasir. Kalau ia bisa
 *    disangka nota, ia akan disangka nota.
 */

const AKAR = new URL("../../web/src/", import.meta.url);
const baca = (p: string) => readFileSync(fileURLToPath(new URL(p, AKAR)), "utf8");
const HAL = baca("pages/pengaturan/PrinterPage.tsx");

describe("contoh struk: angkanya harus konsisten", () => {
  const s = contohStruk({ branchId: "b1", branchNama: "Cabang Uji" });

  it("subtotal = jumlah baris", () => {
    // Struk contoh dipakai orang untuk memeriksa blok total di kertas. Blok
    // total yang angkanya tak nyambung membuat yang memeriksanya menduga
    // printernya salah, padahal contohnya yang salah.
    expect(s.sale.subtotal).toBe(s.items.reduce((t, i) => t + i.lineTotal, 0));
  });

  it("total = subtotal − diskon + PB1", () => {
    expect(s.sale.total).toBe(s.sale.subtotal - s.sale.diskon + s.sale.pb1Amount);
  });

  it("uang diterima ≥ total (ada kembalian untuk dilihat)", () => {
    // Baris "Kembali" cuma muncul bila uangnya lebih. Contoh dengan uang pas
    // menyembunyikan satu baris yang justru sering salah posisi di 58 mm.
    expect(s.sale.uangDiterima).not.toBeNull();
    expect(s.sale.uangDiterima!).toBeGreaterThan(s.sale.total);
  });

  it("ada baris bercatatan — baris itulah yang paling sering meluber", () => {
    expect(s.items.some((i) => (i.catatan ?? "").length > 0)).toBe(true);
  });

  it("tak ada porsi refund — contoh bukan tempat menguji jalur refund", () => {
    expect(s.sale.refundTotal).toBe(0);
    expect(s.items.every((i) => i.qtyRefund === 0)).toBe(true);
  });
});

describe("contoh dokumen belanja", () => {
  const f = contohFakturBelanja();

  it("total faktur = jumlah baris", () => {
    expect(f.totalHarga).toBe(f.rows.reduce((t, r) => t + (r.total_harga ?? 0), 0));
  });

  it("memuat DUA bentuk kelompok: bersupplier dan tanpa supplier", () => {
    // Dokumen sungguhan mengelompokkan per `supplier_bahan`, dan kelompok
    // "bebas beli di mana" digambar berbeda. Contoh yang cuma memakai satu
    // bentuk tak menguji yang satunya — padahal keduanya biasa muncul di
    // dokumen yang sama. (Versi pertama mengisi `supplier_id` saja, dan semua
    // baris tergambar sebagai "tanpa supplier".)
    expect(f.rows.some((r) => r.supplier_bahan)).toBe(true);
    expect(f.rows.some((r) => !r.supplier_bahan)).toBe(true);
  });
});

describe("contoh tak bisa disangka yang sungguhan", () => {
  it("nomor & catatan struk menyebut dirinya contoh", () => {
    const s = contohStruk({ branchId: "b1", branchNama: "Cabang Uji" });
    expect(s.sale.nomor).toMatch(/CONTOH/i);
    expect(s.sale.catatan ?? "").toMatch(/CETAK UJI|CONTOH/i);
    expect(s.items.every((i) => /contoh/i.test(i.menuNama))).toBe(true);
  });

  it("dokumen belanja bertanda pada nomor & catatan", () => {
    const f = contohFakturBelanja();
    expect(f.nomor ?? "").toMatch(/CONTOH/i);
    expect(f.catatan ?? "").toMatch(/CETAK UJI|CONTOH/i);
  });
});

describe("contoh digambar oleh komponen yang SAMA", () => {
  it("halaman Printer memakai ReceiptModal & DokumenBelanjaModal", () => {
    expect(HAL).toContain("from \"../kasir/ReceiptModal\"");
    expect(HAL).toContain("from \"../produksi/DokumenBelanjaModal\"");
  });

  it("tak ada tombol yang bisa MENGUBAH data di jalur contoh", () => {
    /*
     * `ReceiptModal` menampilkan tombol Hapus hanya bila diberi `onDeleted`,
     * dan Kembalikan Uang hanya bila diberi `onRefunded`. Keduanya TIDAK boleh
     * dioper dari halaman Printer: contoh yang bisa menghapus sesuatu adalah
     * jebakan, dan yang menekannya sedang mengira dirinya cuma mencoba printer.
     */
    const i = HAL.indexOf("<ReceiptModal");
    expect(i).toBeGreaterThan(0);
    const blok = HAL.slice(i, HAL.indexOf("/>", i));
    expect(blok).not.toContain("onDeleted");
    expect(blok).not.toContain("onRefunded");
    expect(blok).toContain("autoPrintOnOpen={false}");
  });

  it("cabangnya dari konteks halaman, bukan `auth.branch`", () => {
    // Owner & admin tidak terikat cabang mana pun (`auth.branch === null`) —
    // padahal justru merekalah yang mengatur printer. Versi pertama memakai
    // `auth.branch` dan tombolnya mati untuk mereka; ketahuan saat Playwright
    // menemukan tombol yang `disabled`.
    const i = HAL.indexOf("function CetakContohSection");
    expect(i).toBeGreaterThan(0);
    const blok = HAL.slice(i, i + 1500);
    expect(blok).toContain("useCabangData()");
    expect(blok).not.toMatch(/const branch = auth\?\.branch/);
  });
});

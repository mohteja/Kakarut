import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ringkasNilaiStok } from "@kakarut/shared";

/**
 * NILAI RUPIAH STOK — RINGKASAN YANG TIDAK BOLEH DIAM-DIAM KEKURANGAN.
 *
 * Halaman Stok kini menjawab "berapa modal yang mengendap di rak". Satu angka
 * rupiah besar di atas tabel adalah angka yang dipercaya orang tanpa
 * memeriksanya — jadi tiap hal yang TIDAK ikut dijumlahkan wajib bisa
 * dibuktikan tetap terlihat, bukan hanya benar aritmetikanya.
 *
 * Dua sumber kekurangan senyap yang dijaga uji ini, keduanya sudah ada di data
 * nyata (layar yang memicu permintaan ini penuh saldo minus):
 *
 *   1. Saldo MINUS. Rak fisik tak bisa berisi kurang dari nol; minus berarti
 *      catatan masuk yang tertinggal. Menjumlahkannya begitu saja mengurangi
 *      nilai barang lain yang benar-benar ada — salah, dan tak ada gejalanya
 *      selain total yang terlalu kecil.
 *   2. Bahan ber-`harga_beli` NOL. Nol dikali qty berapa pun tetap nol, jadi
 *      bahan itu menghilang dari total tanpa jejak.
 */

const b = (saldo: number, harga_per_unit: number) => ({ saldo, harga_per_unit });

describe("ringkasNilaiStok", () => {
  it("menjumlahkan saldo × harga per satuan kerja", () => {
    // 20.000 gr × Rp 25/gr + 12 pcs × Rp 3.500 = 500.000 + 42.000
    const r = ringkasNilaiStok([b(20_000, 25), b(12, 3_500)]);
    expect(r.nilai).toBe(542_000);
    expect(r.bahan_bernilai).toBe(2);
    expect(r.minus_bahan).toBe(0);
    expect(r.tanpa_harga_bahan).toBe(0);
  });

  it("saldo MINUS tidak mengurangi nilai barang yang ada", () => {
    /*
     * Ini asersi inti berkas ini. Σ naif atas kedua baris = 500.000 − 5.000 =
     * 495.000: barang yang ADA di rak dinilai lebih rendah gara-gara barang
     * lain yang catatan masuknya belum lengkap. Dua kesalahan searah.
     */
    const r = ringkasNilaiStok([b(20_000, 25), b(-50, 100)]);
    expect(r.nilai).toBe(500_000);
    expect(r.minus_bahan).toBe(1);
    // Besarnya dilaporkan POSITIF supaya layar bisa menyebut ongkosnya.
    expect(r.minus_nilai).toBe(5_000);
    // dan ia TIDAK ikut dicacah sebagai bahan bernilai
    expect(r.bahan_bernilai).toBe(1);
  });

  it("bahan tanpa harga beli DICACAH, bukan sekadar menyumbang nol", () => {
    // Tanpa cacahan ini bahan itu menghilang dari layar sepenuhnya: nilainya
    // nol, barisnya tetap di tabel, dan tak ada apa pun yang memberi tahu
    // bahwa totalnya sengaja melewatkannya.
    const r = ringkasNilaiStok([b(20_000, 25), b(7, 0)]);
    expect(r.nilai).toBe(500_000);
    expect(r.bahan_bernilai).toBe(1);
    expect(r.tanpa_harga_bahan).toBe(1);
  });

  it("saldo NOL tak dihitung sebagai apa pun", () => {
    // Bukan nilai, bukan minus, dan bukan "belum berharga" — memperingatkan
    // harga kosong untuk bahan yang memang tak ada barangnya cuma membuat
    // kartunya menyala terus dan berhenti dibaca.
    const r = ringkasNilaiStok([b(0, 0), b(0, 500)]);
    expect(r).toEqual({
      nilai: 0,
      bahan_bernilai: 0,
      minus_bahan: 0,
      minus_nilai: 0,
      tanpa_harga_bahan: 0,
    });
  });

  it("daftar kosong memulangkan nol di semua sisi", () => {
    expect(ringkasNilaiStok([]).nilai).toBe(0);
  });

  it("harga NaN/Infinity tak menular ke total", () => {
    /*
     * `harga_beli / isi` dengan `isi` aneh bisa memulangkan bukan-bilangan.
     * NaN tak menolak dirinya sendiri: sekali masuk penjumlahan, SELURUH
     * total jadi NaN dan kartunya menuliskan "—" tanpa menyebut bahan mana
     * penyebabnya. Baris seperti itu diperlakukan seperti tak berharga.
     */
    const r = ringkasNilaiStok([b(10, Number.NaN), b(10, Number.POSITIVE_INFINITY), b(4, 1_000)]);
    expect(r.nilai).toBe(4_000);
    expect(r.tanpa_harga_bahan).toBe(2);
  });
});

const SRV = new URL("../src/", import.meta.url);
const baca = (p: string, dari: URL = SRV) =>
  readFileSync(fileURLToPath(new URL(p, dari)), "utf8");

describe("harga per unit sampai ke daftar stok", () => {
  it("server mengirim harga per SATUAN KERJA, bukan per kemasan", () => {
    /*
     * `harga_beli` disimpan per KEMASAN sedangkan saldo per satuan kerja.
     * Mengirimkannya apa adanya membuat tiap perkalian di layar meleset
     * sebesar `isi` — 1000× untuk bahan gram/kg, persis bentuk kesalahan yang
     * sudah pernah muncul di jalur riwayat harga.
     */
    const svc = baca("modules/stok/service.ts");
    expect(svc).toContain("i.harga_beli  AS harga_beli");
    expect(svc).toMatch(/harga_per_unit: hargaPerUnit\(Number\(row\.harga_beli\), Number\(row\.isi\)\)/);
  });

  it("`harga_per_unit` ada di kontrak StokRowDto", () => {
    const tipe = baca("../../../packages/shared/src/types.ts");
    const i = tipe.indexOf("export interface StokRowDto");
    expect(i).toBeGreaterThan(0);
    expect(tipe.slice(i, tipe.indexOf("\n}", i))).toContain("harga_per_unit: number");
  });
});

const WEB = new URL("../../web/src/", import.meta.url);

describe("kartu ringkasan di halaman Stok", () => {
  it("memakai `ringkasNilaiStok`, bukan menjumlahkan sendiri", () => {
    // Aturan minus & tanpa-harga di atas tak ada artinya bila halaman
    // menjumlahkan barisnya sendiri dengan `reduce`.
    const hal = baca("pages/stok/StokPage.tsx", WEB);
    expect(hal).toContain("ringkasNilaiStok(tampil)");
  });

  it("kartu TIDAK dirender saat pembacaan stok gagal", () => {
    /*
     * `tampil` kosong karena galat menghasilkan "Rp 0" — pernyataan yang jauh
     * lebih percaya diri daripada tabel kosong di bawahnya, dan salah. Halaman
     * ini sudah memegang kaidah itu untuk tabelnya ("GAGAL MEMUAT ≠ TIDAK
     * ADA"); kartunya harus tunduk pada kaidah yang sama.
     */
    const hal = baca("pages/stok/StokPage.tsx", WEB);
    expect(hal).toMatch(/\{!stokGagal && \(stok\?\.length \?\? 0\) > 0 && \(/);
  });

  it("filter yang aktif disebut di label kartunya", () => {
    // Ringkasan yang diam-diam ikut menyempit saat orang mengetik di kotak
    // cari adalah ringkasan yang dibaca sebagai total seluruh gudang.
    const hal = baca("pages/stok/StokPage.tsx", WEB);
    expect(hal).toContain('"Nilai Stok (terfilter)"');
    expect(hal, "label kartunya tak lagi bergantung `terfilter`").toMatch(
      /terfilter[^\n]*\?\s*"Nilai Stok \(terfilter\)"/,
    );
  });

  it("cakupan yang BERBEDA juga disebut, bukan cuma filternya", () => {
    /*
     * Sejak kebijakan biaya ditegakkan (2026-08-26), peran non-manajemen tak
     * lagi menerima `harga_per_unit` per baris, jadi totalnya datang dari
     * agregat `GET /stok/nilai` — angka SELURUH CABANG yang tak ikut menyempit
     * saat kotak cari terisi. Ringkasan yang cakupannya diam-diam berbeda dari
     * tabel di bawahnya persis kelas yang uji di atas ini lahir untuk menahan.
     */
    const hal = baca("pages/stok/StokPage.tsx", WEB);
    expect(hal).toContain("hargaDitahan");
    expect(hal, "cakupan yang berbeda tak disebut di layar").toContain("seluruh cabang");
  });

  it("dasar penilaian disebut di layar", () => {
    // Total rupiah tanpa keterangan dasarnya akan dibaca sebagai nilai buku
    // (FIFO/rata-rata), lalu dipakai untuk hal yang bukan haknya. Yang dipakai
    // di sini harga beli TERKINI.
    expect(baca("pages/stok/StokPage.tsx", WEB)).toContain("harga beli terkini");
  });
});

describe("StatCard cuma punya satu definisi", () => {
  it("tak ada halaman yang mendefinisikan ulang StatCard-nya sendiri", () => {
    /*
     * Bentuk kartu ini pernah disalin EMPAT kali, dan salinannya sudah mulai
     * berbeda: dua `text-xl`, satu `text-2xl`, dan baris kecilnya dinamai
     * `sub` di satu tempat dan `rincian` di tempat lain. Yang kelima yang
     * membuatnya tak bisa dibiarkan.
     */
    const dari = new URL("../../web/src/", import.meta.url);
    const halaman = [
      "pages/DashboardPage.tsx",
      "pages/laporan/LaporanPage.tsx",
      "pages/laporan/LaporanPembelianPage.tsx",
      "pages/stok/KartuStokPage.tsx",
      "pages/stok/StokPage.tsx",
    ];
    const nakal = halaman.filter((p) => /function StatCard\b/.test(baca(p, dari)));
    expect(nakal).toEqual([]);
    // …dan definisi tunggalnya memang ada di components/ui.
    expect(baca("components/ui.tsx", dari)).toContain("export function StatCard(");
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Penjaga GAGAL MEMUAT ≠ TIDAK ADA PEKERJAAN, untuk dua layar KEPUTUSAN.
 *
 * Puluhan halaman di aplikasi ini memakai pesan kosong tanpa cabang galat, dan
 * itu keseragaman yang masuk akal: di gudang atau kasir dunia nyata langsung
 * menyanggah layar — rak yang penuh membantah daftar kiriman kosong, antrean
 * pelanggan membantah daftar menu kosong.
 *
 * Dua halaman ini lolos dari penyanggah itu, dan keduanya layar keputusan:
 *
 * - Rekomendasi Beli menghitung sarannya dari kecepatan jual × sisa stok.
 *   Keduanya tak terlihat mata. Lebih buruk lagi, bentuk lamanya berakhir
 *   `: null` — bacaan yang ditolak menghasilkan halaman KOSONG tanpa sepatah
 *   kata pun, dan diamnya membuat orang berhenti belanja.
 * - Permintaan Stok memajang antrean permintaan cabang. Cabang yang menunggu
 *   tak punya cara memberi tahu kantor selain lewat daftar ini, dan pesan
 *   kosongnya justru mengundang membuat permintaan baru.
 *
 * Kriteria "kosong yang tak bisa disanggah" bukan karangan uji ini —
 * `RiwayatPage` menuliskannya lebih dulu untuk kasusnya sendiri.
 */
const baca = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const tanpaKomentar = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");

const REKOM = tanpaKomentar(baca("../../web/src/pages/produksi/RekomendasiBeliPage.tsx"));
const PERMINTAAN = tanpaKomentar(baca("../../web/src/pages/stok/PermintaanStokPage.tsx"));

describe("premis: keduanya memang berakhir 'tak ada pekerjaan' saat gagal", () => {
  it("Rekomendasi Beli: cabang terakhirnya `: null` — diam total", () => {
    // Pagar ini menjaga PREMIS-nya, bukan perbaikannya: kalau suatu saat
    // ujungnya bukan `null` lagi, penjagaan di bawah harus ditinjau ulang.
    expect(REKOM).toMatch(/\) : null\}/);
  });

  it("Permintaan Stok: pesan kosongnya mengundang membuat yang baru", () => {
    expect(PERMINTAAN).toMatch(/Belum ada permintaan/);
  });
});

describe("keduanya kini mengatakan saat bacaannya gagal", () => {
  it.each([
    ["Rekomendasi Beli", "../../web/src/pages/produksi/RekomendasiBeliPage.tsx", "tak ada yang perlu dibeli"],
    ["Permintaan Stok", "../../web/src/pages/stok/PermintaanStokPage.tsx", "cabang yang meminta stok"],
  ])("%s mengambil `error` dan menjelaskannya", (_nama, berkas, kalimat) => {
    const src = tanpaKomentar(baca(berkas));
    /*
     * Pola dilonggarkan 2026-09-03 supaya TAHAN FORMAT, bukan tahan makna.
     * Yang lama menuntut destructuring SEBARIS (`error: gagalMuat } = useQuery`);
     * `PermintaanStokPage` kini memecahnya jadi beberapa baris karena
     * querynya bertambah medan (`isFetching` untuk penanda muat halaman).
     * Yang dijaga tetap sama dan tetap bisa menuduh: galatnya DIIKAT dari
     * sebuah `useQuery`, bukan dikarang di tempat lain — cabut `error:`-nya
     * dan pola ini merah.
     */
    expect(src).toMatch(/error:\s*gagalMuat[\s\S]{0,80}?useQuery\(/);
    expect(src).toMatch(/<ErrorText error=\{gagalMuat\} \/>/);
    // Bukan cuma memajang galat — dikatakan bahwa kosong ≠ tak ada pekerjaan.
    expect(src).toContain(kalimat);
    expect(src).toContain("bukan");
  });

  it.each([
    ["Rekomendasi Beli", "../../web/src/pages/produksi/RekomendasiBeliPage.tsx", "data ? ("],
    ["Permintaan Stok", "../../web/src/pages/stok/PermintaanStokPage.tsx", "list.length === 0 ?"],
  ])("%s memeriksa galat SEBELUM cabang isinya", (_nama, berkas, penanda) => {
    // Urutannya menentukan: kalau cabang isi/kosong menang duluan, diamnya
    // atau pesan kosongnya tetap yang tampil saat bacaan gagal.
    const src = tanpaKomentar(baca(berkas));
    const iGagal = src.indexOf("gagalMuat ? (");
    const iIsi = src.indexOf(penanda);
    expect(iGagal, "cabang gagalMuat tak ditemukan").toBeGreaterThan(0);
    expect(iIsi).toBeGreaterThan(iGagal);
  });

  it("pembuang komentar tidak memakan kodenya", () => {
    expect(REKOM).toContain("gagalMuat");
    expect(REKOM).not.toContain("berhenti belanja");
    expect(PERMINTAAN).toContain("gagalMuat");
    expect(PERMINTAAN).not.toContain("antre");
  });
});

/**
 * Patokan rumahnya. Keduanya sudah lebih dulu memisahkan gagal dari kosong,
 * dan merekalah yang menjadikan penjagaan di atas penerapan pola.
 */
describe("pola rumahnya tetap ada di dua halaman patokan", () => {
  it("RiwayatPage masih menuliskan alasannya", () => {
    expect(baca("../../web/src/pages/kasir/RiwayatPage.tsx")).toMatch(
      /GAGAL MEMUAT ≠ TIDAK ADA TRANSAKSI/,
    );
  });

  it("AnalisisHargaPage masih memisahkan gagal dari jempolnya", () => {
    const src = tanpaKomentar(baca("../../web/src/pages/menu/AnalisisHargaPage.tsx"));
    expect(src).toMatch(/error: gagalMuat \} = useQuery/);
    expect(src).toMatch(/\{gagalMuat \? \(/);
  });
});

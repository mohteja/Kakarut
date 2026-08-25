import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { butaKomentar } from "../src/scripts/buta-komentar";

/**
 * Penjaga GAGAL MEMUAT ≠ SEMUA MENU SEHAT di halaman Analisis Harga.
 *
 * Bacaan halaman ini dulu diambil tanpa `error`. Saat servernya menolak,
 * `rows` undefined → daftar tersaring kosong → layar menampilkan
 * "Tidak ada menu di atas ambang N%. 👍": halaman MENGUCAPKAN SELAMAT atas
 * keadaan yang tak pernah ia lihat.
 *
 * Kenapa justru di sini yang berbahaya, sementara puluhan halaman lain memakai
 * pesan kosong tanpa cabang galat: di gudang atau kasir, dunia nyata langsung
 * menyanggah layar — rak penuh membantah daftar kiriman yang kosong, antrean
 * pelanggan membantah daftar menu yang kosong. Food cost tak terlihat. Halaman
 * ini satu-satunya alat ukurnya, jadi bohongnya tak punya penyanggah.
 *
 * Kriteria itu bukan karangan uji ini — `RiwayatPage` sudah menuliskannya lebih
 * dulu untuk kasusnya sendiri, dan halaman ini memenuhi kriteria yang sama.
 */
const baca = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
/**
 * Pengupas komentar: SATU RUMAH, `src/scripts/buta-komentar.ts`.
 *
 * Sebelumnya berkas ini punya salinannya sendiri — tiga `replace` regex yang
 * menilai `/` tanpa tahu ia ada di mana. Terukur terhadap berkas yang dibaca
 * uji ini sendiri, salinan itu membuang 2–3 aksara LEBIH BANYAK dari yang
 * seharusnya. Kecil, dan justru itu masalahnya: salinan yang dibiarkan berbeda
 * dari saudaranya adalah cara kelas ini tumbuh kembali — vena "pengupas
 * komentar buta di tujuh salinan" sudah membayarnya sekali.
 */
const tanpaKomentar = butaKomentar;

const HAL = tanpaKomentar(baca("../../web/src/pages/menu/AnalisisHargaPage.tsx"));

describe("premis: kosong di halaman ini berbunyi seperti kabar baik", () => {
  it("pesan kosongnya memang sebuah lolos-semua-aman", () => {
    expect(HAL).toMatch(/Tidak ada menu di atas ambang/);
    expect(HAL).toContain("👍");
  });

  it("daftar yang tampil lahir dari `rows` bacaan itu", () => {
    // Kalau bacaannya gagal, `rows` undefined dan `tampil` ikut kosong —
    // itulah jalur yang dulu berakhir di jempol.
    expect(HAL).toMatch(/const \{ data: rows, isLoading/);
    expect(HAL).toMatch(/tampil\.length === 0 \?/);
  });
});

describe("gagal memuat dikatakan apa adanya", () => {
  it("pembuang komentar tidak memakan kodenya", () => {
    expect(HAL).toContain("gagalMuat");
    expect(HAL).not.toContain("MENGUCAPKAN SELAMAT");
  });

  it("bacaannya mengambil `error`", () => {
    expect(HAL).toMatch(/const \{ data: rows, isLoading, error: gagalMuat \} = useQuery/);
  });

  it("cabang galat diperiksa SEBELUM cabang kosong", () => {
    // Urutannya menentukan: kalau `tampil.length === 0` diperiksa lebih dulu,
    // jempolnya tetap menang saat bacaan gagal.
    const iGagal = HAL.indexOf("{gagalMuat ? (");
    const iKosong = HAL.indexOf("tampil.length === 0 ?");
    expect(iGagal, "cabang gagalMuat tak ditemukan").toBeGreaterThan(0);
    expect(iKosong).toBeGreaterThan(iGagal);
  });

  it("galatnya ditampilkan, bukan sekadar disembunyikan", () => {
    const i = HAL.indexOf("{gagalMuat ? (");
    const blok = HAL.slice(i, i + 500);
    expect(blok).toMatch(/<ErrorText error=\{gagalMuat\} \/>/);
    // Dan dikatakan terang bahwa kosong ≠ sehat.
    expect(blok).toContain("bukan");
    expect(blok).toContain("sehat");
  });
});

/**
 * Patokan rumahnya — halaman yang lebih dulu memisahkan "gagal" dari "kosong",
 * lengkap dengan alasan tertulis. Ia yang menjadikan penjagaan di atas
 * penerapan pola, bukan selera.
 */
describe("pola rumahnya tetap ada di RiwayatPage", () => {
  it("RiwayatPage masih memisahkan gagal dari kosong", () => {
    const src = tanpaKomentar(baca("../../web/src/pages/kasir/RiwayatPage.tsx"));
    expect(src).toMatch(/const \{ data: rows, isLoading, error \} = useQuery/);
    expect(src).toMatch(/<ErrorText error=\{error\} \/>/);
  });

  it("alasannya masih tertulis di sana", () => {
    expect(baca("../../web/src/pages/kasir/RiwayatPage.tsx")).toMatch(
      /GAGAL MEMUAT ≠ TIDAK ADA TRANSAKSI/,
    );
  });
});

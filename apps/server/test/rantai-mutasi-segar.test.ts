import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Penjaga RANTAI MUTASI yang gagal di tengah.
 *
 * "Tambah Stok dari Menu" memanggil DUA endpoint berurutan dalam satu tombol:
 *   1. `POST /rekomendasi/menu/faktur` — membuat faktur produksi/beli;
 *   2. `POST /perlengkapan/permintaan-otomatis` — kiriman perlengkapan.
 *
 * Yang kedua gagal tidak membatalkan yang pertama: fakturnya sudah terbuat.
 * Tapi mutasi yang reject membuat `onSuccess` tak pernah jalan, jadi TIDAK ADA
 * penyegaran — layar tetap memperlihatkan angka kekurangan yang lama, faktur
 * yang baru lahir tak terlihat, dan tombol Buat masih hidup dengan rencana yang
 * sama.
 *
 * Menekannya sekali lagi memanggil endpoint pertama untuk kedua kalinya.
 *
 * SUDAH BERUBAH — dan berkas ini memang dirancang untuk gugur dengan berisik
 * saat itu terjadi. Dulu di sini tertulis premis "endpoint pertama TIDAK punya
 * penangkal panggilan ganda", lengkap dengan catatan: *kalau suatu saat
 * idempotensi ditambahkan, uji ini harus ditinjau ulang*. Idempotensinya kini
 * ADA (`client_ref` → ledger bersama), jadi premisnya dibalik, bukan dihapus:
 * yang dijaga sekarang adalah bahwa penangkal itu tetap terpasang.
 *
 * Penyegaran `onError` TIDAK ikut dicabut, dan itu disengaja. Keduanya
 * menjawab hal yang berbeda:
 *
 *   - `client_ref` menjawab "tekan lagi jangan menggandakan";
 *   - `onError` menjawab "perlihatkan apa yang sudah terlanjur terjadi".
 *
 * Membuang salah satunya menyisakan separuh masalah. Rincian idempotensinya
 * dijaga terpisah di `rencana-faktur-idempoten.test.ts`.
 *
 * `ResepPage` — satu-satunya rantai serupa di repo ini — sudah lebih dulu
 * memasang `onError` dengan alasan yang ditulis terang di komentarnya. Uji ini
 * memaku keduanya sekaligus.
 */
const baca = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const tanpaKomentar = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const MENTAH = baca("../../web/src/pages/stok/TambahStokDariMenuPage.tsx");
const HALAMAN = tanpaKomentar(MENTAH);
const RESEP = tanpaKomentar(baca("../../web/src/pages/resep/ResepPage.tsx"));
const REKOM = tanpaKomentar(baca("../src/modules/rekomendasi/routes.ts"));

describe("premis: langkah pertama nyata dan tak aman diulang", () => {
  it("tombolnya memang memanggil DUA endpoint berurutan", () => {
    const i = HALAMAN.indexOf("const buat = useMutation");
    expect(i).toBeGreaterThan(0);
    const blok = HALAMAN.slice(i, HALAMAN.indexOf("onSuccess:", i));
    expect(blok).toMatch(/rekomendasi\/menu\/faktur/);
    expect(blok).toMatch(/perlengkapan\/permintaan-otomatis/);
  });

  it("endpoint pertama KINI punya penangkal panggilan ganda", () => {
    // Premis yang dibalik. Selama penangkal ini ada, tekan-lagi memutar ulang
    // faktur yang sama — bukan menerbitkan set kedua.
    const i = REKOM.indexOf('"/menu/faktur"');
    expect(i, "rute /menu/faktur tak ditemukan").toBeGreaterThan(0);
    const rute = REKOM.slice(i, i + 1200);
    expect(rute).toMatch(/denganKlaimIdempoten/);
  });
});

describe("gagal di tengah tetap menyegarkan layar", () => {
  it("pembuang komentar tidak memakan kodenya", () => {
    expect(HALAMAN).toContain("onError:");
    // Frasa yang HANYA hidup di komentar. Patokan lamanya ("Belanja dobel")
    // ikut terhapus saat komentar halaman itu diperbarui, sehingga uji ini
    // lolos karena frasanya memang tak ada di mana pun — bukan karena
    // pembuang komentarnya bekerja. Jadi dipatok ke frasa yang masih ada,
    // dan keberadaannya di berkas MENTAH ikut diperiksa supaya tak diam-diam
    // menguap lagi.
    expect(MENTAH).toContain("Penyegarannya tetap ada dan tetap perlu");
    expect(HALAMAN).not.toContain("Penyegarannya tetap ada dan tetap perlu");
  });

  it("`onError` ada dan meng-invalidate", () => {
    const i = HALAMAN.indexOf("onError:");
    expect(i, "onError tak ditemukan").toBeGreaterThan(0);
    const blok = HALAMAN.slice(i, i + 300);
    expect(blok).toMatch(/for \(const key of KUNCI_SEGAR\)/);
    expect(blok).toMatch(/invalidateQueries\(\{ queryKey: \[key\] \}\)/);
  });

  it("sukses dan gagal memakai DAFTAR KUNCI YANG SAMA", () => {
    // Dua daftar terpisah pasti berselisih begitu salah satu ditambahi kunci
    // baru — pelajaran dari `opname-segar-kembar.test.ts`, yang justru lahir
    // dari perbedaan semacam itu.
    expect(HALAMAN.match(/for \(const key of KUNCI_SEGAR\)/g)?.length).toBe(2);
    const i = HALAMAN.indexOf("const KUNCI_SEGAR = [");
    expect(i, "daftar kunci bersama tak ditemukan").toBeGreaterThan(0);
    const daftar = HALAMAN.slice(i, HALAMAN.indexOf("];", i));
    for (const k of ["stok", "rekomendasi", "permintaan-stok", "perlengkapan"]) {
      expect(daftar).toContain(`"${k}"`);
    }
  });

  it("jalur gagal TIDAK mengosongkan rencana & tidak berpindah halaman", () => {
    // Yang gagal harus tetap terlihat beserta pesannya; mengosongkan rencana
    // akan menghapus bukti apa yang belum terjadi.
    const i = HALAMAN.indexOf("onError:");
    const blok = HALAMAN.slice(i, i + 300);
    expect(blok).not.toMatch(/setRencana\(\{\}\)/);
    expect(blok).not.toMatch(/navigate\(/);
  });

  it("galatnya memang tampil di layar", () => {
    expect(HALAMAN).toMatch(/<ErrorText error=\{buat\.error\} \/>/);
  });
});

/**
 * Kembarannya yang sudah benar sejak awal — dialah yang menjadikan absennya
 * `onError` di halaman atas sebuah kelalaian, bukan pilihan desain.
 */
describe("rantai sejenis di ResepPage tetap menyegarkan saat gagal", () => {
  it("ResepPage punya onError yang meng-invalidate", () => {
    const i = RESEP.indexOf("onError:");
    expect(i, "onError ResepPage tak ditemukan").toBeGreaterThan(0);
    expect(RESEP.slice(i, i + 500)).toMatch(/invalidateQueries/);
  });

  it("alasannya masih tertulis di sana — patokan pola rumah ini", () => {
    expect(baca("../../web/src/pages/resep/ResepPage.tsx")).toMatch(
      /Sebagian rantai bisa saja sudah tersimpan sebelum yang gagal/,
    );
  });
});

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { barisBelumSelesai, statusFaktur, TAHAP_BELUM_SELESAI } from "@kakarut/shared";
import { butaKomentar } from "../src/scripts/buta-komentar";

/**
 * RIWAYAT PENGADAAN: TABEL, DAN RINGKASAN YANG MENGHITUNG POPULASI.
 *
 * Pemilik repo meminta riwayat produksi jadi tabel dengan ringkasan "harus
 * dikerjakan / sudah selesai" di atasnya. Dua hal membuat permintaan sederhana
 * itu punya jebakan, dan keduanya dijaga di sini.
 *
 * **1. Ringkasannya tak boleh dihitung dari baris yang tampil.** Daftarnya
 * berhalaman 20 dan server mengurutkan faktur yang belum selesai LEBIH DULU.
 * Terukur 2026-09-03 pada DB gerbang: `/produksi` bertotal 61 faktur, halaman
 * pertamanya memuat 20 faktur dan KEDUA PULUHNYA belum selesai. Ringkasan dari
 * `grup` karena itu tak sekadar meleset — ia akan selalu berbunyi "0 selesai"
 * sampai orangnya menelusuri ke halaman terakhir. Angkanya wajib dari agregat
 * server (`data.ringkas`).
 *
 * **2. Kartu lamanya bukan daftar pasif.** Ia menghitung sepuluh sinyal
 * turunan dan membawa sampai lima tombol. Yang berubah susunannya, bukan
 * kemampuannya: sinyalnya pindah ke `sinyalFaktur` (satu fungsi, dipakai tabel
 * DAN modal detail), dan tiga tombol yang keluar dari baris wajib punya rumah
 * baru di modal itu — tombol yang dibuang tanpa tempat lain adalah kemampuan
 * yang hilang diam-diam.
 */

/*
 * Jalurnya ditulis UTUH sebagai literal, bukan dirakit dari `${WEB}`:
 * `jangkar-iris.test.ts` menelusuri berkas yang dibaca tiap uji dari teks
 * jalurnya, dan jalur yang dirakit template tak bisa ia petakan — akibatnya
 * jangkar `indexOf` di bawah dinyatakan "tak ada di sumber mana pun".
 */
const baca = (rel: string) =>
  butaKomentar(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"));
const WEB = fileURLToPath(new URL("../../web/src", import.meta.url));
const HAL = baca("../../web/src/pages/produksi/TambahStokPage.tsx");
/*
 * RUMAH KETIGA TOMBOL ITU PINDAH 2026-09-03, dan berkas ini merah karenanya —
 * bukan hampa. Modal detail (`FakturDetailModal.tsx`) DIHAPUS dan digantikan
 * halaman dokumennya sendiri (`FakturDetailPage.tsx`, ber-URL supaya bisa
 * dicetak & tautannya dikirim). Yang dijaga uji ini tak berubah sedikit pun —
 * "tombol yang keluar dari baris punya rumah baru" — cuma alamat rumahnya.
 */
const HALDETAIL = baca("../../web/src/pages/produksi/FakturDetailPage.tsx");
const LAYOUT = baca("../../web/src/components/Layout.tsx");
const TIM = baca("../../web/src/pages/TimBerandaPage.tsx");

/** Badan `kolomPengadaan()` saja — supaya `judul:` di tempat lain tak ikut terhitung. */
function badanKolom(): string {
  const i = HAL.indexOf("export function kolomPengadaan(");
  expect(i, "kolomPengadaan tak ditemukan").toBeGreaterThan(-1);
  const j = HAL.indexOf("\nexport function ", i + 1);
  return HAL.slice(i, j === -1 ? undefined : j);
}

describe("aturan tahap: satu rumah, bukan empat salinan", () => {
  it("`menunggu` BELUM selesai di kedua jalur", () => {
    /*
     * Label produksi untuk tahap ini berbunyi "✅ Selesai — masuk stok", dan
     * itu ASPIRASI bukan keadaan: `POST /tahap` meng-auto-konfirmasi baris
     * CK-lokal di dalam transaksi yang sama, jadi baris yang benar-benar DUDUK
     * di `menunggu` hampir selalu work-order yang belum sampai ke cabang.
     * Tanpa asersi ini, "menunggu" gampang dipindah ke sisi "selesai" oleh
     * siapa pun yang membaca labelnya saja — dan angka ringkasannya berubah.
     */
    expect(barisBelumSelesai("menunggu"), "menunggu = belum sampai, bukan beres").toBe(true);
    expect(barisBelumSelesai("rencana")).toBe(true);
    expect(barisBelumSelesai("dikerjakan")).toBe(true);
    expect(barisBelumSelesai("dikonfirmasi")).toBe(false);
    // `ditolak` terminal-tapi-tak-bahagia: bukan tugas tersisa, bukan keberhasilan.
    expect(barisBelumSelesai("ditolak")).toBe(false);
    expect([...TAHAP_BELUM_SELESAI]).toEqual(["rencana", "dikerjakan", "menunggu"]);
  });

  it("status faktur diturunkan dari baris-barisnya", () => {
    expect(statusFaktur([{ status: "rencana" }, { status: "rencana" }])).toBe("rencana");
    // ada yang sudah selesai TAPI masih ada yang belum → sisa tugasnya yang menang
    expect(statusFaktur([{ status: "dikerjakan" }, { status: "dikonfirmasi" }])).toBe(
      "selesai_sebagian",
    );
    expect(statusFaktur([{ status: "dikonfirmasi" }, { status: "ditolak" }])).toBe("sebagian");
  });

  it("dua salinan lama sudah TIDAK ada lagi", () => {
    /*
     * `Layout.tsx` dan `TimBerandaPage.tsx` sama-sama menyimpan
     * `const BELUM_SELESAI = new Set([...])` byte-per-byte identik. Ringkasan
     * putaran ini akan jadi salinan KEEMPAT kalau keduanya tak dibuang dulu.
     */
    expect(LAYOUT, "Layout.tsx masih punya salinannya").not.toMatch(/const BELUM_SELESAI\b/);
    expect(TIM, "TimBerandaPage.tsx masih punya salinannya").not.toMatch(/const BELUM_SELESAI\b/);
    expect(LAYOUT).toContain("barisBelumSelesai(r.status)");
    expect(TIM).toContain("barisBelumSelesai(r.status)");
    // Bentuk `new Set(...).size` DIPERTAHANKAN: ia menghitung FAKTUR (bukan
    // baris), dan sapuan `kueri-web.ts` mengenali pembantu satu-lompatan yang
    // berakhir `.size`.
    expect(LAYOUT).toContain(".map((r) => r.faktur_id)).size");
  });
});

describe("riwayat pengadaan dirender TABEL", () => {
  it("kolomnya dibangun fungsi tersendiri, dan urutannya dipaku", () => {
    // Urutan sumber memuat KEDUA cabang `tipe`: Divisi hanya untuk produksi,
    // Nilai hanya untuk beli (produksi sengaja tak menampilkan uang — bahannya
    // sudah dibeli di Beli Bahan Baku).
    const judul = [...badanKolom().matchAll(/judul: "([^"]+)"/g)].map((m) => m[1]);
    expect(judul).toEqual([
      "Dokumen",
      "Dibuat",
      "Bahan",
      "Tahap",
      "Lokasi",
      "Divisi",
      "Nilai",
      "Orang",
      "Aksi",
    ]);
  });

  it("Divisi khusus produksi, Nilai khusus beli", () => {
    const b = badanKolom();
    expect(b).toMatch(/tipe === "produksi"[\s\S]{0,400}?judul: "Divisi"/);
    expect(b).toMatch(/judul: "Nilai"/);
    // Uang tak boleh bocor ke jalur produksi lewat kolom Nilai.
    expect(b.indexOf('judul: "Divisi"')).toBeLessThan(b.indexOf('judul: "Nilai"'));
  });

  it("memakai TabelResponsif dengan galat + klik baris, bukan tumpukan Card", () => {
    expect(HAL).toContain("<TabelResponsif");
    // "GAGAL MEMUAT ≠ TIDAK ADA": tanpa `galat`, bacaan yang gagal terlihat
    // persis seperti "belum ada produksi". Sapuan `gagal-muat-bukan-kosong`
    // menuntutnya juga.
    expect(HAL).toContain("galat={daftarGagal}");
    // Baris → HALAMAN dokumennya (2026-09-03; sebelumnya modal). Yang dijaga
    // tetap sama: baris harus bisa diklik dan sampai ke detailnya.
    expect(HAL).toMatch(/onKlikBaris=\{\(g\) => navigate\(/);
    expect(HAL).toContain("g.fakturId ?? g.key");
    // Kartu lama membungkus tiap faktur dengan <Card onClick=...>; kalau pola
    // itu kembali, tabelnya sudah tak jadi tabel lagi.
    expect(HAL).not.toMatch(/<Card\s+key=\{g\.key\}/);
  });

  it("sinyal faktur diekstrak, bukan dihitung ulang di dalam .map", () => {
    expect(HAL).toContain("export function sinyalFaktur(");
    // Dipakai DUA berkas: kolom tabel di sini, halaman detail di sebelah.
    // Kalau salah satunya menilai sendiri, tombol yang muncul untuk faktur
    // yang sama bisa berbeda — dan yang salah tak kelihatan sampai dicari.
    expect((HAL.match(/sinyalFaktur\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(HALDETAIL).toContain("sinyalFaktur(");
    expect(HAL).not.toMatch(/grup\.map\(\(g\) => \{[\s\S]{0,200}?const campuran =/);
  });

  it("peringatan kiriman menggantung tetap KALIMAT, bukan sekadar warna", () => {
    /*
     * Warna baris saja tak bisa dibaca oleh siapa pun yang tak tahu artinya,
     * dan yang perlu diketahui adalah APA yang harus dilakukan. Kalimatnya
     * tinggal di sel Tahap; warnanya tambahan, bukan pengganti.
     */
    expect(badanKolom()).toContain("Barang tidak sampai ke cabang.");
    expect(badanKolom()).toContain("Penerimaan Barang");
    expect(HAL).toMatch(/kelasBaris=\{[\s\S]{0,200}?fakturBermasalah\.has/);
  });
});

describe("ubin ringkasan", () => {
  it("angkanya dari agregat SERVER, bukan dari baris yang tampil", () => {
    expect(HAL).toContain("data.ringkas.harus_dikerjakan.faktur");
    expect(HAL).toContain("data.ringkas.selesai.faktur");
    // Dan TIDAK dijumlahkan dari `grup` — itu yang akan berbunyi "0 selesai"
    // selamanya, sebab halaman pertama justru berisi yang belum selesai.
    expect(HAL).not.toMatch(/grup\.filter\([\s\S]{0,80}?belumSelesai[\s\S]{0,40}?\)\.length/);
  });

  it("TIDAK dirender saat bacaannya gagal", () => {
    // "0 harus dikerjakan" jauh lebih percaya diri daripada tabel kosong di
    // bawahnya, dan salah. Aturan yang sama dipegang kartu ringkasan Stok.
    expect(HAL).toMatch(/\{!daftarGagal && data\?\.ringkas && total > 0 && \(/);
  });

  it("saringan yang aktif disebut di labelnya", () => {
    // Ringkasan yang diam-diam ikut menyempit saat rentang tanggal terisi akan
    // terbaca sebagai keadaan seluruh dapur.
    expect(HAL).toContain('const labelRentang = dari || sampai ? " (rentang)" : "";');
    expect(HAL).toContain("`Harus dikerjakan${labelRentang}`");
    expect(HAL).toContain("`Sudah selesai${labelRentang}`");
  });

  it("memakai StatCard bersama, tak mendeklarasikan ubinnya sendiri", () => {
    // Bentuk kartu ini pernah disalin empat kali sebelum diekstrak; putaran ini
    // tak menambah yang kelima.
    expect(HAL).not.toMatch(/function StatCard\b/);
    expect(HAL).toContain("<StatCard");
  });

  it("ubin ketiga menyebut yang selesai TAPI belum sampai", () => {
    /*
     * Tiga keadaan bersembunyi di balik "selesai" yang tak akan disebut selesai
     * oleh pemiliknya: hasil `untuk_cabang` yang belum di-kirim-hasil, barang
     * yang sudah dikirim tapi belum diterima, dan kiriman menggantung. Stok yang
     * tak bisa dipakai siapa pun sementara papan menyatakan pekerjaannya beres.
     */
    expect(HAL).toContain("Selesai tapi belum sampai");
    expect(HAL).toContain("data.ringkas.belum_sampai.faktur");
  });
});

describe("tombol yang keluar dari baris punya rumah baru", () => {
  it("ketiganya ada di HALAMAN detail", () => {
    expect(HALDETAIL).toContain("Dokumen RAB");
    expect(HALDETAIL).toContain("Dokumen belanja");
    expect(HALDETAIL).toContain("Laporan Harga");
    expect(HALDETAIL).toContain("Dokumen kirim");
  });

  it("modal lamanya benar-benar tak ada lagi, dan tak ada yang mengimpornya", () => {
    // Rumah kedua yang menganggur adalah rumah yang kelak diisi lagi diam-diam.
    expect(existsSync(join(WEB, "pages/produksi/FakturDetailModal.tsx"))).toBe(false);
    expect(HAL).not.toContain("FakturDetailModal");
  });

  it("kelayakannya dinilai `sinyalFaktur` yang sama dengan tabelnya", () => {
    // Dua penilaian terpisah akan menampilkan tombol yang berbeda untuk faktur
    // yang sama — dan yang salah tak akan pernah kelihatan sampai ada yang
    // mencarinya.
    expect(HALDETAIL).toContain("sinyalFaktur(grup, tipe,");
    expect(HALDETAIL).toMatch(/sinyal\.bisaLapor/);
    expect(HALDETAIL).toMatch(/sinyal\.adaTerkirim/);
  });

  it("yang dipakai tiap hari TETAP di baris", () => {
    // Ubah Tahap & Kirim: menunda keduanya mahal — kiriman yang menunggu di CK
    // adalah stok yang tak bisa dipakai siapa pun.
    const b = badanKolom();
    expect(b).toContain("➡ Ubah Tahap");
    expect(b).toContain("🚚 Kirim");
    expect(b).toContain('aria-label="Ubah tahap faktur"');
  });
});

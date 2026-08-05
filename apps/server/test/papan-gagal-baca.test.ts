import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Penjaga "GAGAL MEMUAT ≠ TIDAK ADA" pada PAPAN PESANAN — layar tempat
 * bedanya paling mahal.
 *
 * Aturannya sudah dipatuhi `RiwayatModal` DI BERKAS YANG SAMA, lengkap dengan
 * komentar yang menjelaskan kenapa. Papannya sendiri belum: saat bacaan
 * pertama gagal, `data` undefined → `rows` kosong, dan layar mengucapkan TIGA
 * pernyataan sekaligus —
 *
 *   - ketiga kolom berbunyi "Kosong.",
 *   - penghitungnya menulis "0 pesanan",
 *   - dan **0** sajian masih dikerjakan, dalam huruf tebal.
 *
 * Yang berbahaya bukan kalimatnya, melainkan tindakan yang disimpulkan
 * darinya: papan kosong berarti tak ada yang perlu dimasak. Dokumentasi
 * halaman itu sendiri menyebutnya "satu-satunya layar yang keterlambatannya
 * berujung makanan tak dibuat".
 *
 * Bacaan pertama yang gagal juga bukan kasus langka di sini. Kunci query-nya
 * memuat cabang DAN tanggal, jadi kunci BARU tanpa cache lahir setiap kali
 * cabang diganti, tanggal dipilih, dan — yang paling penting — hari berganti
 * lewat tengah malam. Persis momen yang penjaga tanggal di halaman itu ada
 * untuk menyelamatkannya.
 */
const baca = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const PAPAN = baca("../../web/src/pages/pesanan/PesananPage.tsx");

describe("dua bentuk kegagalan dibedakan — dan itu intinya", () => {
  it("gagal TOTAL = ada galat DAN tak ada data sama sekali", () => {
    expect(PAPAN).toContain("const gagalTotal = error != null && data === undefined;");
  });

  it("gagal MENYEGARKAN = ada galat tapi kartunya masih ada", () => {
    // Kartu yang sudah termuat itu NYATA (mungkin basi); menyembunyikannya
    // akan mengosongkan papan justru saat dapur sedang bekerja.
    expect(PAPAN).toContain("const gagalSegar = error != null && data !== undefined;");
  });
});

describe("papan yang tak terbaca tidak menyatakan dirinya kosong", () => {
  it("percabangan gagal MENDAHULUI tiga kolomnya", () => {
    const iGagal = PAPAN.indexOf(") : gagalTotal ? (");
    const iKolom = PAPAN.indexOf('<div className="grid gap-3 md:grid-cols-3">');
    expect(iGagal, "percabangan gagal tak ditemukan").toBeGreaterThan(0);
    expect(iKolom).toBeGreaterThan(iGagal);
  });

  it("kalimatnya membantah kesimpulan yang berbahaya, bukan cuma melapor", () => {
    expect(PAPAN).toContain("Papan tidak terbaca");
    expect(PAPAN).toContain("bukan</b> berarti tidak ada pesanan");
    expect(PAPAN).toContain("Jangan menyimpulkan dapur sedang kosong dari layar ini.");
  });

  it("dan menyebut langkah berikutnya yang benar-benar bisa dilakukan", () => {
    // "Coba lagi" tak berguna di layar yang memang memoles ulang sendiri;
    // yang berguna adalah sumber kebenaran lain yang ada di ruangan itu.
    expect(PAPAN).toContain("tanyakan kasir");
  });

  it("penghitung 'sajian masih dikerjakan' tidak lagi menulis 0", () => {
    const i = PAPAN.indexOf("{gagalTotal ? (");
    const blok = PAPAN.slice(i, PAPAN.indexOf("sajian masih dikerjakan", i));
    expect(i, "cabang penghitung tak ditemukan").toBeGreaterThan(0);
    expect(blok).toContain("jumlah pesanan tidak terbaca");
  });

  it("chip pemilih ponsel juga tak memajang '(0)' bertiga", () => {
    expect(PAPAN).toContain('${gagalTotal ? "hidden" : "flex"}');
  });

  it("kalimat 'Kosong.' TETAP ada — untuk kolom yang memang kosong", () => {
    // Ini bukan penghapusan keadaan kosong; hanya pemisahan dua sebab.
    expect(PAPAN).toContain(">Kosong.</Card>");
  });
});

describe("penyegaran yang gagal: kartunya tetap tampil, tapi diamnya dijelaskan", () => {
  it("ada peringatan bahwa papan berhenti bergerak", () => {
    // Papan ini memoles ulang tiap 15 detik. Kalau pemolesannya diam-diam
    // gagal, layar yang tidak berubah terbaca "tak ada pesanan baru".
    expect(PAPAN).toContain("{gagalSegar && (");
    expect(PAPAN).toContain("berhenti menyegarkan");
    // Frasa yang TIDAK terpenggal pembungkus baris JSX. Dua kali sebelumnya
    // (ronde 55 & 75) asersi seperti ini merah bukan karena kodenya salah,
    // melainkan karena kalimatnya kebetulan patah di tengah.
    expect(PAPAN).toContain("terakhir yang berhasil");
    expect(PAPAN).toContain("belum tentu terlihat");
  });

  it("dan kartunya TIDAK disembunyikan oleh keadaan itu", () => {
    // Yang menyembunyikan kolom hanyalah `gagalTotal`.
    expect(PAPAN).not.toContain(") : gagalSegar ? (");
  });
});

/** Preseden di berkas yang sama — aturannya memang sudah dianut di sini. */
describe("konsisten dengan RiwayatModal di berkas yang sama", () => {
  it("modal riwayat sudah mendahulukan cabang galatnya", () => {
    const iErr = PAPAN.indexOf("{error ? (");
    const iKosong = PAPAN.indexOf("Belum ada perubahan status pada pesanan ini.");
    expect(iErr).toBeGreaterThan(0);
    expect(iKosong).toBeGreaterThan(iErr);
  });
});

/**
 * Premis yang membuat bacaan pertama gagal bukan kasus langka: kuncinya
 * berganti tiap pergantian cabang/tanggal, termasuk lewat tengah malam.
 */
describe("premis: kunci query berganti, jadi cache kosong itu wajar", () => {
  it("kunci memuat cabang dan tanggal", () => {
    expect(PAPAN).toContain('const kunci = ["pesanan", branchQuery, tanggal];');
  });

  it("dan tanggalnya memang ikut jam dinding", () => {
    expect(PAPAN).toContain("setInterval(() => setHariIni(hariIniWIB()), 60_000)");
  });
});

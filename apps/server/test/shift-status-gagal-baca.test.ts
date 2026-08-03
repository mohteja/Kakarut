import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Penjaga "TIDAK TERBACA ≠ BELUM ADA SHIFT" di layar Tutup Kasir.
 *
 * Layar ini beda dari layar-layar lain yang pernah kena pola sama, dan bedanya
 * yang membuatnya paling tajam: `GET /shift/aktif` MEMANG boleh memulangkan
 * `null` saat tak ada shift terbuka. Justru kontrak itu yang menyembunyikan
 * cacatnya — permintaan yang DITOLAK mendarat sebagai `undefined`, dan setiap
 * ungkapan di halaman ini memperlakukan keduanya sama persis:
 *
 *     {!aktif ? …}                → cabang "Belum ada shift terbuka"
 *     const terkunci = aktif != null && aktif.uang_fisik != null
 *     selisihInfo(aktif?.selisih ?? null)
 *
 * Akibatnya kasir yang shift-nya SEDANG berjalan dibawa ke satu-satunya aksi
 * yang mustahil berhasil — "Buka Kasir", yang pasti ditolak indeks unik parsial
 * `shifts_open_per_branch_uq … WHERE closed_at IS NULL` — dan dijauhkan dari
 * aksi yang justru ia butuhkan: Tutup & setor, satu-satunya jalan
 * mempertanggungjawabkan isi laci.
 *
 * `refetchInterval` membuatnya bisa terjadi di TENGAH sesi, bukan cuma saat
 * halaman dibuka. Dan itu tepat mematahkan alasan `terkunci` dibaca dari
 * `aktif.uang_fisik` alih-alih state React (halaman ini menuliskan alasannya
 * sendiri: supaya refresh mendarat di langkah yang sama). Kasir yang sudah
 * mengunci hitungannya mendadak melihat layar kembali ke "Buka Kasir".
 */
const baca = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const HAL = baca("../../web/src/pages/kasir/ShiftPage.tsx");
const KODE = HAL.replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/[^\n]*/g, "");

describe("premis: inilah yang membuat gagal-baca tak bisa dibedakan dari 'belum ada'", () => {
  it("endpointnya memang boleh memulangkan null", () => {
    expect(KODE).toContain("api<Shift | null>(`/shift/aktif${branchQuery}`)");
  });

  it("dan halaman ini memang memoles ulang berkala, jadi bisa berbalik di tengah sesi", () => {
    expect(KODE).toMatch(/refetchInterval: 30_000/);
  });

  it("status terkunci memang dibaca dari server, bukan dari state React", () => {
    // Itu sifat yang benar — dan justru sifat itu yang dipatahkan bacaan gagal.
    expect(KODE).toContain("const terkunci = aktif != null && aktif.uang_fisik != null");
  });

  it("server memang cuma mengizinkan satu shift terbuka per cabang", () => {
    // Yang membuat "Buka Kasir" bukan sekadar salah tawaran, tapi jalan buntu.
    const schema = baca("../src/db/schema.ts");
    const i = schema.indexOf('uniqueIndex("shifts_open_per_branch_uq")');
    expect(i, "indeks unik parsialnya tak ditemukan").toBeGreaterThan(0);
    // PARSIAL — `WHERE closed_at IS NULL`. Tanpa klausa itu indeksnya akan
    // melarang shift KEDUA yang sudah ditutup pun, dan larangan "cuma satu
    // yang TERBUKA" yang jadi taruhan uji ini tidak lagi berlaku.
    expect(schema.slice(i, i + 200)).toContain("IS NULL");
  });
});

describe("shift aktif: gagal dibaca dikatakan apa adanya", () => {
  it("galatnya diambil dari useQuery, bukan dibuang", () => {
    expect(KODE).toMatch(/data: aktif, isLoading, error: gagalAktif/);
  });

  it("percabangan gagal MENDAHULUI percabangan 'belum ada'", () => {
    // Urutannya yang menentukan. Kalau terbalik, `undefined` tetap jatuh ke
    // kalimat "Belum ada shift terbuka" persis seperti sebelum perbaikan.
    const iGagal = KODE.indexOf("{gagalAktif ? (");
    const iKosong = KODE.indexOf(") : !aktif ? (");
    expect(iGagal, "percabangan gagal tak ditemukan").toBeGreaterThan(0);
    expect(iKosong).toBeGreaterThan(iGagal);
  });

  it("dan tidak lagi menawarkan Buka Kasir saat statusnya tak diketahui", () => {
    // Tombolnya hanya boleh hidup di cabang `!aktif` yang SUDAH dipastikan
    // bukan galat — jadi ia harus berada sesudah percabangan gagal.
    const iGagal = KODE.indexOf("{gagalAktif ? (");
    const iTombol = KODE.indexOf("🔓 Buka Kasir");
    expect(iTombol).toBeGreaterThan(iGagal);
  });

  it("mengatakan akibatnya, bukan cuma 'terjadi kesalahan'", () => {
    expect(KODE).toContain("tidak terbaca");
    expect(KODE).toContain("Tutup &amp; setor");
    expect(KODE).toMatch(/<ErrorText error=\{gagalAktif\} \/>/);
  });

  it("menenangkan soal hitungan yang sudah dikunci — itu hidup di server", () => {
    expect(KODE).toContain("tetap tersimpan di server");
  });
});

describe("riwayat shift", () => {
  it("galatnya diambil", () => {
    expect(KODE).toMatch(/data: riwayat = \[\], error: gagalRiwayat/);
  });

  it("tidak lagi berkata 'belum ada shift ditutup' saat bacaannya ditolak", () => {
    const iGagal = KODE.indexOf("{gagalRiwayat ? (");
    const iKosong = KODE.indexOf("Belum ada shift ditutup.");
    expect(iGagal).toBeGreaterThan(0);
    expect(iKosong).toBeGreaterThan(iGagal);
    // Kalimat lamanya tetap ada — untuk riwayat yang MEMANG kosong.
    expect(KODE).toContain("Belum ada shift ditutup.");
  });
});

/** Sifat sekitarnya yang sudah benar dan tak boleh ikut rusak. */
describe("penjagaan tetangga tetap utuh", () => {
  it("hitung buta: angka kas ditutup sampai hitungan dikunci", () => {
    expect(KODE).toMatch(/function rp\(n: number \| null\)/);
    expect(KODE).toContain('value={rp(aktif.kas_sistem)}');
    expect(KODE).toContain('value={rp(aktif.penjualan_tunai)}');
  });

  it("nominal terkunci tak pernah dicetak '0' bila ternyata kosong", () => {
    expect(KODE).toMatch(/aktif\.uang_fisik != null \? formatAngka\(aktif\.uang_fisik, 0\) : ""/);
  });

  it("input rupiah tetap digit murni, bukan type=number", () => {
    expect(KODE).not.toMatch(/type="number"/);
    expect(KODE).toMatch(/replace\(\/\\D\/g, ""\)/);
  });
});

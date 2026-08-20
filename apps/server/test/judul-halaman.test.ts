/**
 * JUDUL TAB per halaman.
 *
 * Seluruh aplikasi memakai satu judul statis dari `index.html` ("Terakasir"),
 * jadi tiap tab terlihat sama persis. Pemilik yang membuka Laporan, Stok, dan
 * Kasir sekaligus — hal biasa — tak bisa membedakan ketiganya selain dengan
 * mengklik satu per satu.
 *
 * Yang dijaga di sini bukan judulnya satu per satu, melainkan hal yang bisa
 * BUSUK: peta judul dan daftar rute ditulis di dua berkas berbeda, jadi rute
 * baru pasti akan ada yang lupa diberi judul. Kalau itu terjadi tabnya diam-diam
 * kembali bernama nama perusahaan saja — kemunduran yang tak pernah ada yang
 * melaporkannya.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JUDUL_RUTE, judulDokumen, judulHalaman, NAMA_APLIKASI } from "../../web/src/lib/judul-halaman";

const baca = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const APP = baca("../../web/src/App.tsx");

/** Pola `path` dari tiap <Route> di App.tsx, kecuali penampung `*`. */
const RUTE = [...APP.matchAll(/<Route path="([^"]+)"/g)]
  .map((m) => m[1])
  .filter((p) => p !== "*");

describe("peta judul menutupi seluruh rute", () => {
  it("dasar: daftar rute memang terbaca dari App.tsx", () => {
    // Tanpa ini, regex yang meleset akan memulangkan daftar KOSONG dan seluruh
    // berkas ini hijau tanpa memeriksa apa pun.
    expect(RUTE.length).toBeGreaterThan(50);
    expect(RUTE).toContain("/laporan");
    expect(RUTE).toContain("/stok");
  });

  it("tiap rute punya judul", () => {
    const tanpaJudul = RUTE.filter((p) => !(p in JUDUL_RUTE));
    expect(tanpaJudul).toEqual([]);
  });

  it("halaman publik yang dilayani lewat pathname juga punya judul", () => {
    // Enam halaman ini keluar lewat `if (pathname === …) return …` di atas
    // gerbang auth, bukan lewat <Route>, jadi regex di atas tak melihatnya.
    for (const p of ["/tentang", "/privasi", "/syarat", "/kontak", "/bantuan", "/verifikasi-email"]) {
      expect(APP).toContain(`pathname === "${p}"`);
      expect(JUDUL_RUTE[p], `judul untuk ${p}`).toBeTruthy();
    }
  });

  it("tak ada judul yatim — kunci yang rutenya sudah tak ada", () => {
    const publik = new Set([
      "/tentang",
      "/privasi",
      "/syarat",
      "/kontak",
      "/bantuan",
      "/verifikasi-email",
    ]);
    const yatim = Object.keys(JUDUL_RUTE).filter((p) => !publik.has(p) && !RUTE.includes(p));
    expect(yatim).toEqual([]);
  });

  it("dan App.tsx memang memasangnya ke document.title", () => {
    expect(APP).toContain("document.title = judulDokumen(pathname, auth?.company?.nama);");
  });
});

describe("judulHalaman", () => {
  it("rute biasa", () => {
    expect(judulHalaman("/laporan")).toBe("Laporan");
    expect(judulHalaman("/stok")).toBe("Stok");
    expect(judulHalaman("/kasir/tutup")).toBe("Tutup Kasir");
  });

  it("rute ber-parameter", () => {
    expect(judulHalaman("/stok/kartu/2f1c8b6e-0000-4000-8000-000000000000")).toBe("Kartu Stok");
    expect(judulHalaman("/menu/abc/edit")).toBe("Ubah Menu");
    expect(judulHalaman("/pengaturan/supplier/abc")).toBe("Kartu Supplier");
  });

  it("yang harfiah menang atas yang ber-parameter", () => {
    // `/bahan/baru` cocok dengan `/bahan/:id` juga. Kalau urutannya terbalik,
    // halaman Tambah Bahan Baku bernama "Detail Bahan".
    expect(judulHalaman("/bahan/baru")).toBe("Tambah Bahan Baku");
    expect(judulHalaman("/bahan/ubah")).toBe("Ubah Bahan Baku");
    expect(judulHalaman("/bahan/abc")).toBe("Detail Bahan");
  });

  it("garis miring di ekor tidak mengubah hasilnya", () => {
    expect(judulHalaman("/laporan/")).toBe("Laporan");
    expect(judulHalaman("/")).toBeNull();
  });

  it("rute tak dikenal → null, bukan tebakan", () => {
    expect(judulHalaman("/entah-apa")).toBeNull();
  });
});

describe("judulDokumen", () => {
  it("bentuknya '<Halaman> | <Perusahaan>'", () => {
    expect(judulDokumen("/laporan", "Basooopa")).toBe("Laporan | Basooopa");
  });

  it("belum ada perusahaan (layar auth & halaman publik) → nama aplikasi", () => {
    expect(judulDokumen("/login", null)).toBe(`Masuk | ${NAMA_APLIKASI}`);
    expect(judulDokumen("/privasi", undefined)).toBe(`Kebijakan Privasi | ${NAMA_APLIKASI}`);
  });

  it("nama perusahaan kosong/spasi diperlakukan seperti tak ada", () => {
    expect(judulDokumen("/laporan", "   ")).toBe(`Laporan | ${NAMA_APLIKASI}`);
  });

  it("rute tak dikenal → identitasnya saja, bukan 'undefined'", () => {
    expect(judulDokumen("/", "Basooopa")).toBe("Basooopa");
    expect(judulDokumen("/entah-apa", null)).toBe(NAMA_APLIKASI);
  });
});

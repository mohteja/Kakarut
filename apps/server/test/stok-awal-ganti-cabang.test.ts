import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Penjaga GANTI CABANG di halaman Stok Awal.
 *
 * Halaman ini hidup di dalam Layout, dan Layout memuat pemilih cabang — jadi
 * owner bisa berpindah cabang TANPA meninggalkan halaman ini. Kedua query
 * sudah berkunci `branchQuery`, jadi daftar bahan dan nilai tersimpannya ikut
 * berganti sendiri.
 *
 * Yang TIDAK ikut adalah `awal` (qty yang diketik) dan `tanggal`: keduanya
 * state lokal, dan penyemainya dikunci `terisiAwal` — sebuah latch yang
 * menyala sekali lalu selamanya. Akibatnya angka cabang LAMA tetap duduk di
 * form sementara judul halaman sudah menampilkan nama cabang BARU, lalu
 * Simpan mengirim `branch_id` cabang baru bersama qty cabang lama.
 *
 * Kiriman itu tidak ditolak: `ingredient_id` berlaku se-perusahaan (yang
 * per-cabang adalah stoknya, berkunci `[ingredientId, branchId]`), jadi
 * angkanya mendarat di baris yang nyata.
 *
 * Dan yang ditimpa bukan angka biasa — saldo pembuka adalah GARIS DASAR yang
 * dijadikan jangkar semua hitungan stok sesudahnya.
 */
const baca = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const tanpaKomentar = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const HALAMAN = tanpaKomentar(baca("../../web/src/pages/stok/StokAwalPage.tsx"));
const LAYOUT = tanpaKomentar(baca("../../web/src/components/Layout.tsx"));
const APP = tanpaKomentar(baca("../../web/src/App.tsx"));

describe("premis: cabang memang bisa berganti di bawah halaman ini", () => {
  it("Layout memuat pemilih cabang yang mengubah branchId", () => {
    expect(LAYOUT).toMatch(/setBranchId\(e\.target\.value\)/);
  });

  it("halaman Stok Awal dirender DI DALAM Layout", () => {
    const iLayout = APP.indexOf("<Route element={<Layout />}>");
    const iAwal = APP.indexOf('path="/stok/awal"');
    expect(iLayout, "blok Layout tak ditemukan").toBeGreaterThan(0);
    expect(iAwal, "rute /stok/awal tak ditemukan").toBeGreaterThan(iLayout);
  });

  it("kedua query berkunci cabang — jadi DATA ikut berganti, state lokal tidak", () => {
    expect(HALAMAN).toMatch(/queryKey: \["stok", branchQuery\]/);
    expect(HALAMAN).toMatch(/queryKey: \["stok-awal", branchQuery\]/);
  });

  it("judul halaman memakai cabang AKTIF — jadi layarnya terlihat benar", () => {
    // Inilah yang membuat cacatnya sunyi: header sudah cabang baru.
    expect(HALAMAN).toMatch(/cabang\.find\(\(b\) => b\.id === branchId\)\?\.nama/);
  });

  it("yang dikirim memang branch_id aktif + qty dari state lokal", () => {
    const i = HALAMAN.indexOf("const simpan = useMutation");
    expect(i).toBeGreaterThan(0);
    const blok = HALAMAN.slice(i, i + 700);
    expect(blok).toMatch(/branch_id: branchId/);
    expect(blok).toMatch(/Object\.entries\(awal\)/);
  });
});

describe("ganti cabang membuang ketikan cabang lama", () => {
  it("pembuang komentar tidak memakan kodenya", () => {
    expect(HALAMAN).toContain("const cabangSebelum");
    expect(HALAMAN).not.toContain("GARIS DASAR");
  });

  it("ada efek yang bereaksi pada perubahan branchId", () => {
    const i = HALAMAN.indexOf("const cabangSebelum");
    expect(i, "penjaga ganti cabang tak ditemukan").toBeGreaterThan(0);
    const blok = HALAMAN.slice(i, HALAMAN.indexOf("}, [branchId]);", i));
    expect(blok).toMatch(/if \(cabangSebelum\.current === branchId\) return;/);
    expect(blok).toMatch(/cabangSebelum\.current = branchId;/);
  });

  it("qty & tanggal dibuang, dan latch penyemai dilepas", () => {
    const i = HALAMAN.indexOf("const cabangSebelum");
    const blok = HALAMAN.slice(i, HALAMAN.indexOf("}, [branchId]);", i));
    // Tanpa melepas latch-nya, form tetap kosong selamanya di cabang baru —
    // saldo pembuka yang SUDAH ada di sana tak pernah tampil untuk diedit.
    expect(blok).toMatch(/terisiAwal\.current = false;/);
    expect(blok).toMatch(/setAwal\(\{\}\)/);
    expect(blok).toMatch(/setTanggal\(hariIniWIB\(\)\)/);
  });

  it("layar sukses & dialog konfirmasi ikut disetel ulang", () => {
    // "Tersimpan" milik cabang lama tak boleh menempel di cabang baru.
    const i = HALAMAN.indexOf("const cabangSebelum");
    const blok = HALAMAN.slice(i, HALAMAN.indexOf("}, [branchId]);", i));
    expect(blok).toMatch(/setSelesai\(false\)/);
    expect(blok).toMatch(/setKonfirmasi\(false\)/);
  });
});

/**
 * Penjaga sejenis di dua halaman lain — merekalah yang menjadikan absennya di
 * Stok Awal sebuah kelalaian, bukan pilihan desain.
 */
describe("pola rumahnya tetap ada di halaman lain", () => {
  it.each([
    "../../web/src/pages/kasir/KasirPage.tsx",
    "../../web/src/pages/produksi/FakturFormPage.tsx",
  ])("%s masih menjaga pergantian cabang", (berkas) => {
    const src = tanpaKomentar(baca(berkas));
    expect(src).toMatch(/cabangSebelum\.current === branchId/);
    expect(src).toMatch(/cabangSebelum\.current = branchId/);
  });
});

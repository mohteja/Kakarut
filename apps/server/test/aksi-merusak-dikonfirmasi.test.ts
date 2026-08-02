import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Penjaga KONFIRMASI pada aksi yang merusak.
 *
 * Aplikasi ini punya kebiasaan yang konsisten: yang merusak selalu bertanya
 * dulu. Menghapus SATU member bertanya, membersihkan log galat bertanya
 * sekalian menyebut "Tidak bisa dibatalkan".
 *
 * Satu aksi terlewat justru yang paling merusak. "Tangguhkan" di panel Tenant
 * menyetel `companies.is_active = false`, dan gerbang sesi menyaring kolom itu
 * (`eq(companies.isActive, true)` di middleware auth) — jadi seluruh pengguna
 * perusahaan itu SEKETIKA dijawab 401, termasuk kasir yang sedang melayani
 * antrean dengan bill terbuka. Tombolnya duduk di kolom yang sama pada tiap
 * baris tenant, sehingga salah baris berarti mematikan perusahaan yang salah.
 *
 * Konfirmasinya wajib MENYEBUT NAMA tenant. Pertanyaan umum ("Yakin?") tak
 * menolong pada tabel yang seluruh barisnya menampilkan tombol serupa —
 * yang harus dibaca orang sebelum menekan OK adalah nama perusahaannya.
 */
const baca = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")
    // Komentar dibuang: yang dijaga kodenya, bukan penjelasannya. (Pelajaran
    // dari `semai-saat-buka.test.ts`, yang versi pertamanya memeriksa prosa.)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

const TENANTS = baca("../../web/src/pages/superadmin/TenantsPage.tsx");

describe("menangguhkan tenant bertanya lebih dulu", () => {
  it("pembuang komentar tidak memakan kodenya", () => {
    expect(TENANTS).toContain("toggle.mutate(t)");
    expect(TENANTS).not.toContain("MENANGGUHKAN = MENGUNCI");
  });

  it("toggle hanya berjalan di dalam confirm", () => {
    // Bentuk `confirm(...) → toggle.mutate` di satu tarikan. Kalau tombolnya
    // kembali memanggil `toggle.mutate` langsung, ini merah.
    expect(TENANTS).toMatch(/if \(confirm\([\s\S]{0,80}?\)\) toggle\.mutate\(t\)/);
    expect(TENANTS).not.toMatch(/onClick=\{\(\) => toggle\.mutate\(t\)\}/);
  });

  it("pesannya menyebut NAMA tenant, bukan pertanyaan umum", () => {
    /*
     * Dicari DI DALAM pesannya, bukan di seluruh berkas.
     *
     * Versi pertama uji ini hanya mencari `${t.nama}` di mana pun — dan tetap
     * hijau saat pesannya diganti "Yakin?", karena nama yang sama juga hidup
     * di `aria-label` kolom Plan. Yang cocok bukan yang dijaga.
     */
    const i = TENANTS.indexOf("const pesan =");
    expect(i, "penyusunan pesan konfirmasi tak ditemukan").toBeGreaterThan(0);
    const pesan = TENANTS.slice(i, TENANTS.indexOf("if (confirm", i));
    expect(pesan).toMatch(/\$\{t\.nama\}/);
  });

  it("pesannya mengatakan akibatnya, bukan cuma 'yakin?'", () => {
    // Yang menentukan keputusan bukan kata kerjanya, melainkan akibatnya.
    expect(TENANTS).toMatch(/tidak bisa memakai aplikasi/i);
  });
});

/**
 * Aksi merusak lain yang SUDAH benar — dijaga agar tidak diam-diam hilang saat
 * halamannya dirombak. Keduanya inilah yang menjadikan absennya konfirmasi di
 * panel Tenant sebuah kelalaian, bukan pilihan desain.
 */
describe("konfirmasi yang sudah ada tetap ada", () => {
  it("hapus member masih bertanya", () => {
    expect(baca("../../web/src/pages/member/MemberPage.tsx")).toMatch(
      /confirm\("Hapus member ini\?/,
    );
  });

  it("bersihkan log galat masih bertanya + menyebut tak bisa dibatalkan", () => {
    const log = baca("../../web/src/pages/superadmin/ErrorLogPage.tsx");
    expect(log).toMatch(/confirm\("Hapus SEMUA baris log galat\?/);
    expect(log).toMatch(/Tidak bisa dibatalkan/);
  });
});

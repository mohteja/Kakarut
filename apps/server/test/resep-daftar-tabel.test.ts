import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { butaKomentar } from "../src/scripts/buta-komentar";

/**
 * BENTUK DAFTAR RESEP ADALAH TABEL BERKEPALA — DAN KOLOMNYA YANG DIMINTA.
 *
 * Pemilik repo meminta bentuk "☰ Daftar" di /resep berkolom, urut:
 * No · Kode · Nama produk · Harga / produksi · Hasil · Satuan hasil ·
 * Harga / satuan · Bahan baku · Lokasi produksi. Yang dijaga di sini bukan
 * tampilannya (itu urusan Playwright `resep-tampilan.spec.ts`), melainkan
 * tiga keputusan yang mudah tergelincir diam-diam saat kolomnya disunting:
 *
 *   · URUTAN & NAMA kolom — permintaan yang tertulis, bukan selera penyunting;
 *   · UANG BERPAGAR — dua kolom harga hanya dibangun untuk owner/admin,
 *     dengan predikat yang SAMA (`bolehUbah`) seperti seluruh halaman; server
 *     sudah menyaring biaya untuk peran lain, dan layar tak boleh membuka
 *     pagar yang lebih longgar (`biaya-hanya-manajemen.test.ts`);
 *   · HARGA PER SATUAN DARI SERVER — `harga_per_unit` dihitung di
 *     `packages/shared/src/hpp.ts` (pembagi nol terjaga di sana). Membaginya
 *     ulang di klien (`harga_beli / isi`) menduplikasi rumus dan membuka lagi
 *     kelas "pembagi nol jadi nol" yang sudah dibayar.
 *
 * Plus satu tentang komponen tabelnya: klik-baris dipasang di KEDUA tampilan
 * (kartu HP dan `<tr>` desktop) — daftar yang bisa dibuka di laptop tak boleh
 * jadi daftar yang cuma bisa dipandang di HP.
 *
 * Irisan berjangkar KODE, bukan nomor baris (`kunci-daftar-tak-bergeser`).
 */
const baca = (rel: string) =>
  butaKomentar(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"));

const HAL = baca("../../web/src/pages/resep/ResepPage.tsx");
const TABEL = baca("../../web/src/components/TabelResponsif.tsx");

/** Blok fungsi pembangun kolom — dari tanda tangannya sampai komponen halaman. */
function blokKolom(): string {
  const i = HAL.indexOf("function kolomDaftarResep(");
  const j = HAL.indexOf("export function ResepPage(", i);
  expect(i, "premis: kolomDaftarResep ada").toBeGreaterThan(-1);
  expect(j, "premis: ResepPage sesudahnya").toBeGreaterThan(i);
  return HAL.slice(i, j);
}

/** Cabang JSX bentuk daftar — dari syaratnya sampai grid ikon. */
function blokDaftar(): string {
  const i = HAL.indexOf('tampilan === "daftar" ? (');
  const j = HAL.indexOf('<div className="grid gap-3 sm:grid-cols-2', i);
  expect(i, "premis: cabang daftar ada").toBeGreaterThan(-1);
  expect(j, "premis: grid ikon sesudahnya").toBeGreaterThan(i);
  return HAL.slice(i, j);
}

const URUTAN = [
  "No",
  "Kode",
  "Nama produk",
  "Harga / produksi",
  "Hasil",
  "Satuan hasil",
  "Harga / satuan",
  "Bahan baku",
  "Lokasi produksi",
];

describe("resep: bentuk daftar = tabel berkepala dengan kolom yang diminta", () => {
  it("urutan & nama kolom persis permintaan", () => {
    const judul = [...blokKolom().matchAll(/judul: "([^"]+)"/g)].map((m) => m[1]);
    expect(judul).toEqual(URUTAN);
  });

  it("dua kolom uang hanya dibangun di balik `bolehUbah` — predikat yang sama", () => {
    const blok = blokKolom();
    for (const label of ["Harga / produksi", "Harga / satuan"]) {
      const i = blok.indexOf(`judul: "${label}"`);
      expect(i, label).toBeGreaterThan(-1);
      const pagar = blok.lastIndexOf("...(bolehUbah", i);
      expect(pagar, `${label}: tak ada pembungkus bolehUbah`).toBeGreaterThan(-1);
      // tak ada judul lain di antara pembungkus dan label — pagarnya milik kolom ini
      expect(blok.slice(pagar, i).match(/judul:/g) ?? []).toHaveLength(0);
      // dan cabang lainnya kosong: peran lain tak menerima kolom apa pun
      expect(blok.indexOf(": [])", i), `${label}: cabang non-manajemen`).toBeGreaterThan(i);
    }
    expect(HAL).toContain('const bolehUbah = role === "owner" || role === "admin";');
  });

  it("harga per satuan dibaca dari server, tidak dibagi ulang di klien", () => {
    const blok = blokKolom();
    expect(blok).toContain("formatRupiah(b.harga_per_unit)");
    expect(blok).not.toMatch(/\/\s*b\.isi\b|harga_beli\s*\/|hargaPerUnit\(/);
  });

  it("cabang daftar memakai TabelResponsif: klik-baris, galat kueri, kalimat kosong", () => {
    const blok = blokDaftar();
    expect(blok).toContain("<TabelResponsif");
    expect(blok).toContain("kolom={kolomDaftarResep({ bolehUbah, ringkas })}");
    expect(blok).toContain("onKlikBaris={(b) => bukaDetail(b.id)}");
    expect(blok).toContain("galat={bahanGagal}");
    expect(blok).toContain('"Belum ada resep aktif." : "Tidak ada yang cocok."');
    expect(blok).not.toContain("<Card");
  });

  it("TabelResponsif: klik-baris dipasang di KEDUA tampilan (kartu HP & <tr>)", () => {
    expect(TABEL).toContain("onKlikBaris?: (baris: T, indeks: number) => void;");
    expect(TABEL.match(/\{\.\.\.propsKlik\(baris, i\)\}/g) ?? []).toHaveLength(2);
  });
});

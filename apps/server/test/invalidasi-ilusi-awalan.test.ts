import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { butaKomentar } from "../src/scripts/buta-komentar";

/**
 * ILUSI AWALAN: `["menu"]` TIDAK pernah mengenai `["menu-riwayat-harga"]`.
 *
 * Pencocokan awalan TanStack Query membandingkan elemen secara UTUH. `["stok"]`
 * cocok dengan `["stok", branchQuery]` — elemen pertamanya sama persis — tapi
 * TIDAK dengan `["stok-fifo", …]`, karena `"stok" !== "stok-fifo"`. Keduanya
 * kunci yang berbeda, bukan induk dan anak.
 *
 * Yang membuat kelas ini pantas dijaga, dan bukan sekadar catatan: repo ini
 * sudah menuliskan aturannya **dua kali**, panjang-panjang, di dua berkas
 * berbeda (`StokPerlengkapanTab` dan `OpnameRiwayatPage`, untuk `perlengkapan`
 * vs `perlengkapan-master`) — dan pintu ketiganya tetap terbuka. Catatan bukan
 * penjaga.
 *
 * Pintu ketiga itu `AnalisisHargaPage`: tombol "Terapkan saran" MENERBITKAN
 * baris riwayat harga (`catatHargaMenu(…, sebab: "terapkan_saran")`), panel
 * yang menampilkannya ada di halaman yang sama dan sedang terbuka, dan
 * invalidasinya menyebut `["menu"]`. Terukur lewat HTTP sungguhan: riwayat
 * **3 → 4 baris** di server, panelnya tetap 3.
 *
 * BUKAN penjaga cakupan invalidasi secara umum — itu tuntutan yang salah, dan
 * versi pertama sapuan ini membuktikannya: aturan "segarkan SEMUA pembaca
 * sumber daya ini" menuduh **70** mutasi, dan hampir semuanya kode yang benar
 * (mengganti nama meja memang tak perlu menyegarkan riwayat pengosongan meja).
 * Yang dijaga di sini hanya kasus yang tak ambigu: berkas yang SAMA
 * meng-invalidate `A` dan MEMBACA `A-…`.
 *
 * Penjaga tetangganya, `invalidate-kunci.test.ts`, menjaga arah sebaliknya —
 * bahwa tiap kunci yang di-invalidate benar-benar dipakai suatu query. Komentar
 * di sana menuliskan batasnya sendiri: *"Ini TIDAK menjamin cakupannya
 * lengkap"*. Berkas ini menutup satu iris dari batas itu.
 */
const WEB = fileURLToPath(new URL("../../web/src/", import.meta.url)).replace(/\/$/, "");

function berkasKode(dir: string): string[] {
  const keluar: string[] = [];
  for (const nama of readdirSync(dir)) {
    const p = join(dir, nama);
    if (statSync(p).isDirectory()) keluar.push(...berkasKode(p));
    else if (/\.tsx?$/.test(nama)) keluar.push(p);
  }
  return keluar;
}



/**
 * Aturan pencocokan TanStack Query, ditulis sebagai fungsi supaya premis
 * penjaga ini bisa DIUJI, bukan cuma dipercaya dari komentar.
 */
export function kunciCocok(saring: readonly string[], kunci: readonly string[]): boolean {
  return saring.length <= kunci.length && saring.every((s, i) => s === kunci[i]);
}

const BERKAS = berkasKode(WEB);
const ISI = new Map(BERKAS.map((p) => [p, butaKomentar(readFileSync(p, "utf8"))]));

const elemenPertama = (s: string, pola: RegExp): Set<string> => {
  const k = new Set<string>();
  for (const m of s.matchAll(pola)) k.add(m[1]);
  return k;
};
const POLA_BACA = /queryKey:\s*\[\s*["'`]([^"'`]+)/g;
const POLA_INVALIDATE = /invalidateQueries\(\{\s*queryKey:\s*\[\s*["'`]([^"'`]+)/g;

/** Semua elemen pertama queryKey yang benar-benar dipakai query di apps/web. */
const SEMUA_KUNCI = new Set<string>();
for (const s of ISI.values()) for (const k of elemenPertama(s, POLA_BACA)) SEMUA_KUNCI.add(k);

/** Pasangan (A, "A-…") — dua kunci berbeda yang TAMPAK seperti induk & anak. */
const PASANGAN: [string, string][] = [];
for (const a of [...SEMUA_KUNCI].sort()) {
  for (const b of [...SEMUA_KUNCI].sort()) {
    if (b !== a && b.startsWith(a + "-")) PASANGAN.push([a, b]);
  }
}

/**
 * Berkas yang meng-invalidate `A` dan membaca `A-…` TANPA menyegarkannya — dan
 * itu memang benar. Tiap baris sudah diperiksa satu per satu; baris baru di
 * sini menuntut alasan yang sama tegasnya.
 */
const DIKECUALIKAN: Record<string, string> = {
  // `hapus` memanggil `navigate("/bahan")` di `onSuccess` — halamannya lepas
  // sebelum kuerinya sempat dibaca lagi. Menyegarkan yang sudah tak tampil
  // hanya menambah satu permintaan yang jawabannya dibuang.
  "pages/bahan/DetailBahanPage.tsx|bahan|bahan-detail": "navigate() keluar halaman",
  "pages/bahan/DetailBahanPage.tsx|stok|stok-fifo": "navigate() keluar halaman",
  // `karyawan-aktivitas` adalah JEJAK AUDIT karyawan (siapa mengubah apa,
  // kapan) — mengubah datanya tidak menulis ulang jejaknya, dan panelnya
  // dibuka sendiri saat dibutuhkan.
  "pages/pengaturan/KaryawanPage.tsx|karyawan|karyawan-aktivitas": "jejak audit, bukan turunan datanya",
  // Detail satu galat dibuka lewat modal dan dimuat saat dibuka; menandai
  // status di daftar tidak mengubah isi galat yang tersimpan.
  "pages/superadmin/ErrorLogPage.tsx|admin-error-log|admin-error-log-detail":
    "modal dimuat saat dibuka; isinya tak berubah oleh penandaan status",
};

interface Situs { file: string; a: string; b: string }

function situs(): Situs[] {
  const keluar: Situs[] = [];
  for (const p of BERKAS) {
    const s = ISI.get(p)!;
    const dibaca = elemenPertama(s, POLA_BACA);
    const diinvalidate = elemenPertama(s, POLA_INVALIDATE);
    for (const [a, b] of PASANGAN) {
      if (diinvalidate.has(a) && dibaca.has(b) && !diinvalidate.has(b)) {
        keluar.push({ file: p.slice(WEB.length + 1), a, b });
      }
    }
  }
  return keluar;
}

describe("invalidateQueries: awalan yang MIRIP bukan awalan", () => {
  it("premis: aturan pencocokannya memang seperti yang diklaim komentar", () => {
    // Kalau asumsi ini salah, seluruh berkas ini menuntut pekerjaan sia-sia.
    // Jadi ia diuji, bukan dipercaya.
    expect(kunciCocok(["stok"], ["stok", "?branch_id=1"])).toBe(true);
    expect(kunciCocok(["stok"], ["stok-fifo", "abc"])).toBe(false);
    expect(kunciCocok(["menu"], ["menu-riwayat-harga", "abc"])).toBe(false);
    expect(kunciCocok(["perlengkapan"], ["perlengkapan-master"])).toBe(false);
  });

  it("premis: pemindainya membaca apps/web dan menemukan pasangannya", () => {
    // Tanpa ini, regex yang tak lagi cocok membuat gerbangnya hijau dengan
    // populasi nol — yaitu izin terbuka, bukan penjagaan.
    expect(SEMUA_KUNCI.size, "tak satu pun queryKey terbaca").toBeGreaterThan(60);
    expect(PASANGAN.length, "tak satu pun pasangan mirip-awalan terbaca").toBeGreaterThan(20);
  });

  it("INTI: yang meng-invalidate A dan membaca A-… harus menyegarkan keduanya", () => {
    const tertuduh = situs().filter((s) => !(`${s.file}|${s.a}|${s.b}` in DIKECUALIKAN));
    expect(
      tertuduh.map((s) => `${s.file}: invalidate ["${s.a}"] tapi membaca ["${s.b}"]`),
      `pencocokan awalan TanStack membandingkan elemen secara UTUH, jadi ` +
        `["A"] TIDAK pernah mengenai ["A-…"]. Layar ini menyegarkan yang satu ` +
        `dan meninggalkan yang lain basi — terukur pada "Terapkan saran": ` +
        `riwayat harga 3 → 4 baris di server, panelnya tetap 3. Sebut kunci ` +
        `keduanya, atau tambahkan barisnya ke DIKECUALIKAN dengan alasannya.`,
    ).toEqual([]);
  });

  it("PASANGAN: pengecualiannya masih berlaku (situsnya masih ada)", () => {
    // Pengecualian yang menunjuk situs yang sudah tak ada adalah lubang yang
    // menganga diam-diam: ia tak pernah merah, dan ia melebarkan izin.
    const ada = new Set(situs().map((s) => `${s.file}|${s.a}|${s.b}`));
    for (const k of Object.keys(DIKECUALIKAN)) {
      expect(ada.has(k), `pengecualian basi: ${k}`).toBe(true);
    }
  });

  it("PASANGAN: pintu yang diperbaiki benar-benar menyebut kuncinya", () => {
    const s = butaKomentar(readFileSync(join(WEB, "pages/menu/AnalisisHargaPage.tsx"), "utf8"));
    expect(s).toContain('invalidateQueries({ queryKey: ["menu-riwayat-harga"] })');
  });
});

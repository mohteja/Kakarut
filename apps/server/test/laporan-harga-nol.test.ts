import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { angkaDari } from "@kakarut/shared";

/**
 * Penjaga HARGA NOL PALSU di Laporan Harga.
 *
 * Di layar ini nol bukan sekadar angka salah — ia angka yang MERAMBAT:
 *
 *   1. `total_harga` baris ditimpa 0, padahal itulah harga per lot yang dipakai
 *      HPP FIFO;
 *   2. centang "Perbarui harga acuan" DEFAULTNYA menyala, jadi acuan bahan
 *      dihitung ulang ke MEDIAN riwayat pembelian — kini memuat pembelian Rp 0;
 *   3. acuan itu, kata kotak centangnya sendiri, dipakai RAB belanja berikutnya
 *      DAN perhitungan HPP semua menu;
 *   4. sesudah dilaporkan fakturnya "Selesai" — pintu perbaikannya tertutup.
 *
 * Bentuk lamanya `angkaDari(...) || 0`, jadi "125rb" mendarat sebagai NOL tanpa
 * satu pun galat. Dan panel dampak di bawahnya dihitung dari `items` yang sama:
 * ia MENAMPILKAN jatuhnya harga acuan itu — dengan warna HIJAU, karena hijau
 * berarti "acuan turun". Panel yang dibuat untuk menangkap kejutan malah
 * melukiskannya sebagai kabar baik.
 */
const baca = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

const MODAL = baca("../../web/src/pages/produksi/LaporanHargaModal.tsx");

describe("premis: NaN dulu mendarat sebagai nol, dan nol itu merambat", () => {
  it("isian harga yang wajar memang NaN", () => {
    for (const t of ["125rb", "1,2jt", "seratus ribu", "125 rb"]) {
      expect(Number.isNaN(angkaDari(t)), t).toBe(true);
    }
  });

  it("`|| 0` memang mengubah NaN jadi nol — bentuk yang dibuang", () => {
    expect(angkaDari("125rb") || 0).toBe(0);
    // ...dan nol itu lolos `Math.max(0, …)` tanpa perlawanan.
    expect(Math.max(0, angkaDari("125rb") || 0)).toBe(0);
  });

  it("centang perbarui acuan memang menyala secara bawaan", () => {
    expect(MODAL).toMatch(/useState\(true\)/);
    expect(MODAL).toMatch(/perbarui_acuan: perbaruiAcuan/);
  });
});

describe("Laporan Harga menahan harga yang tak terbaca", () => {
  it("pembuang komentar tidak memakan kodenya", () => {
    expect(MODAL).toContain("const salahKetik");
    expect(MODAL).not.toContain("melukiskannya sebagai kabar baik");
  });

  it("bentuk `|| 0` sudah tidak ada lagi di penyusunan items", () => {
    // Inti temuannya: selama bentuk itu masih ada, NaN tetap jadi nol.
    expect(MODAL).not.toMatch(/angkaDari\(harga\[r\.id\]\) \|\| 0/);
    expect(MODAL).not.toMatch(/Math\.max\(0, angkaDari/);
  });

  it("items hanya memuat harga yang terbaca ≥ 0", () => {
    expect(MODAL).toMatch(
      /\.filter\(\(r\) => \(harga\[r\.id\] \?\? ""\)\.trim\(\) !== "" && angkaDari\(harga\[r\.id\]\) >= 0\)/,
    );
    expect(MODAL).toMatch(/total_harga: angkaDari\(harga\[r\.id\]\)/);
  });

  it("yang tak terbaca terkumpul terpisah — nol tetap sah", () => {
    const i = MODAL.indexOf("const salahKetik");
    const blok = MODAL.slice(i, MODAL.indexOf(");", i));
    expect(blok).toMatch(/!\(angkaDari\(harga\[r\.id\]\) >= 0\)/);
  });

  it("tombol Simpan terkunci olehnya", () => {
    expect(MODAL).toMatch(/disabled=\{!adaIsi \|\| salahKetik\.length > 0 \|\| simpan\.isPending\}/);
  });

  it("pesannya menyebut BAHAN mana", () => {
    const i = MODAL.indexOf("Harga tidak terbaca pada");
    expect(i, "pesan penjaga tak ditemukan").toBeGreaterThan(0);
    expect(MODAL.slice(i, i + 300)).toMatch(/salahKetik\.map\(\(r\) => r\.bahan\)\.join\(", "\)/);
  });

  it("total yang tampil ikut jujur — dihitung dari items yang sama", () => {
    // Kalau total dihitung sendiri, ia bisa menampilkan angka yang tak pernah
    // dikirim — persis jenis ketidakcocokan yang membuat nol palsu tak terlihat.
    expect(MODAL).toMatch(/const total = items\.reduce\(\(t, it\) => t \+ it\.total_harga, 0\)/);
  });
});

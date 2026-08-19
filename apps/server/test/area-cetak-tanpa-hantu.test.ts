import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/**
 * SATU STRUK MENCETAK DELAPAN HALAMAN, TUJUH DI ANTARANYA KOSONG.
 *
 * CSS cetak menyembunyikan layar dengan `body * { visibility: hidden }`, dan
 * `visibility` menyembunyikan TANPA melepas ruangnya. Tinggi dokumen yang
 * tercetak karena itu mengikuti tinggi HALAMAN YANG SEDANG DIBUKA — bukan
 * tinggi isi cetaknya. Terukur:
 *
 *   isi struk            :    79mm
 *   shell (Riwayat)      : 1.961mm  ← tak tercetak apa pun, tapi menentukan
 *   hasil di kertas 58mm : 8 halaman
 *
 * Pada printer termal itu sekitar dua meter kertas terbuang untuk SATU struk,
 * dan makin ramai harinya makin panjang — sebab yang menentukan adalah daftar
 * transaksi di belakangnya. Sesudah diperbaiki: shell 0mm, 1 halaman.
 *
 * Bentuk yang sama menggigit SEMUA jalur cetak browser: struk, QR karyawan,
 * dokumen belanja, dokumen kirim, dan daftar menu. Karena itu perbaikannya satu
 * komponen bersama, bukan lima tambalan.
 *
 * YANG DIJAGA DI SINI: tiap area cetak harus lewat `AreaCetak` (yang memportal
 * ke `body` DAN memasang `data-cetak-akar`), dan selektor CSS-nya harus memakai
 * ATRIBUT itu — bukan daftar id yang harus diingat orang saat menambah area
 * cetak baru.
 */
const AKAR = fileURLToPath(new URL("../../web/src", import.meta.url));
const CSS = readFileSync(join(AKAR, "index.css"), "utf8");
const KOMPONEN = readFileSync(join(AKAR, "components/AreaCetak.tsx"), "utf8");

function berkasTsx(dir: string, keluar: string[] = []): string[] {
  for (const nama of readdirSync(dir)) {
    const p = join(dir, nama);
    if (statSync(p).isDirectory()) berkasTsx(p, keluar);
    else if (nama.endsWith(".tsx")) keluar.push(p);
  }
  return keluar;
}

/** Id area cetak yang sudah punya aturan di `index.css`. */
const ID_CETAK = ["struk-print", "qr-print", "dokumen-print", "menu-print"];

describe("area cetak: tak ada halaman kosong dari shell", () => {
  const semua = berkasTsx(AKAR);

  it("menemukan berkas untuk dipindai (bukan lolos karena kosong)", () => {
    expect(semua.length).toBeGreaterThan(30);
    expect(CSS).toContain("data-cetak-akar");
  });

  it("`AreaCetak` memportal ke `body` DAN memasang penanda selektornya", () => {
    // Keduanya wajib bersama: portal tanpa penanda tak tersentuh CSS-nya, dan
    // penanda tanpa portal tetap tinggal di dalam `#root` yang dilepas.
    expect(KOMPONEN).toContain("createPortal(");
    expect(KOMPONEN).toContain("document.body,");
    expect(KOMPONEN).toContain('data-cetak-akar=""');
  });

  it("`#root` DILEPAS ruangnya (display), bukan disembunyikan (visibility)", () => {
    // `visibility: hidden` menyisakan ruang — itu akar seluruh halaman kosong.
    expect(CSS).toMatch(/body:has\(>\s*\[data-cetak-akar\]\)\s*#root\s*\{\s*display:\s*none/);
  });

  it("selektornya pakai ATRIBUT, bukan daftar id yang harus diingat", () => {
    // Daftar id berarti area cetak BARU diam-diam kehilangan perlindungannya,
    // dan gejalanya cuma "kok cetakannya jadi banyak halaman kosong".
    const aturan = CSS.match(/body:has\(>[^)]*\)\s*#root\s*\{[^}]*\}/)?.[0] ?? "";
    expect(aturan).toContain("[data-cetak-akar]");
    for (const id of ID_CETAK) expect(aturan).not.toContain(`#${id}`);
  });

  it("tak ada lagi area cetak yang dipasang sebagai div biasa", () => {
    // Bentuk lama: `<div id="struk-print" …>` di dalam pohon aplikasi. Ia
    // tercetak, tapi shell di belakangnya ikut menentukan panjang kertas.
    const pelanggar: string[] = [];
    for (const f of semua) {
      if (f.endsWith("components/AreaCetak.tsx")) continue;
      const isi = readFileSync(f, "utf8");
      for (const id of ID_CETAK) {
        if (new RegExp(`<div[^>]*\\bid="${id}"`).test(isi)) {
          pelanggar.push(`${f.slice(AKAR.length + 1)} (${id})`);
        }
      }
    }
    expect(
      pelanggar,
      "pakai <AreaCetak id=\"…\"> — div biasa tetap di dalam `#root`, dan shell " +
        "di belakangnya yang menentukan panjang cetakan",
    ).toEqual([]);
  });

  it("tiap id yang dipakai `AreaCetak` punya aturan cetaknya di CSS", () => {
    // Area cetak tanpa aturan lebar/posisi akan tercetak mengikuti bawaan
    // browser — struk 58mm bisa keluar selebar A4 tanpa ada yang menyadarinya.
    const dipakai = new Set<string>();
    for (const f of semua) {
      for (const m of readFileSync(f, "utf8").matchAll(/<AreaCetak\s+id="([^"]+)"/g)) {
        dipakai.add(m[1]);
      }
    }
    expect(dipakai.size).toBeGreaterThanOrEqual(4);
    for (const id of dipakai) expect(CSS, id).toContain(`#${id}`);
  });

  it("pratinjau struk di layar TETAP ada — area cetak bukan penggantinya", () => {
    // Struk beda dari area cetak lain: ia juga dipandang kasir di modal sebelum
    // dicetak. Memindahkannya begitu saja ke portal menghapus pratinjau itu,
    // dan kasir kehilangan satu-satunya cara memeriksa sebelum kertas keluar.
    const modal = readFileSync(join(AKAR, "pages/kasir/ReceiptModal.tsx"), "utf8");
    expect(modal).toContain('id="struk-pratinjau"');
    // Satu sumber isi, dipakai dua tempat — bukan dua salinan markup yang
    // kelak menyimpang, dan yang menyimpang justru yang diserahkan ke pembeli.
    expect((modal.match(/\{isiStruk\}/g) ?? []).length).toBe(2);
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * MENU DAN KERTAS PESANAN ADALAH DUA KEPERLUAN, BUKAN DUA GAYA.
 *
 *   MENU     dibaca TAMU sebelum memesan — butuh deskripsi & harga, dan harus
 *            enak dibaca. Kepadatan mengalah pada keterbacaan.
 *   PESANAN  diisi TAMU lalu diserahkan ke kasir — butuh kotak jumlah, dan
 *            harus muat SATU lembar supaya tak ada yang tercecer.
 *
 * Disatukan dalam satu tombol keduanya saling menarik ke arah berlawanan: yang
 * satu jadi terlalu padat untuk dibaca, yang lain terlalu longgar untuk muat.
 * Terukur pada katalog 77 menu berdeskripsi: 5 halaman untuk keduanya sekaligus,
 * versus 2 (menu) + 1 (pesanan) sesudah dipisah.
 *
 * DUA HAL YANG MEMBUATNYA MUAT, dan keduanya mudah dibatalkan tanpa sadar:
 *
 * 1. PORTAL KE `body`. CSS cetak repo ini memakai
 *    `body * { visibility: hidden }`, dan `visibility` menyembunyikan TANPA
 *    melepas ruangnya. Shell aplikasi setinggi 1.285mm karena itu tetap
 *    menentukan tinggi dokumen: isi 631mm tercetak jadi 5 halaman, tiga di
 *    antaranya KOSONG, dan tak ada yang tahu dari mana. Sebagai anak langsung
 *    `body`, ia bisa dipasangkan `#root { display: none }` yang benar-benar
 *    melepas ruang itu.
 *
 * 2. DESKRIPSI TIDAK IKUT di kertas pesanan. Tamu sudah memilih dari menu, jadi
 *    di sana ia tak dibaca siapa pun — tapi memakan lebih dari separuh tinggi
 *    barisnya. Justru itulah yang membuat lembar pesanan meluber.
 *
 * Uji ini memindai sumbernya. Yang dijaga bukan angka milimeter (itu berubah
 * mengikuti panjang menu tiap toko) melainkan KEPUTUSAN-keputusan di atas.
 */
const HAL = readFileSync(
  fileURLToPath(new URL("../../web/src/pages/menu/LihatMenuPage.tsx", import.meta.url)),
  "utf8",
);
/**
 * HANYA blok cetak. Halaman ini juga menggambar daftar menu di LAYAR — lengkap
 * dengan deskripsinya — jadi memindai seluruh berkas akan menemukan kecocokan
 * di tempat yang salah. Uji ini pernah gugur persis karena itu.
 */
const BLOK = (() => {
  const i = HAL.indexOf("data-mode={cetak}");
  return i < 0 ? "" : HAL.slice(i);
})();

const CSS = readFileSync(
  fileURLToPath(new URL("../../web/src/index.css", import.meta.url)),
  "utf8",
);

describe("cetak: menu vs kertas pesanan", () => {
  it("berkasnya terbaca — bukan lolos karena kosong", () => {
    expect(HAL.length).toBeGreaterThan(2000);
    // Tanpa ini, anchor yang tak lagi cocok membuat BLOK kosong dan dua uji
    // di bawahnya hijau tanpa memeriksa apa pun.
    expect(BLOK.length).toBeGreaterThan(500);
    expect(CSS).toContain("#menu-print");
  });

  it("ada DUA tombol terpisah, bukan satu yang serba bisa", () => {
    expect(HAL).toContain("Cetak Menu");
    expect(HAL).toContain("Cetak Kertas Pesanan");
  });

  it("kotak jumlah HANYA di kertas pesanan", () => {
    // Kotak isian di daftar menu membuat tamu mengira boleh mengisinya, lalu
    // lembar yang diserahkan bukan lembar yang dibaca kasir.
    const i = BLOK.indexOf("kotak-jumlah");
    expect(i).toBeGreaterThan(0);
    expect(BLOK.slice(Math.max(0, i - 300), i)).toContain('cetak === "pesanan"');
  });

  it("deskripsi HANYA di menu — inilah yang menentukan muat atau tidak", () => {
    const i = BLOK.indexOf("m.deskripsi");
    expect(i).toBeGreaterThan(0);
    expect(BLOK.slice(Math.max(0, i - 300), i)).toContain('cetak === "menu"');
  });

  it("area cetak dipasang lewat `AreaCetak`, bukan div biasa", () => {
    // `AreaCetak` yang memportalnya ke `body` DAN memasang `data-cetak-akar`
    // yang dipakai selektor CSS. Div biasa akan tetap di dalam `#root` — yang
    // dilepas ruangnya saat mencetak — jadi yang keluar halaman kosong semua.
    expect(HAL).toContain("<AreaCetak id=\"menu-print\"");
  });

  it("kertas pesanan lebih banyak kolom daripada menu", () => {
    // Bukan selera: menu dibaca (kolom lebar), pesanan dipindai lalu diisi
    // (kolom sempit, muat lebih banyak baris).
    const kolomMenu = CSS.match(/\[data-mode="menu"\][^}]*columns:\s*(\d)/);
    const kolomPesanan = CSS.match(/\[data-mode="pesanan"\][^}]*columns:\s*(\d)/);
    expect(kolomMenu?.[1]).toBeTruthy();
    expect(kolomPesanan?.[1]).toBeTruthy();
    expect(Number(kolomPesanan![1])).toBeGreaterThan(Number(kolomMenu![1]));
  });

  it("mencetak SESUDAH React menggambar mode yang dipilih", () => {
    // `setCetak(...)` lalu `window.print()` berurutan mencetak mode yang LAMA:
    // `window.print()` memblokir sebelum React sempat menggambar ulang. Bug ini
    // sunyi — yang keluar dari printer terlihat sah, cuma bukan yang diminta.
    const i = HAL.indexOf("mintaCetak");
    expect(i).toBeGreaterThan(0);
    expect(HAL).toMatch(/useEffect\(\(\) => \{[\s\S]{0,200}window\.print\(\)/);
  });
});

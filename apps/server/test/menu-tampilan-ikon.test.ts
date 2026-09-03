import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { butaKomentar } from "../src/scripts/buta-komentar";

/**
 * PRATINJAU YANG CUMA MIRIP LEBIH BURUK DARIPADA TAK ADA PRATINJAU.
 *
 * Pemilik repo meminta bentuk ikon di Menu & HPP, dengan tujuan yang ia sebut
 * sendiri: "cek preview foto menu di kasir". Sejak saat itu halaman itu
 * membuat sebuah JANJI — "beginilah foto ini akan terlihat di kasir" — dan
 * janji itu hanya bisa ditepati bila kartunya benar-benar kartu yang sama.
 *
 * Yang paling mudah menyimpang justru satu-satunya hal yang orang datang untuk
 * memeriksanya. Fotonya dipasang `object-cover` di kotak `h-20`: ia MEMOTONG
 * sisi panjang, jadi kotak yang sedikit lebih pendek atau kolom grid yang
 * sedikit lebih sempit menghasilkan potongan yang lain. Pratinjau yang keliru
 * soal potongan membuat orang mengunggah ulang foto yang sebenarnya sudah
 * benar — kerugian yang tak akan pernah ia sadari sebagai bug.
 *
 * Maka yang dijaga di sini bukan "ada tombol ikon" melainkan bahwa kartunya
 * SATU: satu rumah, satu kelas foto, satu lambang untuk foto yang belum ada.
 *
 * YANG TIDAK DIJANJIKAN, supaya "hijau" tak terbaca lebih luas dari yang
 * benar: uji ini membaca teks sumber, jadi ia tak bisa mengatakan bahwa
 * pikselnya sama. Yang mengukur itu `apps/web/e2e/menu-tampilan-ikon.spec.ts`
 * di peramban sungguhan, dan itulah pasangan uji ini.
 */
const AKAR = fileURLToPath(new URL("../../../", import.meta.url));
const baca = (rel: string) => butaKomentar(readFileSync(AKAR + rel, "utf8"));

const KARTU_REL = "apps/web/src/components/KartuMenuKasir.tsx";
const KARTU = baca(KARTU_REL);
const MENU = baca("apps/web/src/pages/menu/MenuListPage.tsx");
const SAKELAR = baca("apps/web/src/components/SakelarTampilan.tsx");
const KASIR = baca("apps/web/src/pages/kasir/KasirPage.tsx");

function semuaTsx(dir: string): string[] {
  const hasil: string[] = [];
  for (const nama of readdirSync(dir)) {
    if (nama === "node_modules" || nama === "dist") continue;
    const p = dir + nama;
    if (statSync(p).isDirectory()) hasil.push(...semuaTsx(p + "/"));
    else if (nama.endsWith(".tsx") || nama.endsWith(".ts")) hasil.push(p);
  }
  return hasil;
}
const SUMBER_WEB = semuaTsx(AKAR + "apps/web/src/");

/**
 * `🍜` yang BUKAN penanda "foto belum ada" — diadili satu per satu.
 *
 * Keempatnya label navigasi/judul bagian ("🍜 Menu & HPP", "🍜 Stok Menu", …):
 * emoji yang berarti "ini urusan menu", bukan "fotonya kosong". Mengikatnya ke
 * `IKON_MENU_KOSONG` justru salah — begitu lambang foto-kosong diganti jadi
 * 📷, keempat label sidebar itu ikut berubah tanpa ada yang memintanya.
 */
const DIADILI: { berkas: string; alasan: string }[] = [
  {
    berkas: "apps/web/src/components/Layout.tsx",
    alasan:
      "dua label navigasi sidebar — '🍜 Lihat Menu' dan '🍜 Menu & HPP'. Emojinya menandai " +
      "BAGIAN menu, bukan foto yang hilang; keduanya harus tetap 🍜 walau lambang foto-kosong diganti.",
  },
  {
    berkas: "apps/web/src/pages/stok/StokPage.tsx",
    alasan:
      "judul tab '🍜 Stok Menu' — sama seperti label sidebar, emojinya menandai bagian menu " +
      "dan tak ada hubungannya dengan ada/tidaknya foto sebuah menu.",
  },
  {
    berkas: "apps/web/src/pages/produksi/RekomendasiBeliPage.tsx",
    alasan:
      "judul tombol '🍜 Rencana dari Menu' — menandai asal rencananya (dari katalog menu), " +
      "bukan keadaan foto. Layar ini bahkan tak pernah merender foto menu.",
  },
];

describe("kartu menu kasir: SATU rumah", () => {
  it("rumahnya ada, dan kedua layar memakainya", () => {
    expect(KARTU).toMatch(/export function KartuMenuKasir/);
    expect(KASIR).toContain('from "../../components/KartuMenuKasir"');
    expect(MENU).toContain('from "../../components/KartuMenuKasir"');
    expect(KASIR).toContain("<KartuMenuKasir");
    expect(MENU).toContain("<KartuMenuKasir");
  });

  it("KELAS FOTONYA cuma ada di satu berkas — ini asersi inti seluruh putaran", () => {
    // Begitu kelas ini muncul dua kali, kedua kartu berhenti dijamin sama dan
    // pratinjaunya berhenti bisa dipercaya. Yang dihitung berkasnya, bukan
    // kemunculannya: di dalam rumahnya ia memang muncul dua kali (cabang foto
    // ada / tidak ada), dan itu memang satu kartu.
    const punya = SUMBER_WEB.filter((p) => readFileSync(p, "utf8").includes("h-20 w-full"));
    expect(punya.map((p) => p.slice(AKAR.length))).toEqual([KARTU_REL]);
    expect(KARTU).toContain("mb-2 h-20 w-full rounded-lg object-cover");
  });

  it("grid ikon Menu & HPP memakai titik henti yang SAMA dengan kasir", () => {
    // Kartu yang sama di grid yang lebih lebar tetap memotong fotonya berbeda.
    for (const s of [KASIR, MENU]) {
      expect(s).toMatch(/grid-cols-2[^"]*md:grid-cols-3[^"]*xl:grid-cols-4/);
    }
  });

  it("`StokBadge` ikut pindah, dan KasirPage tak lagi punya salinannya", () => {
    expect(KARTU).toMatch(/export function StokBadge/);
    expect(KASIR).not.toMatch(/function StokBadge\(/);
  });

  it("Menu & HPP TIDAK mengoper stok — pratinjau tak boleh mengarang sisa porsi", () => {
    // Sisa porsi angka per-cabang; halaman ini bukan layar per-cabang dan tak
    // menariknya. `StokBadge` diam saat porsinya tak diketahui, jadi yang
    // terjadi bukan lencana kosong melainkan tak ada lencana.
    const i = MENU.indexOf("<KartuMenuKasir");
    expect(i).toBeGreaterThan(0);
    expect(MENU.slice(i, i + 220)).not.toContain("stok=");
  });
});

describe("lambang foto-belum-ada: satu rumah, sisanya diadili", () => {
  it("konstantanya ada dan dipakai ketiga layar menu", () => {
    expect(KARTU).toMatch(/export const IKON_MENU_KOSONG/);
    for (const rel of [
      "apps/web/src/pages/menu/MenuListPage.tsx",
      "apps/web/src/pages/menu/LihatMenuPage.tsx",
      "apps/web/src/pages/menu/MenuFormPage.tsx",
    ]) {
      expect(baca(rel), rel).toContain("IKON_MENU_KOSONG");
    }
  });

  it("tak ada salinan literalnya di luar rumah & daftar yang diadili", () => {
    const lambang = "\u{1F35C}";
    const salinan = SUMBER_WEB.filter((p) => butaKomentar(readFileSync(p, "utf8")).includes(lambang))
      .map((p) => p.slice(AKAR.length))
      .filter((rel) => rel !== KARTU_REL && !DIADILI.some((d) => d.berkas === rel));
    expect(salinan).toEqual([]);
  });

  it("tiap pengadilan punya alasan yang bisa diperiksa, dan berkasnya masih ada", () => {
    for (const d of DIADILI) {
      expect(d.alasan.length, d.berkas).toBeGreaterThan(80);
      expect(SUMBER_WEB.map((p) => p.slice(AKAR.length))).toContain(d.berkas);
      expect(butaKomentar(readFileSync(AKAR + d.berkas, "utf8")), d.berkas).toContain("\u{1F35C}");
    }
  });
});

describe("tombol bentuk & chip tanpa foto", () => {
  it("dua arah, ber-aria-pressed, dan memakai kosakata yang sama dengan Resep", () => {
    const resep = baca("apps/web/src/pages/resep/ResepPage.tsx");
    for (const label of ["🔳 Ikon", "☰ Daftar"]) {
      expect(MENU, label).toContain(label);
      expect(resep, `${label} — dua halaman tak boleh mengajarkan dua kosakata`).toContain(label);
    }
    /*
     * `aria-pressed` PINDAH RUMAH 2026-09-03 ke `components/SakelarTampilan.tsx`
     * — markup sakelarnya diekstrak saat salinan KETIGA hendak lahir
     * (Permintaan Stok). Yang dijaga tak berubah: dua arah, ber-`aria-pressed`,
     * kosakata yang sama. Alamatnya yang berganti.
     */
    expect(SAKELAR).toContain("aria-pressed={nilai === o.nilai}");
    expect(MENU).toContain('{ nilai: "ikon", label: "🔳 Ikon" }');
    expect(MENU).toContain('{ nilai: "daftar", label: "☰ Daftar" }');
  });

  it("pilihannya disimpan, dan bawaannya DAFTAR — bentuk yang sudah ada", () => {
    expect(MENU).toContain('const KUNCI_TAMPILAN = "kakarut.menuTampilan"');
    // Baca/tulis `localStorage` juga pindah ke rumah bersama (`useTampilan`).
    expect(SAKELAR).toContain("bacaLokal(kunci)");
    expect(SAKELAR).toContain("tulisLokal(kunci, tampilan)");
    // Bawaannya: apa pun selain "ikon" jatuh ke "daftar".
    // Bawaannya DAFTAR — argumen ketiga `useTampilan`, dan nilai tersimpan yang
    // tak dikenal ikut jatuh ke sana (lihat `useTampilan`).
    expect(MENU).toMatch(/useTampilan<TampilanMenu>\(\s*KUNCI_TAMPILAN,\s*\["ikon", "daftar"\],\s*"daftar",\s*\)/);
  });

  it("chip tanpa-foto TIDAK dirender saat bacaannya gagal", () => {
    // "0 tanpa foto" di atas daftar yang gagal dimuat terbaca sebagai "semua
    // menu sudah berfoto" — aturan yang sama dengan ubin di `nilai-stok`.
    expect(MENU).toContain("{!gagalMuat && (tanpaFoto > 0 || hanyaTanpaFoto) && (");
  });

  it("hitungannya tak ikut disaring oleh saringannya sendiri", () => {
    // Kalau ikut, angkanya membeku begitu chipnya ditekan dan chip yang
    // menyala berhenti bisa mengatakan berapa yang tersisa.
    const i = MENU.indexOf("const tanpaFoto = semua");
    expect(i).toBeGreaterThan(0);
    const blok = MENU.slice(i, MENU.indexOf(".length;", i));
    expect(blok).not.toContain("hanyaTanpaFoto");
    expect(blok).toContain("m.image_url == null");
  });

  it("blok gagal/kosong tetap DI LUAR percabangan bentuk", () => {
    // Grid ikon yang merender "belum ada menu" untuk bacaan yang GAGAL adalah
    // persis kelas yang `gagal-muat-bukan-kosong` ada untuk mencegahnya.
    const iGagal = MENU.indexOf("Daftar menu gagal dimuat");
    const iCabang = MENU.indexOf('tampilan === "ikon" ? (');
    expect(iGagal).toBeGreaterThan(0);
    expect(iCabang).toBeGreaterThan(0);
    expect(iGagal, "blok gagal harus mendahului percabangan bentuk").toBeLessThan(iCabang);
  });
});

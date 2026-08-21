import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * SETIAP SUITE UJI DI REPO INI HARUS BENAR-BENAR DIPANGGIL CI.
 *
 * KENAPA UJI INI ADA — dan ini bukan kekhawatiran teoretis.
 *
 * Suite Playwright di `apps/web/e2e` sudah ada di repo sejak lama dan TAK
 * PERNAH dipanggil CI: `ci.yml` menjalankan typecheck, unit test server, dan
 * `verify-api.sh`, tapi tidak Playwright. Akibatnya ia membusuk tanpa ada yang
 * tahu. Saat akhirnya dijalankan, EMPAT dari LIMA spec merah:
 *
 *   · layar kasir kini menuntut ABSEN MASUK lalu BUKA SHIFT sebelum bisa
 *     berjualan — dua prasyarat yang belum ada saat spec-nya ditulis;
 *   · checkout jadi DUA langkah (Resume Order → panel pembayaran), bukan satu
 *     tombol "Bayar & Cetak Struk";
 *   · struk kini dirender portal `hidden print:block`, jadi `toBeVisible()`
 *     tak mungkin lagi benar;
 *   · owner mendarat di `/dashboard`, bukan `/kasir`;
 *   · dan `playwright.config.ts` MEMATOK jalur Chromium yang cuma ada di satu
 *     mesin — di runner mana pun ia gagal meluncur sebelum satu asersi pun
 *     berjalan.
 *
 * Tak satu pun dari lima hal itu ketahuan, karena tak ada yang menjalankannya.
 * Uji yang tak pernah dijalankan bukan jaring pengaman, cuma berkas — bentuk
 * paling murni dari "uji yang tak bisa gagal".
 *
 * Yang dijaga di sini bukan isi suite-nya, melainkan bahwa CI MEMANGGILNYA.
 * Kalau nanti ada suite baru, tambahkan barisnya ke `WAJIB` — dan kalau sebuah
 * suite sengaja dilepas dari CI, hapus barisnya DENGAN alasan di pesan commit,
 * bukan diam-diam.
 */
const CI = readFileSync(
  fileURLToPath(new URL("../../../.github/workflows/ci.yml", import.meta.url)),
  "utf8",
);

/** Perintah yang WAJIB muncul di ci.yml, beserta alasan kenapa ia penting. */
const WAJIB: { nama: string; pola: RegExp; kenapa: string }[] = [
  {
    nama: "typecheck",
    pola: /npm run typecheck/,
    kenapa: "satu-satunya yang memeriksa shared + server + web sekaligus",
  },
  {
    nama: "unit test server",
    pola: /npm test\b/,
    kenapa: "1.800+ asersi, termasuk seluruh gerbang sapuan mekanis",
  },
  {
    nama: "verify-api",
    pola: /verify-api\.sh/,
    kenapa: "2.500+ asersi HTTP terhadap Postgres segar — satu-satunya yang menguji perilaku sungguhan",
  },
  {
    nama: "e2e web (Playwright)",
    pola: /playwright test/,
    kenapa:
      "satu-satunya yang mengeksekusi 41.000+ baris frontend; tanpa ini apps/web " +
      "tak punya uji yang berjalan sama sekali",
  },
  {
    nama: "pemasangan browser Playwright",
    pola: /playwright install/,
    kenapa: "tanpa ini `playwright test` gagal meluncur di runner dan seluruh spec-nya dilewati",
  },
];

describe("CI menjalankan semua suite uji", () => {
  it.each(WAJIB)("memanggil $nama", ({ pola, kenapa }) => {
    expect(pola.test(CI), `ci.yml tidak memanggil ini — ${kenapa}`).toBe(true);
  });

  it("PASANGAN: detektornya bisa MENUDUH, bukan sekadar selalu hijau", () => {
    /*
     * Tanpa ini, kelima asersi di atas cuma membuktikan bahwa `CI` adalah
     * string yang panjang. Yang diperiksa: pola yang sama, dijalankan atas
     * berkas CI TIRUAN yang memang tak memuat perintahnya, harus GAGAL.
     */
    const ciTiruan = [
      "jobs:",
      "  quality:",
      "    steps:",
      "      - run: npm ci",
      "      - run: npm run build -w @kakarut/web",
    ].join("\n");
    const lolos = WAJIB.filter((w) => w.pola.test(ciTiruan)).map((w) => w.nama);
    expect(lolos, "pola ini cocok pada CI tiruan yang tak memanggil apa pun").toEqual([]);
    // …dan sebaliknya: tiap pola memang cocok pada perintah aslinya.
    const contoh = [
      "npm run typecheck",
      "npm test",
      "bash scripts/verify-api.sh",
      "npx playwright test",
      "npx playwright install --with-deps chromium",
    ].join("\n");
    const tercocok = WAJIB.filter((w) => w.pola.test(contoh)).map((w) => w.nama);
    expect(tercocok).toHaveLength(WAJIB.length);
  });

  it("job e2e memakai server & DB yang sama dengan verify-api", () => {
    /*
     * Kalau Playwright dipindah ke job sendiri tanpa Postgres + seed + server,
     * ia akan "lulus" dengan melewati semuanya atau gagal seketika. Yang
     * dijaga: perintah playwright berada SESUDAH `verify-api.sh` di berkas yang
     * sama — artinya ia mewarisi server hidup dan basis data ter-seed.
     */
    const iVerify = CI.indexOf("verify-api.sh");
    const iPlaywright = CI.indexOf("playwright test");
    expect(iVerify, "verify-api.sh tak ditemukan di ci.yml").toBeGreaterThan(0);
    expect(iPlaywright, "playwright test tak ditemukan di ci.yml").toBeGreaterThan(0);
    expect(
      iPlaywright,
      "playwright dijalankan SEBELUM verify-api — verify-api menuntut cacah yang persis, " +
        "dan dua penjualan dari e2e akan menggesernya",
    ).toBeGreaterThan(iVerify);
  });
});

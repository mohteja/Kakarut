import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  /*
   * SATU WORKER, dan itu bukan kehati-hatian berlebihan.
   *
   * Dua hal membuat paralelisme di sini merugikan, keduanya terukur:
   *
   * 1. `POST /auth/login` dibatasi 10 per (IP + email) tiap 5 menit
   *    (`modules/auth/routes.ts:56`). `util.ts` menyimpan sesinya per email —
   *    tapi cache itu hidup di MODUL, jadi tiap worker punya salinannya
   *    sendiri dan membayar login lagi. Dengan 2 worker (bawaan di mesin
   *    4-inti) kuotanya habis, dan 429 muncul sebagai `TypeError: Cannot read
   *    properties of undefined` di spec yang tak ada hubungannya — kegagalan
   *    yang menyamar jadi bentuk data.
   * 2. Spec-spec ini berbagi SATU basis data dan memutasinya: shift dibuka,
   *    meja diisi lalu dikosongkan, penjualan dicatat. Dua worker yang
   *    berjalan bersamaan saling mencabut prasyarat masing-masing.
   *
   * Menaikkannya kembali menuntut sesi per-worker yang tak membakar kuota DAN
   * data uji yang terpisah per worker — pekerjaan tersendiri, bukan setelan.
   */
  workers: 1,
  /*
   * SATU LOGIN PER AKUN untuk seluruh suite — lihat `e2e/global-setup.ts`.
   *
   * Tanpa ini, cache sesi di `util.ts` mati bersama worker-nya, dan Playwright
   * menyalakan ulang worker tiap kali sebuah test gagal: satu kegagalan
   * membakar kuota login dan seluruh sisa suite memerah dengan 429.
   */
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    headless: true,
    /*
     * Chromium bawaan Playwright dipakai secara default.
     *
     * Sebelumnya berkas ini MEMATOK `/opt/pw-browsers/chromium` sebagai
     * cadangan — jalur yang hanya ada di satu lingkungan pengembangan. Di
     * runner CI (dan di mesin siapa pun yang tak punya jalur itu) Playwright
     * gagal meluncur sebelum satu asersi pun berjalan. Karena suite ini memang
     * belum pernah dijalankan CI, pematokan itu tak pernah ketahuan.
     *
     * Set `E2E_CHROMIUM_PATH` bila memang ingin memakai Chromium yang sudah
     * terpasang di lingkungan dan melewati unduhannya.
     */
    launchOptions: process.env.E2E_CHROMIUM_PATH
      ? { executablePath: process.env.E2E_CHROMIUM_PATH }
      : {},
  },
  reporter: [["list"]],
});

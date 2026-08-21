import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
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

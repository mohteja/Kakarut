import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    headless: true,
    // Pakai Chromium yang sudah terpasang di lingkungan (tanpa download):
    // set E2E_CHROMIUM_PATH bila lokasinya berbeda.
    launchOptions: {
      executablePath: process.env.E2E_CHROMIUM_PATH ?? "/opt/pw-browsers/chromium",
    },
  },
  reporter: [["list"]],
});

/**
 * Smoke test printer thermal memakai transport "mock" (di-seed lewat
 * localStorage): checkout → auto-print merekam byte ESC/POS; halaman
 * pengaturan printer render dan Cetak Tes berfungsi.
 */
import { expect, test } from "@playwright/test";

const KASIR_EMAIL = process.env.E2E_KASIR_EMAIL ?? "kasir@basooopa.id";
const KASIR_PASS = process.env.E2E_KASIR_PASS ?? "Kasir123!";
const OWNER_EMAIL = process.env.E2E_OWNER_EMAIL ?? "terahokiindonesia@gmail.com";
const OWNER_PASS = process.env.E2E_OWNER_PASS ?? "Basooopa123!";

const MOCK_SETTINGS = {
  v: 1,
  transport: "mock",
  paperWidth: 58,
  charsPerLine: null,
  autoPrint: true,
  cutEnabled: false,
  drawerKickEnabled: false,
  feedLines: 3,
  btDeviceName: null,
  chunkSize: 100,
  chunkDelayMs: 20,
};

declare global {
  interface Window {
    __kakarutPrintCapture?: number[][];
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((settings) => {
    window.localStorage.setItem("kakarut.printer", JSON.stringify(settings));
  }, MOCK_SETTINGS);
});

async function login(page: import("@playwright/test").Page, email: string, pass: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(pass);
  await page.getByRole("button", { name: "Masuk" }).click();
}

test("checkout dengan auto-print merekam byte ESC/POS (init + TOTAL)", async ({ page }) => {
  await login(page, KASIR_EMAIL, KASIR_PASS);
  await expect(page).toHaveURL(/\/kasir/);

  // modal pilih meja muncul dulu → cari & pilih meja
  await page.getByPlaceholder(/Cari meja/).fill("1");
  await page.getByRole("button", { name: /Meja 1/ }).click();
  await page.getByRole("button", { name: /Premium Basooopa A/ }).click();
  await page.getByRole("button", { name: /Bayar & Cetak Struk/ }).click();
  await expect(page.locator("#struk-print")).toBeVisible();

  // tombol Cetak Thermal tampil (transport ≠ browser)
  await expect(page.getByRole("button", { name: /Cetak Thermal/ })).toBeVisible();

  // auto-print → byte terekam di mock transport
  await page.waitForFunction(() => (window.__kakarutPrintCapture?.length ?? 0) >= 1);
  const capture = await page.evaluate(() => window.__kakarutPrintCapture![0]);

  // dimulai ESC @ (0x1B 0x40)
  expect(capture[0]).toBe(0x1b);
  expect(capture[1]).toBe(0x40);
  // memuat teks "TOTAL" dan nomor struk ASCII
  const text = capture.map((b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : "")).join("");
  expect(text).toContain("TOTAL");
  expect(text).toMatch(/PUSAT-\d{8}-\d{4}/);
});

test("halaman pengaturan printer render dan Cetak Tes merekam byte", async ({ page }) => {
  await login(page, OWNER_EMAIL, OWNER_PASS);
  await expect(page).toHaveURL(/\/kasir/);

  await page.getByRole("link", { name: /Printer/ }).click();
  await expect(page).toHaveURL(/\/pengaturan\/printer/);
  await expect(page.getByText("Pengaturan Printer")).toBeVisible();
  await expect(page.getByText("Metode cetak")).toBeVisible();
  await expect(page.getByText("Bluetooth (BLE)")).toBeVisible();

  await page.getByRole("button", { name: /Cetak Tes/ }).click();
  await page.waitForFunction(() => (window.__kakarutPrintCapture?.length ?? 0) >= 1);
  const text = await page.evaluate(() =>
    window
      .__kakarutPrintCapture![0].map((b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ""))
      .join(""),
  );
  expect(text).toContain("CETAK TES");
});

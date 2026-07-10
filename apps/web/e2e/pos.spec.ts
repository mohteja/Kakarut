/**
 * Smoke test end-to-end: login kasir → POS → checkout → struk,
 * lalu login owner → cek stok & laporan.
 * Prasyarat: server jalan di E2E_BASE_URL (default :3000) dengan seed Basooopa.
 */
import { expect, test } from "@playwright/test";

const KASIR_EMAIL = process.env.E2E_KASIR_EMAIL ?? "kasir@basooopa.id";
const KASIR_PASS = process.env.E2E_KASIR_PASS ?? "Kasir123!";
const OWNER_EMAIL = process.env.E2E_OWNER_EMAIL ?? "terahokiindonesia@gmail.com";
const OWNER_PASS = process.env.E2E_OWNER_PASS ?? "Basooopa123!";

async function login(page: import("@playwright/test").Page, email: string, pass: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(pass);
  await page.getByRole("button", { name: "Masuk" }).click();
}

test("kasir: POS → tambah menu → dine-in → checkout → struk", async ({ page }) => {
  await login(page, KASIR_EMAIL, KASIR_PASS);
  await expect(page).toHaveURL(/\/kasir/);

  // tab kategori dari catOrder tampil
  await expect(page.getByRole("button", { name: "Paket Premium" })).toBeVisible();
  await page.getByRole("button", { name: "Paket Premium" }).click();

  // tambah PBA ke keranjang
  await page.getByRole("button", { name: /Premium Basooopa A/ }).click();
  await expect(page.getByText("Keranjang")).toBeVisible();

  // aktifkan dine-in level transaksi
  await page.getByRole("button", { name: "Dine-in", exact: true }).click();

  // bayar
  await page.getByRole("button", { name: /Bayar & Cetak Struk/ }).click();

  // struk muncul dengan nomor & total
  await expect(page.locator("#struk-print")).toBeVisible();
  await expect(page.locator("#struk-print")).toContainText("TOTAL");
  await expect(page.locator("#struk-print")).toContainText(/PUSAT-\d{8}-\d{4}/);
  await expect(page.locator("#struk-print")).toContainText("Dine-in");

  await page.getByRole("button", { name: "Transaksi Baru" }).click();
  await expect(page.locator("#struk-print")).toHaveCount(0);
});

test("owner: stok menunjukkan pemakaian & laporan menampilkan omzet", async ({ page }) => {
  await login(page, OWNER_EMAIL, OWNER_PASS);
  await expect(page).toHaveURL(/\/kasir/);

  await page.getByRole("link", { name: "📦 Stok" }).click();
  await expect(page).toHaveURL(/\/stok/);
  const barisUrat = page.locator("tr", { hasText: "Baso urat besar" }).first();
  await expect(barisUrat).toBeVisible();
  await expect(barisUrat).toContainText("−"); // ada pemakaian

  await page.getByRole("link", { name: /Laporan/ }).click();
  await expect(page).toHaveURL(/\/laporan/);
  await expect(page.getByText("Omzet", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Estimasi Profit")).toBeVisible();

  // menu & HPP terlihat oleh owner
  await page.getByRole("link", { name: /Menu & HPP/ }).click();
  await expect(page.getByText("Paket Premium").first()).toBeVisible();
  await expect(page.locator("tr", { hasText: "Premium Basooopa A" }).first()).toBeVisible();
});

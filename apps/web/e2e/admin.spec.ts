/**
 * Smoke test panel super-admin: halaman Sistem & Migrasi menampilkan status
 * migrasi (semua terpasang setelah AUTO_MIGRATE saat boot).
 */
import { expect, test } from "@playwright/test";

const SA_EMAIL = process.env.E2E_SA_EMAIL ?? "superadmin@kakarut.id";
const SA_PASS = process.env.E2E_SA_PASS ?? "SuperAdmin123!";

test("super-admin melihat status sistem & daftar migrasi terpasang", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(SA_EMAIL);
  await page.getByLabel("Password").fill(SA_PASS);
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(page).toHaveURL(/\/superadmin/);

  await page.getByRole("link", { name: /Sistem & Migrasi/ }).click();
  await expect(page).toHaveURL(/\/superadmin\/sistem/);

  await expect(page.getByText("Sistem & Migrasi Database")).toBeVisible();
  await expect(page.getByText("Terhubung")).toBeVisible();

  // dua migrasi awal repo ini terpasang, tidak ada yang menunggu
  const badges = page.locator("tbody").getByText("Terpasang", { exact: true });
  await expect(badges.first()).toBeVisible();
  await expect(page.locator("tbody").getByText("Menunggu", { exact: true })).toHaveCount(0);

  // tombol jalankan nonaktif saat tidak ada migrasi menunggu
  await expect(page.getByRole("button", { name: /Jalankan Migrasi/ })).toBeDisabled();
});

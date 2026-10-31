import { expect, test } from "@playwright/test";
import { OWNER_EMAIL, OWNER_PASS, absenMasuk, masukLewatSesi, pastikanShiftTerbuka, tampak } from "./util";

/**
 * LAPORAN UJI 31 OKT 2026 — gelombang 1, yang hanya terlihat di layar:
 *   - jalur asing → halaman "tidak ditemukan" (server menjawab 404);
 *   - akun tamu: pita "akun demo" & aksi berbahaya disembunyikan;
 *   - Pilih Meja di layar HP 375 px: nama meja tak lagi terpotong "M…".
 */

const TAMU_OWNER = "owner-demo@terakasir.app";
const TAMU_KASIR = "kasir-demo@terakasir.app";
const PASS_TAMU = "demoterakasir";

test("jalur asing menampilkan halaman tidak ditemukan (bukan dilempar ke /login)", async ({ page }) => {
  const res = await page.goto("/abc-laporan-uji");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Halaman tidak ditemukan" })).toBeVisible();
  await expect(page).toHaveURL(/\/abc-laporan-uji$/);
});

test("akun tamu: pita demo tampil, ganti password & hapus akun disembunyikan", async ({ page, request }) => {
  await masukLewatSesi(page, request, TAMU_OWNER, PASS_TAMU);
  await page.goto("/profil");
  await expect(page.getByTestId("pita-tamu")).toBeVisible();
  await expect(page.getByTestId("pita-tamu")).toContainText("123456");
  await expect(page.getByTestId("catatan-tamu")).toBeVisible();
  await expect(page.getByRole("button", { name: "Simpan Password Baru" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Hapus Akun" })).toHaveCount(0);
});

test("Pilih Meja di layar 375 px: nama meja terisi terbaca utuh", async ({ page, request }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  // Buka kasir mensyaratkan absen masuk lebih dulu.
  await absenMasuk(request, TAMU_KASIR, PASS_TAMU);
  await masukLewatSesi(page, request, TAMU_KASIR, PASS_TAMU);
  await page.goto("/kasir");
  await pastikanShiftTerbuka(page);
  const modal = page.getByRole("heading", { name: "Pilih Meja" });
  if (!(await tampak(modal))) await page.getByRole("button", { name: /Pilih meja/ }).first().click();
  await expect(modal).toBeVisible();

  const tombol = page.getByTestId("meja-pilih");
  await expect(tombol.first()).toBeVisible();
  // Data demo selalu punya meja terisi (open bill) — itu baris yang dulu terpotong.
  await expect(page.getByRole("button", { name: "✓ Kosongkan" }).first()).toBeVisible();
  const terpotong = await tombol.evaluateAll((els) =>
    els
      .map((el) => el.querySelector("span"))
      .filter((s): s is HTMLSpanElement => s != null)
      .filter((s) => s.scrollWidth > s.clientWidth + 1)
      .map((s) => s.textContent),
  );
  expect(terpotong, "nama meja yang terpotong").toEqual([]);
  for (const nama of ["Meja 1", "Meja 2", "Meja 3"]) {
    await expect(tombol.filter({ hasText: nama }).first()).toBeVisible();
  }
});

/**
 * UJI WEB 31 OKT 2026, W-35: "+ Kategori baru" dari form menu dulu memuat
 * ulang halaman — modal kategori (bukan portal) dirender DI DALAM form menu,
 * jadi Simpan kategori mengirim form menu secara native dan isiannya hilang.
 */
test("form menu: kategori baru tersimpan tanpa memuat ulang halaman, isian tetap", async ({ page, request }) => {
  await masukLewatSesi(page, request, OWNER_EMAIL, OWNER_PASS);
  await page.goto("/menu/baru");
  const namaMenu = page.locator("label", { hasText: "Nama menu" }).locator("xpath=following-sibling::input");
  await namaMenu.fill("Menu Uji W35");

  await page.getByRole("button", { name: "+ Kategori baru" }).click();
  await page.getByRole("button", { name: "+ Tambah Kategori" }).click();
  const namaKat = `Kat W35 ${Date.now() % 100000}`;
  const dialog = page.locator("form").filter({ has: page.getByRole("button", { name: "Simpan", exact: true }) }).last();
  await dialog.locator("input").first().fill(namaKat);
  await dialog.getByRole("button", { name: "Simpan", exact: true }).click();

  // Kategori muncul di daftar modal → simpan sungguh terjadi, bukan reload.
  await expect(page.locator("span", { hasText: namaKat })).toBeVisible();
  await page.getByRole("button", { name: "Tutup" }).click();
  await expect(page).toHaveURL(/\/menu\/baru$/);
  await expect(namaMenu).toHaveValue("Menu Uji W35");
  await expect(page.locator("select option", { hasText: namaKat })).toHaveCount(1);
});

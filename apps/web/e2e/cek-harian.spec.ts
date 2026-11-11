import { expect, test } from "@playwright/test";
import { OWNER_EMAIL, OWNER_PASS, masukLewatSesi } from "./util";

/**
 * CEK STOK HARIAN (permintaan pemilik 2026-11-11): closing cukup tandai tiap
 * bahan sesuai / tidak sesuai — tanpa jumlah. Yang tidak sesuai meminta jumlah
 * fisik sebelum bisa disimpan.
 */
test("cek stok harian: tandai sesuai semua → tersimpan; tidak sesuai meminta jumlah", async ({ page, request }) => {
  await masukLewatSesi(page, request, OWNER_EMAIL, OWNER_PASS);
  await page.goto("/stok/cek-harian");
  await expect(page.getByTestId("status-cek-harian")).toBeVisible();
  await expect(page.getByTestId("status-opname-mingguan")).toBeVisible();
  const baris = page.getByTestId("baris-cek-harian");
  await expect(baris.first()).toBeVisible();

  // Satu bahan TIDAK SESUAI → tombol simpan mati sampai jumlahnya diisi.
  await baris.first().getByRole("button", { name: "❌ Tidak sesuai" }).click();
  await page.getByTestId("tandai-semua-sesuai").click();
  const simpan = page.getByRole("button", { name: "Simpan cek harian" });
  await expect(simpan).toBeDisabled();
  await expect(page.getByText(/Isi jumlah fisik bahan yang tidak sesuai/)).toBeVisible();

  // Kembalikan ke sesuai → semua sesuai, tanpa opname.
  await baris.first().getByRole("button", { name: "✅ Sesuai" }).click();
  await expect(simpan).toBeEnabled();
  await simpan.click();
  await expect(page.getByTestId("hasil-cek-harian")).toContainText("0 tidak sesuai");
  await expect(page.getByTestId("status-cek-harian")).toContainText("sudah dicek");
});

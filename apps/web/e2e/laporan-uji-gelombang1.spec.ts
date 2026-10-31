import { expect, test } from "@playwright/test";
import { absenMasuk, masukLewatSesi, pastikanShiftTerbuka, tampak } from "./util";

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

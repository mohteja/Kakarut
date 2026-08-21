/**
 * Smoke test printer thermal memakai transport "mock" (di-seed lewat
 * localStorage): checkout → auto-print merekam byte ESC/POS; halaman
 * pengaturan printer render dan Cetak Tes berfungsi.
 */
import { expect, test } from "@playwright/test";
import {
  KASIR_EMAIL, KASIR_PASS, OWNER_EMAIL, OWNER_PASS,
  absenMasuk, kosongkanMeja, masukLewatSesi, pastikanShiftTerbuka, pilihMeja,
} from "./util";

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

test("checkout dengan auto-print merekam byte ESC/POS (init + TOTAL)", async ({ page, request }) => {
  const token = await absenMasuk(request, KASIR_EMAIL, KASIR_PASS);
  // Meja 2, BUKAN Meja 1: `pos.spec.ts` memakai Meja 1 dan berjalan lebih dulu.
  // Dua spec yang berbagi satu meja saling menjatuhkan lewat keadaan yang
  // ditinggalkan — dan merahnya muncul di spec yang tidak bersalah.
  await kosongkanMeja(request, token, "Meja 2");
  // Sesi ditanam, bukan lewat layar login: spec ini menguji CETAK, bukan login,
  // dan jatah `/auth/login` (10 per 5 menit) terlalu sempit untuk dihabiskan
  // oleh spec yang cuma menumpang lewat. Lihat `masukLewatSesi`.
  await masukLewatSesi(page, request, KASIR_EMAIL, KASIR_PASS);
  await page.goto("/kasir");
  await expect(page).toHaveURL(/\/kasir/);

  await pastikanShiftTerbuka(page);
  await pilihMeja(page, "Meja 2");
  // Kategorinya dibuka LEBIH DULU, bukan mengandalkan menu itu kebetulan
  // tampil: di basis data yang baru di-seed ia tidak tampil, dan uji ini lulus
  // hanya di basis data yang sudah dipakai — hijau yang bergantung pada riwayat.
  await page.getByRole("button", { name: "Paket Premium" }).click();
  await page.getByRole("button", { name: /Premium Basooopa A/ }).click();

  // checkout DUA langkah: Resume Order lalu panel pembayaran
  await page.getByRole("button", { name: /Lanjut →/ }).click();
  await page.getByRole("button", { name: /Lanjut ke Pembayaran/ }).click();
  await page.getByRole("button", { name: /Uang pas/ }).click();
  await page.getByRole("button", { name: /Simpan & Cetak/ }).click();
  // struk dirender portal `hidden print:block` — diperiksa dari ISInya
  await expect(page.locator("#struk-print")).toHaveCount(1);

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

  /*
   * NOMINALNYA ikut diperiksa, bukan cuma kata "TOTAL".
   *
   * Struk adalah catatan yang dibawa pulang tamu, dan yang tercetak dibangun
   * dari `toReceiptData()` — pemetaan tangan dari baris penjualan ke medan
   * struk. Asersi yang hanya mencari kata "TOTAL" tetap hijau kalau pemetaan
   * itu menaruh subtotal, atau angka transaksi lain, di tempat total.
   *
   * Pembandingnya diambil dari LAYAR (#struk-print), jadi yang dijaga adalah
   * kesetaraan dua jalur yang menghitung sendiri-sendiri: yang dilihat kasir
   * dan yang keluar dari printer. Keduanya harus menyebut angka yang sama.
   */
  const totalLayar = (await page.locator("#struk-print").innerText()).match(
    /TOTAL\s*Rp\s?([\d.]+)/,
  )?.[1];
  expect(totalLayar, "total tak terbaca dari struk layar").toBeTruthy();
  expect(text, `nominal cetak harus sama dengan layar (Rp${totalLayar})`).toContain(
    `Rp${totalLayar}`,
  );
});

test("halaman pengaturan printer render dan Cetak Tes merekam byte", async ({ page, request }) => {
  await masukLewatSesi(page, request, OWNER_EMAIL, OWNER_PASS);
  // Owner mendarat di /dashboard (lihat catatan di pos.spec.ts).
  await expect(page).toHaveURL(/\/dashboard/);

  await page.getByRole("link", { name: /Printer/ }).click();
  await expect(page).toHaveURL(/\/pengaturan\/printer/);
  // dua elemen memuat teks ini (judul halaman + judul kartu) → ambil yang pertama
  await expect(page.getByText("Pengaturan Printer").first()).toBeVisible();
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

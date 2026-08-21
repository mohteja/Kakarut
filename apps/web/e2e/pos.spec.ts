/**
 * Smoke test end-to-end: login kasir → POS → checkout → struk,
 * lalu login owner → cek stok & laporan.
 * Prasyarat: server jalan di E2E_BASE_URL (default :3000) dengan seed Basooopa.
 *
 * Layar kasir kini punya DUA prasyarat sebelum bisa berjualan: penjualnya harus
 * sudah ABSEN MASUK, lalu SHIFT-nya dibuka dengan modal awal. Keduanya penjaga
 * yang benar — `POST /shift/buka` membalas 400 "Absen masuk dulu sebelum buka
 * kasir", dan layarnya mengatakan hal yang sama. Prasyaratnya disiapkan lewat
 * API di `util.ts`; alasannya ada di sana.
 */
import { expect, test } from "@playwright/test";
import {
  KASIR_EMAIL, KASIR_PASS, OWNER_EMAIL, OWNER_PASS,
  absenMasuk, kosongkanMeja, login, pastikanShiftTerbuka, pilihMeja,
} from "./util";

test("kasir: POS → tambah menu → dine-in → checkout → struk", async ({ page, request }) => {
  const token = await absenMasuk(request, KASIR_EMAIL, KASIR_PASS);
  await kosongkanMeja(request, token, "Meja 1");
  await login(page, KASIR_EMAIL, KASIR_PASS);
  await expect(page).toHaveURL(/\/kasir/);

  await pastikanShiftTerbuka(page);
  await pilihMeja(page, "Meja 1");

  // tab kategori dari catOrder tampil
  await expect(page.getByRole("button", { name: "Paket Premium" })).toBeVisible();
  await page.getByRole("button", { name: "Paket Premium" }).click();

  // tambah PBA ke keranjang
  await page.getByRole("button", { name: /Premium Basooopa A/ }).click();
  await expect(page.getByText("Keranjang")).toBeVisible();

  // catatan personalisasi baris menu
  await page.getByPlaceholder(/tanpa gula/).fill("tanpa gula");

  /*
   * Checkout kini DUA LANGKAH, bukan satu tombol "Bayar & Cetak Struk":
   * Resume Order ("cocokkan pesanan dengan tamu") lalu panel pembayaran.
   * Langkah pertama itu yang membuat kasir melihat pesanannya sekali lagi
   * sebelum uang berpindah, jadi ia layak ikut diuji — bukan dilompati.
   */
  await page.getByRole("button", { name: /Lanjut →/ }).click();
  await expect(page.getByText(/Langkah 1 dari 2/)).toBeVisible();
  await page.getByRole("button", { name: /Lanjut ke Pembayaran/ }).click();

  // tunai, uang pas
  await page.getByRole("button", { name: /Uang pas/ }).click();
  await page.getByRole("button", { name: /Simpan & Cetak/ }).click();

  /*
   * Struknya diperiksa dari ISINYA, bukan dari `toBeVisible()`.
   *
   * `AreaCetak` merender struk lewat portal dengan kelas `hidden print:block`:
   * ia memang TAK TERLIHAT di layar dan baru muncul saat dicetak — itu inti
   * komponennya, dan komentarnya menjelaskan kenapa (`display`, bukan
   * `visibility`). Uji versi lama menuntut `toBeVisible()` karena ditulis
   * sebelum perubahan itu; menuntutnya lagi sekarang berarti menuntut struk
   * yang justru bocor ke layar.
   */
  await expect(page.locator("#struk-print")).toHaveCount(1);
  await expect(page.locator("#struk-print")).toContainText("TOTAL");
  await expect(page.locator("#struk-print")).toContainText(/PUSAT-\d{8}-\d{4}/);
  await expect(page.locator("#struk-print")).toContainText("Dine-in");
  // Label mejanya kini "Meja 1" saja — dulu "Meja: Meja 1". Yang dijaga tetap
  // sama: nama mejanya benar-benar tercetak di struk.
  await expect(page.locator("#struk-print")).toContainText("Meja 1");
  await expect(page.locator("#struk-print")).toContainText("tanpa gula");

  /*
   * Nomor struknya DICATAT, lalu dipakai untuk mencari transaksi yang SAMA di
   * Riwayat.
   *
   * Versi sebelumnya menekan `.first()` — diam-diam beranggapan transaksi
   * terbaru pasti milik uji ini. Itu benar hanya di basis data yang nyaris
   * kosong. Dijalankan sesudah verify-api (persis urutannya di CI), yang
   * teratas adalah penjualan milik verify-api, dan asersinya gagal menuntut
   * "tanpa gula" pada struk orang lain — merah yang tak mengatakan apa pun
   * tentang kode yang diuji.
   */
  const nomorStruk = (await page.locator("#struk-print").innerText()).match(
    /PUSAT-\d{8}-\d{4}/,
  )?.[0];
  expect(nomorStruk, "nomor struk tak terbaca dari area cetak").toBeTruthy();

  await page.getByRole("button", { name: "Transaksi Baru" }).click();
  await expect(page.locator("#struk-print")).toHaveCount(0);

  // cetak ulang dari Riwayat harus tetap memuat catatan per baris
  await page.goto("/kasir/riwayat");
  await page.getByRole("button", { name: new RegExp(nomorStruk!) }).first().click();
  await expect(page.locator("#struk-print")).toHaveCount(1);
  await expect(page.locator("#struk-print")).toContainText(nomorStruk!);
  await expect(page.locator("#struk-print")).toContainText("tanpa gula");
});

test("owner: stok menunjukkan pemakaian & laporan menampilkan omzet", async ({ page }) => {
  await login(page, OWNER_EMAIL, OWNER_PASS);
  /*
   * Owner mendarat di /dashboard, BUKAN /kasir.
   *
   * `App.tsx` menghitung beranda per peran (`beranda`): manajemen → /dashboard,
   * tim/kitchen/bar → /beranda, kasir → /kasir. Uji versi lama menuntut /kasir
   * karena ditulis sebelum dashboard ada; yang membuatnya "lulus" dulu cuma
   * kebetulan bahwa /kasir waktu itu beranda semua orang.
   */
  await expect(page).toHaveURL(/\/dashboard/);

  await page.getByRole("link", { name: "📦 Stok" }).click();
  await expect(page).toHaveURL(/\/stok/);
  const barisUrat = page.locator("tr", { hasText: "Baso urat besar" }).first();
  await expect(barisUrat).toBeVisible();
  await expect(barisUrat).toContainText("−"); // ada pemakaian

  // Nama dipatok PERSIS: sejak "🧹 Laporan Kebersihan" ada, pola /Laporan/
  // cocok ke DUA tautan dan Playwright menolak klik yang ambigu.
  await page.getByRole("link", { name: "📊 Laporan" }).click();
  await expect(page).toHaveURL(/\/laporan/);
  await expect(page.getByText("Omzet", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Estimasi Profit")).toBeVisible();

  // menu & HPP terlihat oleh owner
  await page.getByRole("link", { name: /Menu & HPP/ }).click();
  await expect(page.getByText("Paket Premium").first()).toBeVisible();
  await expect(page.locator("tr", { hasText: "Premium Basooopa A" }).first()).toBeVisible();
});

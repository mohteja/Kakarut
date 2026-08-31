/**
 * TOMBOL LIHAT PASSWORD — DIUKUR DI PERAMBAN, BUKAN DIBACA.
 *
 * Tiga hal yang tak bisa dijawab pembacaan kode, dan ketiganya justru yang
 * membuat tombol ini benar atau merusak:
 *
 * 1. **`type` medannya benar-benar berubah.** `aria-pressed` yang berpindah
 *    tanpa `type` yang ikut berpindah adalah tombol yang berpura-pura bekerja.
 * 2. **Isinya benar-benar terbaca.** Itu seluruh gunanya; medan yang jadi
 *    `text` tapi kosong karena nilainya tak diteruskan tak menolong siapa pun.
 * 3. **Menekannya TIDAK men-submit formulirnya.** Di dalam `<form>`, tombol
 *    tanpa `type="button"` adalah SUBMIT — dan orang menekan "lihat" justru
 *    pada saat ia BELUM yakin isinya benar. Salah di sini berarti tiap
 *    penekanan mengirim percobaan masuk yang gagal, memakan jatah batas laju
 *    login (10 per 5 menit) sampai orangnya terkunci karena mencoba berhati-hati.
 *
 * Layar Masuk dipakai karena ia tak butuh sesi — tak ada jatah login yang
 * terpakai, sebab formulirnya memang tak pernah dikirim di sini.
 */
import { expect, test } from "@playwright/test";

const RAHASIA = "Rahasia123!";

test("password: tombol lihat membuka & menutup, dan tak men-submit formulirnya", async ({
  page,
}) => {
  await page.goto("/login");

  /*
   * PERMINTAAN LOGIN DIHITUNG — dan itu pengganti asersi yang versi pertama
   * berkas ini pakai (URL tetap + tak ada pesan galat). Yang itu LOLOS ketika
   * `type="button"` dicabut, sebab medan email kosong dan `required`, jadi
   * validasi HTML5 menahan submitnya sebelum apa pun terkirim. Uji yang
   * tak bisa merah karena penghalang yang tak ada hubungannya tak menguji apa
   * pun; ketahuan hanya karena bukti merahnya dijalankan.
   *
   * Emailnya karena itu DIISI (dengan alamat khas uji ini, supaya jatah login
   * 10-per-5-menit milik akun seed tak tersentuh), sehingga formulirnya
   * benar-benar bisa terkirim bila tombolnya salah.
   */
  const permintaanLogin: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/auth/login")) permintaanLogin.push(r.url());
  });

  const medan = page.locator("#password");
  const tombol = page.getByRole("button", { name: "Tampilkan password" });

  await page.locator("#email").fill(`lihat-${Date.now()}@uji.local`);

  // PREMIS: medannya ada dan MULAI tersembunyi. Tanpa ini "berubah jadi text"
  // bisa benar karena ia memang text sejak awal.
  await expect(medan, "premis: medan password tampil").toBeVisible();
  await expect(medan).toHaveAttribute("type", "password");

  await medan.fill(RAHASIA);
  await tombol.click();

  await expect(medan, "menekan tombol tak mengubah type medannya").toHaveAttribute("type", "text");
  await expect(medan, "isinya hilang saat dibuka").toHaveValue(RAHASIA);

  // TIDAK men-submit — diukur dari permintaan yang benar-benar berangkat,
  // bukan dari jejak yang tersisa di layar.
  await expect
    .poll(() => permintaanLogin.length, {
      message: "menekan tombol lihat men-submit formulirnya (POST /auth/login berangkat)",
      timeout: 1500,
    })
    .toBe(0);

  // PASANGAN: dua arah. Tombol yang cuma bisa membuka meninggalkan password
  // terpampang di layar kasir yang dipakai bergantian.
  await page.getByRole("button", { name: "Sembunyikan password" }).click();
  await expect(medan, "tombolnya tak bisa menutup kembali").toHaveAttribute("type", "password");
  await expect(medan).toHaveValue(RAHASIA);
});

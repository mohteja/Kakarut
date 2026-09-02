import { expect, test } from "@playwright/test";

/**
 * SESI YANG MATI HARUS DIKATAKAN, BUKAN CUMA DILEMPAR KE /login.
 *
 * `lib/api.ts` memperlakukan 401 di luar login sebagai "sesi berakhir":
 * sesi lokal dihapus dan browser dipindah ke /login. Yang diukur di sini apa
 * yang DILIHAT orangnya sesudah pindah itu — token kedaluwarsa (12 jam),
 * password diganti di perangkat lain, akun dinonaktifkan admin, semuanya
 * berakhir di layar login yang sama. Tanpa satu kalimat pun, layar itu
 * terbaca sebagai "aplikasinya mengeluarkan saya tanpa sebab" — dan kasir
 * yang sedang mengetik pesanan kehilangan konteksnya tanpa tahu kenapa.
 *
 * Tokennya sengaja SAMPAH: yang diuji bukan cara token mati (itu §287
 * verify-api), melainkan bahwa setiap 401 sampai ke layar dengan sebabnya.
 */
test("sesi yang tak berlaku: halaman terlindung memantul ke /login DENGAN penjelasan", async ({ page }) => {
  // Ditanam SEKALI lewat evaluate, bukan addInitScript: init script berjalan
  // pada TIAP muat dokumen, jadi ia menanam ulang token sampah sesudah
  // dilempar ke /login dan aplikasinya berputar /login → /dashboard → /login
  // (terjadi pada jalan pertama spec ini).
  await page.goto("/login");
  await page.evaluate(() => {
    window.localStorage.setItem(
      "kakarut.auth",
      JSON.stringify({
        token: "token.sampah.kedaluwarsa",
        user: { sub: "x", email: "x@x", nama: "X", role: "owner", company_id: "c", branch_id: null, is_super_admin: false },
        company: null,
        branch: null,
      }),
    );
  });
  await page.goto("/kasir");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText(/Sesi Anda berakhir/)).toBeVisible();
  // Sesi sampahnya sudah dibuang — memuat ulang tak memantul lagi.
  expect(await page.evaluate(() => window.localStorage.getItem("kakarut.auth"))).toBeNull();
});

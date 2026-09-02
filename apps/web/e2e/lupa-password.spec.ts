import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { BASE, login } from "./util";

/**
 * ALUR LUPA / RESET PASSWORD — dilihat dari browser, bukan dari HTTP saja.
 *
 * Pemetaan cakupan 2026-09-02 menemukan `ForgotPasswordPage` dan
 * `ResetPasswordPage` tak pernah disentuh satu uji pun: bukan e2e, bukan
 * pemindai, bukan ledger. §97 `verify-api.sh` sudah mengetuk pintunya (token
 * bekas 400, token ngawur 400), tapi yang dilihat ORANG sesudah 400 itu —
 * apakah ia punya jalan keluar — tak pernah diukur. Dua cacat ketahuan pada
 * jalan pertama spec ini, keduanya di layar yang "sudah benar" di server:
 *
 *   1. akun yang belum terverifikasi bisa mereset passwordnya lewat tautan di
 *      inbox-nya, lalu ditolak "Email belum diverifikasi" saat masuk — padahal
 *      tautan itu sendiri bukti kepemilikan inbox yang sama kelasnya dengan
 *      kode verifikasi;
 *   2. tautan yang sudah terpakai menampilkan galat merah DAN formulirnya
 *      tetap ada; tombol "Minta tautan baru" hanya muncul bila `?token=` tak
 *      ada sama sekali.
 *
 * Tiap kasus memakai akun SEGAR lewat API: ember `batasLupa` (6 per 15 menit
 * per IP+email) dan ember login (10 per 5 menit per IP+email) keduanya
 * berkunci email, jadi email unik per jalan = kuota yang selalu penuh.
 * `dev_verify_kode`/`dev_reset_url` ada karena server uji tanpa SMTP; bila
 * suatu hari suite ini dijalankan terhadap server ber-SMTP, premisnya yang
 * merah, bukan asersinya.
 */

const PASS_LAMA = "LamaSekali123!";
const PASS_BARU = "BaruSekali123!";

function emailUnik(tanda: string) {
  return `lupa-${tanda}-${Date.now()}@contoh.id`;
}

async function daftar(request: APIRequestContext, email: string, verifikasi: boolean) {
  const r = await request.post(`${BASE}/api/auth/register`, {
    data: { nama: "Uji Lupa Password", email, password: PASS_LAMA },
  });
  expect(r.ok(), `register (${r.status()})`).toBeTruthy();
  const badan = (await r.json()) as { dev_verify_kode?: string };
  expect(
    badan.dev_verify_kode,
    "PREMIS: server uji harus tanpa SMTP supaya kode verifikasi dipulangkan",
  ).toBeTruthy();
  if (verifikasi) {
    const v = await request.post(`${BASE}/api/auth/verify-email`, {
      data: { email, kode: badan.dev_verify_kode },
    });
    expect(v.ok(), `verify-email (${v.status()})`).toBeTruthy();
  }
}

/** Minta tautan dari layar; pulangkan tautan dev-nya (null bila tak ada). */
async function mintaTautan(page: Page, email: string): Promise<string | null> {
  await page.goto("/lupa-password");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Kirim Tautan Reset" }).click();
  // Kalimat netralnya: sama untuk email terdaftar maupun tidak.
  await expect(page.getByText(/berlaku 1 jam/)).toBeVisible();
  const tautan = page.locator('a[href*="/reset-password?token="]');
  if ((await tautan.count()) === 0) return null;
  return tautan.first().getAttribute("href");
}

async function isiPasswordBaru(page: Page, password: string, konfirmasi: string) {
  await page.getByLabel("Password baru", { exact: true }).fill(password);
  await page.getByLabel("Ulangi password baru", { exact: true }).fill(konfirmasi);
}

test.describe("lupa / reset password dari browser", () => {
  test("jalur utuh: minta tautan → validasi → simpan → masuk dengan password baru → tautan bekas punya jalan keluar", async ({
    page,
    request,
  }) => {
    const email = emailUnik("utuh");
    await daftar(request, email, true);

    const tautan = await mintaTautan(page, email);
    expect(tautan, "PREMIS: tautan dev tampil untuk akun terdaftar (server uji tanpa SMTP)").toBeTruthy();
    await page.goto(tautan!);
    await expect(page.getByRole("heading", { name: "Atur Ulang Password" })).toBeVisible();

    // Validasi di layar, sebelum apa pun dikirim ke server.
    await isiPasswordBaru(page, "abc", "abc");
    await expect(page.getByText("Minimal 8 karakter.")).toBeVisible();
    await isiPasswordBaru(page, PASS_BARU, PASS_BARU + "x");
    await expect(page.getByText("Password tidak sama.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Simpan Password Baru" })).toBeDisabled();

    await isiPasswordBaru(page, PASS_BARU, PASS_BARU);
    await page.getByRole("button", { name: "Simpan Password Baru" }).click();
    await expect(page.getByText(/Password berhasil diatur ulang/)).toBeVisible();
    await page.getByRole("link", { name: "Masuk" }).click();
    await expect(page).toHaveURL(/\/login$/);

    // Tautan yang sama dibuka lagi SEBELUM masuk (rute publik hanya hidup
    // saat belum ada sesi): sudah mati — dan orangnya harus punya jalan keluar
    // yang terlihat, bukan formulir yang menolak diam-diam berulang.
    await page.goto(tautan!);
    await isiPasswordBaru(page, PASS_BARU, PASS_BARU);
    await page.getByRole("button", { name: "Simpan Password Baru" }).click();
    await expect(page.getByText(/tidak valid atau sudah kedaluwarsa/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Minta tautan baru" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Simpan Password Baru" })).toHaveCount(0);

    // Password baru benar-benar berlaku — dan yang lama tidak.
    await login(page, email, PASS_LAMA);
    await expect(page.getByText(/Email atau password salah/)).toBeVisible();
    await login(page, email, PASS_BARU);
    await expect(page).not.toHaveURL(/\/login$/);
  });

  test("akun yang BELUM terverifikasi: tautan reset di inbox-nya adalah bukti — sesudah reset ia bisa masuk", async ({
    page,
    request,
  }) => {
    const email = emailUnik("belum");
    await daftar(request, email, false);

    const tautan = await mintaTautan(page, email);
    expect(tautan, "PREMIS: tautan dev tampil").toBeTruthy();
    await page.goto(tautan!);
    await isiPasswordBaru(page, PASS_BARU, PASS_BARU);
    await page.getByRole("button", { name: "Simpan Password Baru" }).click();
    await expect(page.getByText(/Password berhasil diatur ulang/)).toBeVisible();

    await login(page, email, PASS_BARU);
    // URL dulu, baru teksnya: `toHaveCount(0)` puas SEKETIKA pada layar yang
    // belum sempat menjawab, jadi tanpa urutan ini asersi keduanya hijau
    // tanpa pernah menguji apa pun (terjadi pada jalan pertama spec ini).
    await expect(page).not.toHaveURL(/\/login$/);
    await expect(page.getByText(/belum diverifikasi/i)).toHaveCount(0);
  });

  test("email yang tak dikenal: kalimat yang SAMA, tanpa tautan — tak ada yang bisa ditebak dari layar", async ({
    page,
  }) => {
    const tautan = await mintaTautan(page, emailUnik("tak-dikenal"));
    expect(tautan).toBeNull();
  });

  test("halaman reset tanpa token: dikatakan, dan diberi jalan minta tautan", async ({ page }) => {
    await page.goto("/reset-password");
    await expect(page.getByText(/token tidak ada/)).toBeVisible();
    await page.getByRole("link", { name: "Minta tautan baru" }).click();
    await expect(page).toHaveURL(/\/lupa-password$/);
  });
});

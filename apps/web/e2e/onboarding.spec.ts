import { expect, test, type APIRequestContext } from "@playwright/test";
import { BASE, login } from "./util";

/**
 * HALAMAN WELCOME — akun yang baru daftar tak punya perusahaan.
 *
 * Daftar hanya membuat USER. Di halaman welcome orangnya memilih:
 *   - "Saya pemilik usaha" → mengisi profil usaha (jenis, alamat, telepon,
 *     zona waktu) lalu masuk sebagai owner;
 *   - "Saya karyawan" → menunggu. Halaman itu menanyakan undangan sendiri,
 *     jadi begitu owner menambahkan emailnya, kartu undangan MUNCUL TANPA
 *     MUAT ULANG — yang dijaga spec kedua.
 *
 * Akun dan tenant segar per jalan; pendaftarannya lewat IP sendiri
 * (`X-Forwarded-For`), sebab `batasRegister` 20/IP/jam dibagi verify-api.
 */

const PASS = "Welcome123!";
const XFF = { "X-Forwarded-For": "203.0.113.150" };

async function akunBaru(request: APIRequestContext, awalan: string, nama: string) {
  const email = `${awalan}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@contoh.id`;
  const daftar = await request.post(`${BASE}/api/auth/register`, {
    headers: XFF,
    data: { nama, email, password: PASS },
  });
  expect(daftar.ok(), `register (${daftar.status()})`).toBeTruthy();
  const { dev_verify_kode } = (await daftar.json()) as { dev_verify_kode?: string };
  expect(dev_verify_kode, "PREMIS: server uji tanpa SMTP memulangkan kode").toBeTruthy();
  const verif = await request.post(`${BASE}/api/auth/verify-email`, {
    headers: XFF,
    data: { email, kode: dev_verify_kode },
  });
  expect(verif.ok(), `verify-email (${verif.status()})`).toBeTruthy();
  const { token } = (await verif.json()) as { token: string };
  return { email, token };
}

test("pemilik usaha: welcome → isi profil (WITA) → masuk sebagai owner", async ({ page, request }) => {
  const { email } = await akunBaru(request, "welcome-pemilik", "Pemilik Welcome");
  await login(page, email, PASS);

  await expect(page.getByRole("heading", { name: "Selamat datang di Terakasir" })).toBeVisible();
  await expect(page.getByText("Bagaimana Anda memakai Terakasir?")).toBeVisible();
  await page.getByRole("button", { name: /Saya pemilik usaha/ }).click();

  const form = page.getByTestId("form-profil-usaha");
  await expect(form).toBeVisible();
  // Kosong → ditahan di klien dengan kalimat yang sama dengan server.
  await form.getByRole("button", { name: "Buat Perusahaan" }).click();
  await expect(form.getByText("Nama usaha wajib diisi")).toBeVisible();

  await form.getByLabel("Nama usaha").fill("Kedai Welcome E2E");
  await form.getByRole("button", { name: "Kafe & kedai kopi" }).click();
  await form.getByLabel("Alamat").fill("Jl. Pettarani No. 5, Makassar");
  await form.getByLabel("No. HP / telepon usaha").fill("0811 2222 3333");
  await form.getByLabel("Zona waktu").selectOption("Asia/Makassar");
  await form.getByRole("button", { name: "Buat Perusahaan" }).click();

  // Sesi berperusahaan → App meninggalkan halaman welcome.
  await expect(page.getByRole("heading", { name: "Selamat datang di Terakasir" })).toBeHidden({
    timeout: 15_000,
  });
  const sesi = (await page.evaluate(() => JSON.parse(localStorage.getItem("kakarut.auth") ?? "null"))) as {
    user: { role: string };
    company: { nama: string; timezone: string } | null;
  };
  expect(sesi.user.role).toBe("owner");
  expect(sesi.company?.nama).toBe("Kedai Welcome E2E");
  expect(sesi.company?.timezone).toBe("Asia/Makassar");
});

test("karyawan: welcome → tunggu diundang → undangan muncul sendiri → Terima", async ({ page, request }) => {
  // Owner dengan usaha sendiri (lewat API) — bukan tenant bersama spec lain.
  const owner = await akunBaru(request, "welcome-owner", "Owner Welcome");
  const usaha = await request.post(`${BASE}/api/onboarding/perusahaan`, {
    headers: { Authorization: `Bearer ${owner.token}` },
    data: {
      nama: "Warung Undangan E2E",
      jenis_usaha: "warung_makan",
      alamat: "Jl. Uji No. 1",
      telepon: "081234567890",
    },
  });
  expect(usaha.status(), "onboarding/perusahaan").toBe(201);
  const { token: tokenOwner } = (await usaha.json()) as { token: string };

  const karyawan = await akunBaru(request, "welcome-karyawan", "Karyawan Welcome");
  await login(page, karyawan.email, PASS);
  await page.getByRole("button", { name: /Saya karyawan/ }).click();
  const tunggu = page.getByTestId("langkah-tunggu");
  await expect(tunggu).toBeVisible();
  await expect(tunggu.getByText(karyawan.email)).toBeVisible();
  await expect(page.getByTestId("kartu-undangan")).toHaveCount(0);

  // Owner memakai "Tambah karyawan" biasa — email sudah punya akun → undangan.
  const cabang = (await (
    await request.get(`${BASE}/api/cabang`, { headers: { Authorization: `Bearer ${tokenOwner}` } })
  ).json()) as { id: string; tipe: string }[];
  const tambah = await request.post(`${BASE}/api/karyawan`, {
    headers: { Authorization: `Bearer ${tokenOwner}` },
    data: {
      nama: "Diketik Owner",
      email: karyawan.email,
      password: "PasswordOwner1",
      role: "cashier",
      branch_id: cabang.find((c) => c.tipe === "store")!.id,
    },
  });
  expect(tambah.status(), "Tambah karyawan dgn email terdaftar").toBe(200);
  expect(((await tambah.json()) as { diundang?: boolean }).diundang).toBe(true);

  // TANPA reload: halaman tunggu menanyakan sendiri tiap 10 detik.
  const kartu = page.getByTestId("kartu-undangan");
  await expect(kartu).toBeVisible({ timeout: 20_000 });
  await expect(kartu.getByText("Warung Undangan E2E")).toBeVisible();
  await kartu.getByRole("button", { name: "Terima" }).click();

  await expect(page.getByRole("heading", { name: "Selamat datang di Terakasir" })).toBeHidden({
    timeout: 15_000,
  });
  const sesi = (await page.evaluate(() => JSON.parse(localStorage.getItem("kakarut.auth") ?? "null"))) as {
    user: { role: string };
    company: { nama: string } | null;
  };
  expect(sesi.user.role).toBe("cashier");
  expect(sesi.company?.nama).toBe("Warung Undangan E2E");
});

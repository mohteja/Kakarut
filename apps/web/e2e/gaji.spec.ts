import { expect, test, type APIRequestContext } from "@playwright/test";
import { BASE, masukLewatSesi } from "./util";

/**
 * PENGGAJIAN (tahap 3, 2026-11-08) — alur HRD di layar:
 *   atur gaji karyawan → buat periode khusus 1 hari (hari ini) → isi bonus →
 *   finalkan → buka slip; lalu karyawannya melihat slip itu di Profil.
 *
 * Tenant SEGAR per jalan: verify-api §326 sudah membuat (dan membayar)
 * periode hari ini di perusahaan seed, dan periode tak boleh bertindih —
 * jadi spec ini tak bisa memakai tenant bersama. Pendaftaran lewat IP sendiri
 * (`X-Forwarded-For`), sebab `batasRegister` dibagi verify-api & onboarding.
 */

const PASS = "GajiE2ePass1!";
const XFF = { "X-Forwarded-For": "203.0.113.151" };

async function ownerSegar(request: APIRequestContext) {
  const email = `gaji-owner-${Date.now()}-${Math.floor(Math.random() * 1e6)}@contoh.id`;
  const daftar = await request.post(`${BASE}/api/auth/register`, {
    headers: XFF,
    data: { nama: "Owner Gaji E2E", email, password: PASS },
  });
  expect(daftar.ok(), `register (${daftar.status()})`).toBeTruthy();
  const { dev_verify_kode } = (await daftar.json()) as { dev_verify_kode?: string };
  const verif = await request.post(`${BASE}/api/auth/verify-email`, {
    headers: XFF,
    data: { email, kode: dev_verify_kode },
  });
  expect(verif.ok(), `verify-email (${verif.status()})`).toBeTruthy();
  const { token } = (await verif.json()) as { token: string };
  const usaha = await request.post(`${BASE}/api/onboarding/perusahaan`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { nama: "Kedai Gaji E2E", jenis_usaha: "warung_makan", alamat: "Jl. Gaji No. 1", telepon: "081234567890" },
  });
  expect(usaha.status(), "onboarding/perusahaan").toBe(201);
  return ((await usaha.json()) as { token: string }).token;
}

function hariIniJakarta(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
}

test("penggajian: HRD atur gaji, buat periode, bonus, finalkan; karyawan melihat slipnya", async ({
  page,
  browser,
  request,
}) => {
  const tokenOwner = await ownerSegar(request);
  const akhiran = `${Date.now() % 1000000}`;
  const emailHrd = `hrd.gaji.${akhiran}@contoh.id`;
  const emailKaryawan = `karyawan.gaji.${akhiran}@contoh.id`;
  for (const [nama, email, role] of [
    ["HRD Gaji", emailHrd, "hrd"],
    ["Karyawan Gaji E2E", emailKaryawan, "admin"],
  ]) {
    const r = await request.post(`${BASE}/api/karyawan`, {
      headers: { Authorization: `Bearer ${tokenOwner}` },
      data: { nama, email, password: PASS, role },
    });
    expect(r.status(), `POST /karyawan ${role}`).toBe(201);
  }

  page.on("dialog", (d) => d.accept());
  await masukLewatSesi(page, request, emailHrd, PASS);

  // 1) Atur gaji karyawan — bulanan Rp 3.000.000.
  await page.locator("aside nav").getByRole("link", { name: /Penggajian/ }).click();
  await expect(page).toHaveURL(/\/gaji$/);
  await page.getByRole("link", { name: "⚙️ Setelan Gaji" }).click();
  const baris = page.getByTestId("baris-setelan-gaji").filter({ hasText: "Karyawan Gaji E2E" });
  await expect(baris).toContainText("Belum diatur");
  await baris.getByRole("button", { name: "Atur" }).click();
  await page.getByLabel("Gaji per bulan (Rp)").fill("3000000");
  await page.getByRole("button", { name: "Simpan", exact: true }).click();
  await expect(baris).toContainText("Bulanan");

  // 2) Periode khusus satu hari (hari ini) — langsung dihitung server.
  await page.getByRole("link", { name: "📅 Periode" }).click();
  await page.getByLabel(/Periode khusus/).check();
  const hari = hariIniJakarta();
  await page.getByLabel("Mulai").fill(hari);
  await page.getByLabel("Selesai").fill(hari);
  await page.getByRole("button", { name: "Buat & hitung" }).click();
  await expect(page).toHaveURL(/\/gaji\/periode\/[0-9a-f-]+$/);
  const slip = page.getByTestId("baris-slip-gaji").filter({ hasText: "Karyawan Gaji E2E" });
  await expect(slip).toBeVisible();
  // HRD sendiri belum diatur gajinya → disebut, tak ikut dihitung.
  await expect(page.getByTestId("tanpa-setelan")).toContainText("HRD Gaji");

  // 3) Bonus Rp 250.000 di draft.
  await slip.getByRole("button", { name: "Bonus" }).click();
  await page.getByLabel("Bonus (Rp)").fill("250000");
  await page.getByLabel(/Catatan/).fill("Bonus target E2E");
  await page.getByRole("button", { name: "Simpan", exact: true }).click();
  await expect(slip).toContainText(/250\.000/);

  // 4) Finalkan → angka dikunci, tombol Bonus hilang.
  await page.getByRole("button", { name: /Finalkan/ }).click();
  await expect(page.getByText("Angka sudah dikunci")).toBeVisible();
  await expect(slip.getByRole("button", { name: "Bonus" })).toHaveCount(0);

  // 5) Slip rincian.
  await slip.getByRole("button", { name: "Slip" }).click();
  const modal = page.getByTestId("slip-gaji");
  await expect(modal).toContainText("Karyawan Gaji E2E");
  await expect(modal).toContainText("Bonus");
  await expect(modal).toContainText("Gaji diterima");
  await expect(modal).toContainText("Bonus target E2E");

  // 6) Karyawannya melihat slip itu sendiri di Profil.
  const halKaryawan = await browser.newPage();
  await masukLewatSesi(halKaryawan, request, emailKaryawan, PASS);
  await halKaryawan.goto("/profil");
  const daftar = halKaryawan.getByTestId("slip-gaji-saya");
  await expect(daftar.getByRole("button")).toHaveCount(1);
  await daftar.getByRole("button").click();
  await expect(halKaryawan.getByTestId("slip-gaji")).toContainText("Bonus target E2E");
  await halKaryawan.close();
});

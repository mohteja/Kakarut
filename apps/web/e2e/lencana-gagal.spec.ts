/**
 * LENCANA YANG LENYAP: gagal memuat ≠ nol.
 *
 * `badgeOranye(n)` merender `null` saat `n <= 0`, dan tiap lencana navigasi
 * meruntuhkan kegagalan jadi nol (`(pengajuanNav ?? []).length`,
 * `kebersihanNav?.kotor ?? 0`, `hitungBelum(prodNav?.rows)`). Jadi permintaan
 * yang GAGAL terlihat persis seperti "tidak ada yang menunggu" — di komponen
 * yang tampil di SETIAP layar, dengan `refetchInterval` 30–60 detik.
 *
 * Uji ini mengukurnya di peramban sungguhan: bukan status code, melainkan apa
 * yang terbaca di sidebar.
 */
import { expect, test } from "@playwright/test";
import { BASE, login, OWNER_EMAIL, OWNER_PASS } from "./util";

/** Satu pengajuan cuti berstatus `menunggu` supaya lencananya PUNYA angka. */
async function siapkanPengajuan(request: import("@playwright/test").APIRequestContext) {
  const masuk = await request.post(`${BASE}/api/auth/login`, {
    data: { email: OWNER_EMAIL, password: OWNER_PASS },
  });
  const token = (await masuk.json()).token as string;
  const h = { Authorization: `Bearer ${token}` };
  const ada = await request.get(`${BASE}/api/pengajuan?status=menunggu`, { headers: h });
  if (((await ada.json()) as unknown[]).length > 0) return token;
  const besok = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  const lusa = new Date(Date.now() + 4 * 86_400_000).toISOString().slice(0, 10);
  await request.post(`${BASE}/api/pengajuan`, {
    headers: h,
    data: { kategori: "izin", tanggal_mulai: besok, tanggal_selesai: lusa, alasan: "uji lencana" },
  });
  return token;
}

const LENCANA = "nav-lencana-pengajuan";

test("lencana pengajuan: jaringan sehat → menyebut angkanya", async ({ page, request }) => {
  await siapkanPengajuan(request);
  await login(page, OWNER_EMAIL, OWNER_PASS);
  // Sidebar dan drawer merender nav yang SAMA, jadi lencananya muncul dua kali.
  const l = page.getByTestId(LENCANA).first();
  await expect(l).toBeVisible({ timeout: 10_000 });
  // PASANGAN dari uji di bawah: angka yang benar tetap tampil sebagai angka.
  await expect(l).toHaveText(/^\d+$/);
});

test("lencana pengajuan: permintaannya GAGAL → tanda, bukan senyap", async ({ page, request }) => {
  await siapkanPengajuan(request);
  await page.route("**/api/pengajuan?status=menunggu", (r) =>
    r.fulfill({ status: 500, contentType: "application/json", body: '{"error":"x"}' }),
  );
  await login(page, OWNER_EMAIL, OWNER_PASS);
  // Tautannya sendiri HARUS tetap ada — yang diuji lencananya, bukan menunya.
  await expect(page.getByRole("link", { name: /Rekap Absen/ }).first()).toBeVisible({
    timeout: 10_000,
  });
  // Sidebar dan drawer merender nav yang SAMA, jadi lencananya muncul dua kali.
  const l = page.getByTestId(LENCANA).first();
  /*
   * INTI. Sebelum vena ini: lencananya LENYAP — tak terbedakan dari "tidak ada
   * yang menunggu". Sesudah: ia tetap ada dan TIDAK berisi angka, sehingga tak
   * bisa dibaca sebagai jumlah.
   */
  await expect(l).toBeVisible({ timeout: 10_000 });
  await expect(l).not.toHaveText(/\d/);
});

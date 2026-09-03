import { expect, test, type APIRequestContext } from "@playwright/test";
import { BASE, masukLewatSesi, OWNER_EMAIL, OWNER_PASS, sesiApi } from "./util";

/**
 * ANTREAN PUTUSAN SELISIH KAS TERLIHAT DARI LUAR HALAMANNYA.
 *
 * Panel di halaman Operasional Cabang sudah dibangun hati-hati — ia membedakan
 * "gagal terbaca" dari "kosong", dan mengaku saat daftarnya terpotong. Tapi ia
 * hanya bekerja pada orang yang sudah membuka halamannya. Pemilik repo
 * menemukan 26 selisih menunggu, yang tertua dua belas hari, dan menulis:
 * "selisih tidak ada notif harus di putuskan".
 *
 * Spec ini menguji yang tak bisa dilihat pemindai sumber: apa yang benar-benar
 * TERBACA di sidebar dan di Beranda, dari halaman yang bukan Operasional.
 *
 * PREMISNYA DIBUKTIKAN, tidak diasumsikan: tanpa satu pun selisih menunggu,
 * "lencananya berangka" akan merah dan "kartunya tampil" akan merah — tapi
 * karena SEBAB YANG SALAH. `verify-api.sh` berjalan lebih dulu di gerbang dan
 * meninggalkan antrean yang tak kosong; kalau suatu hari tidak, premis di
 * bawah yang merah, dan itu memang yang ingin diketahui.
 */

const LENCANA = "nav-lencana-selisih";

async function jumlahMenunggu(request: APIRequestContext): Promise<number> {
  const { token } = await sesiApi(request, OWNER_EMAIL, OWNER_PASS);
  const r = await request.get(`${BASE}/api/shift/selisih/ringkas`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(r.ok(), `GET /shift/selisih/ringkas (${r.status()})`).toBeTruthy();
  return ((await r.json()) as { menunggu: number }).menunggu;
}

test("lencana + kartu beranda menyebut antrean putusan dari luar halamannya", async ({
  page,
  request,
}) => {
  const menunggu = await jumlahMenunggu(request);
  expect(
    menunggu,
    "PREMIS: harus ada selisih yang menunggu, kalau tidak seluruh spec ini hampa",
  ).toBeGreaterThan(0);

  await masukLewatSesi(page, request, OWNER_EMAIL, OWNER_PASS);

  // Halaman yang BUKAN Operasional Cabang — di sanalah dulu antrean ini tak
  // punya satu pun tanda.
  await page.goto("/menu");
  await expect(page.getByRole("heading", { name: /Menu & HPP/ })).toBeVisible();
  // Sidebar dan drawer merender nav yang SAMA, jadi lencananya muncul dua kali.
  const lencana = page.getByTestId(LENCANA).first();
  await expect(lencana).toBeVisible({ timeout: 10_000 });
  await expect(lencana).toHaveText(String(menunggu));

  // Beranda: kartunya menyebut jumlahnya dan menawarkan jalan ke putusannya.
  await page.goto("/dashboard");
  const kartu = page.getByText(/selisih kas menunggu keputusan Anda/);
  await expect(kartu).toBeVisible({ timeout: 10_000 });
  const tombol = page.getByRole("link", { name: /Putuskan sekarang/ });
  await expect(tombol).toBeVisible();
  await tombol.click();
  await expect(page).toHaveURL(/\/operasional$/);
  // Sampai di tempat yang dijanjikan: panel antrean itu sendiri.
  await expect(page.getByText(/Selisih kas menunggu keputusan Anda/).first()).toBeVisible();
});

test("bacaannya GAGAL → tanda, bukan angka nol dan bukan senyap", async ({ page, request }) => {
  expect(
    await jumlahMenunggu(request),
    "PREMIS: harus ada selisih yang menunggu",
  ).toBeGreaterThan(0);

  await page.route("**/api/shift/selisih/ringkas", (r) =>
    r.fulfill({ status: 500, contentType: "application/json", body: '{"error":"x"}' }),
  );
  await masukLewatSesi(page, request, OWNER_EMAIL, OWNER_PASS);
  await page.goto("/dashboard");

  /*
   * INTI, dan aturan yang sudah dibayar repo ini sekali: "lencana gagal ≠
   * lencana nol". Lencana yang lenyap — atau berbunyi "0" — mengatakan "tak
   * ada yang menunggu keputusanmu", satu-satunya kalimat yang seluruh putaran
   * ini dibuat untuk mencegah.
   */
  const lencana = page.getByTestId(LENCANA).first();
  await expect(lencana).toBeVisible({ timeout: 10_000 });
  await expect(lencana).not.toHaveText(/\d/);

  // Kartunya pun tidak lenyap diam-diam: ia mengatakan bahwa ia tak tahu.
  await expect(page.getByText(/tidak terbaca/)).toBeVisible();
  await expect(page.getByText(/bukan.*berarti tak ada yang perlu diputuskan/)).toBeVisible();
});

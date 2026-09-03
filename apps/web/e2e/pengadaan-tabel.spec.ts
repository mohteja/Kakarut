import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { BASE, masukLewatSesi, OWNER_EMAIL, OWNER_PASS, sesiApi } from "./util";

/**
 * RIWAYAT PENGADAAN: TABEL, DAN RINGKASAN YANG TAK IKUT BERGANTI HALAMAN.
 *
 * Sampai putaran ini `/produksi` dan `/pembelian` tak disentuh SATU PUN spec
 * e2e, padahal keduanya dirender komponen yang sama (`TambahStokPage`, 1.351
 * baris) dan dipakai tiga kelompok peran.
 *
 * Lengan yang paling penting di bawah adalah **halaman kedua**: ubin ringkasan
 * harus TETAP sementara isi tabelnya berganti. Itu satu-satunya cara
 * membuktikan angkanya datang dari agregat server dan bukan dari baris yang
 * kebetulan sedang tampil — dan bedanya bukan teoretis: server mengurutkan
 * faktur yang belum selesai lebih dulu, jadi ringkasan dari halaman berjalan
 * akan berbunyi "0 selesai" di halaman pertama mana pun.
 */

async function ringkasServer(request: APIRequestContext, jalur: "produksi" | "pembelian") {
  const { token } = await sesiApi(request, OWNER_EMAIL, OWNER_PASS);
  const r = await request.get(`${BASE}/api/${jalur}?branch_id=all&per_page=20&page=1`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(r.ok(), `GET /${jalur} (${r.status()})`).toBeTruthy();
  return (await r.json()) as {
    total: number;
    ringkas: {
      harus_dikerjakan: { faktur: number; bahan: number };
      selesai: { faktur: number; bahan: number };
    };
  };
}

/** Nomor dokumen baris pertama — penanda "halaman ini berisi faktur yang mana". */
async function dokumenBarisPertama(page: Page): Promise<string> {
  return (await page.locator("table tbody tr").first().innerText()).slice(0, 40);
}

test("riwayat produksi dirender tabel, dengan kolom yang peka jalur", async ({ page, request }) => {
  const data = await ringkasServer(request, "produksi");
  expect(data.total, "PREMIS: harus ada faktur produksi").toBeGreaterThan(0);

  await masukLewatSesi(page, request, OWNER_EMAIL, OWNER_PASS);
  await page.goto("/produksi");
  await expect(page.getByRole("heading", { name: "Produksi Bahan Baku" })).toBeVisible();
  // Judul halaman muncul sebelum daftarnya tiba; tunggu barisnya, atau
  // `allTextContents()` memulangkan larik kosong dan asersinya merah karena
  // waktu, bukan karena kolomnya salah.
  await expect(page.locator("table tbody tr").first()).toBeVisible({ timeout: 10_000 });

  const kolom = await page.locator("table thead th").allTextContents();
  expect(kolom).toEqual(["Dokumen", "Dibuat", "Bahan", "Tahap", "Lokasi", "Divisi", "Orang", "Aksi"]);
  expect(await page.locator("table tbody tr").count()).toBeGreaterThan(0);

  // Jalur beli berbagi komponen yang sama, dan kolomnya HARUS berbeda:
  // produksi sengaja tak menampilkan uang (bahannya sudah dibeli di Beli Bahan
  // Baku), beli tak punya divisi Kitchen/Bar.
  await page.goto("/pembelian");
  await expect(page.getByRole("heading", { name: "Beli Bahan Baku" })).toBeVisible();
  await expect(page.locator("table tbody tr").first()).toBeVisible({ timeout: 10_000 });
  expect(await page.locator("table thead th").allTextContents()).toEqual([
    "Dokumen",
    "Dibuat",
    "Bahan",
    "Tahap",
    "Lokasi",
    "Nilai",
    "Orang",
    "Aksi",
  ]);
});

test("ubin menyebut angka SERVER, dan tak berubah saat pindah halaman", async ({
  page,
  request,
}) => {
  const data = await ringkasServer(request, "produksi");
  expect(
    data.total,
    "PREMIS: butuh lebih dari satu halaman, kalau tidak lengan ini hampa",
  ).toBeGreaterThan(20);

  await masukLewatSesi(page, request, OWNER_EMAIL, OWNER_PASS);
  await page.goto("/produksi");
  await expect(page.getByRole("heading", { name: "Produksi Bahan Baku" })).toBeVisible();

  // Ubinnya menyebut angka yang SAMA dengan agregat server.
  const harus = page.getByText(`${data.ringkas.harus_dikerjakan.faktur} faktur`).first();
  await expect(harus).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("HARUS DIKERJAKAN", { exact: false }).first()).toBeVisible();

  /*
   * INTI. Halaman pertama berisi faktur yang belum selesai (server
   * mengurutkannya lebih dulu), jadi ringkasan yang dijumlahkan dari baris
   * tampil akan berbunyi "N faktur / 0 selesai" di sini. Pindah halaman:
   * barisnya berganti, ubinnya TIDAK.
   */
  const sebelum = await dokumenBarisPertama(page);
  await page.getByRole("button", { name: "Berikutnya ›" }).click();
  await expect
    .poll(async () => dokumenBarisPertama(page), { timeout: 10_000 })
    .not.toBe(sebelum);

  await expect(page.getByText(`${data.ringkas.harus_dikerjakan.faktur} faktur`).first()).toBeVisible();
  await expect(page.getByText(`${data.ringkas.selesai.faktur} faktur`).first()).toBeVisible();
});

test("baris diklik membuka detail faktur", async ({ page, request }) => {
  const data = await ringkasServer(request, "produksi");
  expect(data.total, "PREMIS: harus ada faktur").toBeGreaterThan(0);

  await masukLewatSesi(page, request, OWNER_EMAIL, OWNER_PASS);
  await page.goto("/produksi");
  await expect(page.locator("table tbody tr").first()).toBeVisible({ timeout: 10_000 });

  // Klik di sel yang BUKAN tombol — `TabelResponsif` sengaja mengabaikan klik
  // yang lahir dari button/select di dalam sel.
  await page.locator("table tbody tr").first().locator("td").nth(2).click();
  await expect(page.getByRole("dialog").or(page.locator(".fixed").first())).toBeVisible({
    timeout: 10_000,
  });
});

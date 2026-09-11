/**
 * SPANDUK PEMOTONGAN — kalimat yang hanya muncul saat datanya BESAR, dan
 * karena itu tak pernah terlihat siapa pun.
 *
 * Enam bendera `*_terpotong` hidup di kontrak (`TransferStokDaftar`,
 * `SupplierKartu`, `CustomerDetail`, `LaporanDurasiPesanan`, `ShiftDetail`,
 * `RiwayatHargaDto`), dirender di tujuh situs web — dan **nol** spec peramban
 * pernah menyebut satu pun. Sebabnya struktural, bukan kelalaian: benderanya
 * baru menyala di atas 50–500 baris, jadi memunculkannya dari data sungguhan
 * menuntut membuat ratusan baris di basis data yang dipakai bersama.
 *
 * Yang dipakai di sini: balasan SERVER yang sungguhan diambil apa adanya
 * (`route.fetch()`), lalu SATU medan boolean-nya dibalik sebelum diteruskan.
 * Bentuknya tetap bentuk server — tak ada baris karangan yang bisa basi saat
 * kontraknya berubah — dan yang diuji persis pertanyaannya: **kalau server
 * berkata daftarnya terpotong, apakah layarnya mengatakannya?**
 *
 * Batasnya ditulis jujur: ini TIDAK membuktikan server benar-benar memotong
 * pada ambangnya. Itu sudah dipaku verify-api §308 dari kawat (`per_page=1`),
 * dan kedua arah itu memang dua pertanyaan yang berbeda.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { BASE, OWNER_EMAIL, OWNER_PASS, masukLewatSesi, sesiApi } from "./util";

/**
 * "Spanduknya TIDAK ada" hanya sah SESUDAH halamannya benar-benar termuat.
 *
 * Versi pertama spec ini memakai `toHaveCount(0)` begitu `goto` selesai — dan
 * itu lolos pada DOM yang masih kosong. Terbukti: bukti merah yang membuat
 * spanduk kartu supplier SELALU tampil (`{true && …}`) tetap HIJAU. Asersi
 * yang benar menunggu penanda bahwa datanya sudah dirender lebih dulu.
 */
async function tanpaSpanduk(siap: Locator, spanduk: Locator, sebab: string): Promise<void> {
  await expect(siap, `halamannya tak pernah termuat — ${sebab}`).toBeVisible();
  await expect(spanduk, sebab).toHaveCount(0);
}

/**
 * Teruskan balasan server apa adanya, dengan SATU bendera dipaksa `true`.
 * Dikembalikan juga nilai ASLI-nya, supaya premis "hari ini tak terpotong"
 * tak perlu diasumsikan.
 */
async function paksaTerpotong(page: Page, glob: string, medan: string): Promise<void> {
  await page.route(glob, async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as Record<string, unknown>;
    body[medan] = true;
    await route.fulfill({ response: res, json: body });
  });
}

test("spanduk pemotongan: layar mengatakan daftarnya terpotong — tiga bentuk, dua arah", async ({
  page,
  request,
}) => {
  const { token } = await sesiApi(request, OWNER_EMAIL, OWNER_PASS);
  const h = { Authorization: `Bearer ${token}` };

  // ── PREMIS: hari ini tak satu pun daftarnya terpotong ────────────────────
  // Tanpa ini, "spanduk tak tampak" pada lengan negatif tak menyatakan apa pun.
  const supplier = (await (await request.get(`${BASE}/api/supplier`, { headers: h })).json()) as {
    id: string;
    nama: string;
  }[];
  expect(supplier.length, "tak ada supplier — premisnya runtuh").toBeGreaterThan(0);
  const sup = supplier[0];

  const hariIni = new Date().toISOString().slice(0, 10);
  const asli = {
    transfer: (await (await request.get(`${BASE}/api/transfer-stok`, { headers: h })).json()) as {
      rows_terpotong: boolean;
    },
    kartu: (await (
      await request.get(`${BASE}/api/supplier/${sup.id}/kartu`, { headers: h })
    ).json()) as { rows_terpotong: boolean },
    durasi: (await (
      await request.get(
        `${BASE}/api/laporan/durasi-pesanan?dari=${hariIni}&sampai=${hariIni}`,
        { headers: h },
      )
    ).json()) as { riwayat_terpotong: boolean },
  };
  expect(asli.transfer.rows_terpotong, "/transfer-stok sudah terpotong").toBe(false);
  expect(asli.kartu.rows_terpotong, "kartu supplier sudah terpotong").toBe(false);
  expect(asli.durasi.riwayat_terpotong, "laporan durasi sudah terpotong").toBe(false);

  await masukLewatSesi(page, request, OWNER_EMAIL, OWNER_PASS);

  // ── 1. /transfer-stok — TransferStokDaftar.rows_terpotong ────────────────
  const spandukTransfer = page.getByText(/Masih ada transfer yang lebih lama/);
  // Penanda "riwayatnya selesai dimuat": salah satu dari dua cabang pasca-muat.
  const riwayatSiap = page.getByText(/Belum ada transfer stok\.|🔄 Transfer/).first();
  await page.goto("/transfer-stok");
  await tanpaSpanduk(riwayatSiap, spandukTransfer, "belum dipaksa, spanduknya sudah muncul");

  await paksaTerpotong(page, "**/api/transfer-stok", "rows_terpotong");
  await page.goto("/transfer-stok");
  await expect(spandukTransfer).toBeVisible();
  await expect(spandukTransfer).toContainText(/transfer terbaru/);

  // ── 2. kartu supplier — SupplierKartu.rows_terpotong ─────────────────────
  // Kalimat ini yang paling mahal bila hilang: `total_belanja` dihitung TANPA
  // batas, jadi orang mencocokkannya dengan daftar pendek dan mengira
  // pembukuannya yang salah.
  const spandukKartu = page.getByText(/Total belanja.*sudah menghitung\s+semuanya/s);
  // Blok ini hanya dirender SESUDAH `isLoading` selesai — jadi ia penanda muat.
  const kartuSiap = page.getByText("Total belanja (diterima ✓)");
  await page.goto(`/pengaturan/supplier/${sup.id}`);
  await tanpaSpanduk(kartuSiap, spandukKartu, "belum dipaksa, spanduknya sudah muncul");

  await paksaTerpotong(page, "**/api/supplier/*/kartu", "rows_terpotong");
  await page.goto(`/pengaturan/supplier/${sup.id}`);
  await expect(spandukKartu).toBeVisible();
  await expect(spandukKartu).toContainText(/transaksi terbaru/);

  // ── 3. laporan durasi — LaporanDurasiPesanan.riwayat_terpotong ───────────
  // Di sini kedua arahnya punya KALIMAT, jadi lengan negatifnya bukan sekadar
  // ketiadaan: layar yang lupa bercabang akan tertangkap dua kali.
  const utuh = page.getByText(/seluruh \d+ sajian yang terhitung ada di sini/);
  const terpotongLap = page.getByText(/menampilkan.*dari.*sajian yang terhitung/s);
  await page.goto("/laporan/durasi-pesanan");
  await expect(utuh).toBeVisible();
  await expect(terpotongLap).toHaveCount(0);

  await paksaTerpotong(page, "**/api/laporan/durasi-pesanan**", "riwayat_terpotong");
  await page.goto("/laporan/durasi-pesanan");
  await expect(terpotongLap).toBeVisible();
  await expect(utuh, "kalimat 'seluruhnya' TETAP ada padahal terpotong").toHaveCount(0);
});

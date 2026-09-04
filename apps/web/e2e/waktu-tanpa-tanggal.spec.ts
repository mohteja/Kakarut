import { expect, test, type APIRequestContext } from "@playwright/test";
import { BASE, masukLewatSesi, OWNER_EMAIL, OWNER_PASS, sesiApi } from "./util";

/**
 * DAFTAR LINTAS-HARI YANG CUMA MENYEBUT JAM — dua lengan, dua bentuk.
 *
 * `formatWaktu` di web memulangkan jam-menit saja. Riwayat SO memakainya
 * telanjang sampai pemilik melaporkannya; sapuan sesudahnya menemukan lima
 * berkas lain. Dua yang dijaga di peramban di bawah dipilih karena BENTUKNYA
 * berbeda dari tabel SO yang sudah punya lengannya sendiri:
 *
 *   1. KARTU Beli Perlengkapan — bentuk bawaan halaman itu. Tabelnya bertanggal
 *      sejak lahir; kartunya tidak. Dua bentuk di halaman yang sama menjawab
 *      beda soal faktur yang sama, dan yang salah justru yang dilihat orang
 *      pertama kali.
 *   2. MODAL riwayat opname di tab Stok Perlengkapan — daftar sesi yang
 *      spanduknya sendiri berbunyi "sesi terakhir", di dalam modal yang dibuka
 *      lewat dua klik dari halaman Stok.
 *
 * Harapannya dihitung dari `waktu` yang dikirim server, bukan diketik: kalau
 * `formatTanggalJam` kembali memulangkan jam saja, lengannya merah dengan
 * menyebut tanggal yang seharusnya terbaca.
 */

async function token(request: APIRequestContext) {
  const { token } = await sesiApi(request, OWNER_EMAIL, OWNER_PASS);
  return { Authorization: `Bearer ${token}` };
}

/** Tanggal yang SEHARUSNYA tampil untuk sebuah stempel — aturan `formatTanggalRingkas`. */
function tanggalHarusnya(iso: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  }).format(new Date(iso));
}

test("kartu Beli Perlengkapan (bentuk bawaan) menyebut TANGGAL fakturnya", async ({
  page,
  request,
}) => {
  const r = await request.get(`${BASE}/api/perlengkapan/beli?per_page=1`, {
    headers: await token(request),
  });
  expect(r.ok(), `GET /perlengkapan/beli (${r.status()})`).toBeTruthy();
  const { rows } = (await r.json()) as { rows: { nomor: string | null; waktu: string }[] };
  expect(rows.length, "PREMIS: butuh minimal satu faktur beli perlengkapan").toBeGreaterThan(0);
  const teratas = rows[0]!;
  expect(teratas.nomor, "PREMIS: faktur teratas harus bernomor — kartunya dicari lewat nomor").toBeTruthy();

  await masukLewatSesi(page, request, OWNER_EMAIL, OWNER_PASS);
  // Konteks peramban baru → localStorage kosong → bentuk bawaan (kartu) yang
  // tampil. Dipastikan, bukan diandaikan: kalau sakelarnya pernah diubah jadi
  // tabel sebagai bawaan, lengan ini menguji hal yang salah tanpa suara.
  await page.goto("/perlengkapan/beli");
  await expect(page.getByRole("button", { name: "🗂 Kartu" })).toBeVisible();
  const nomor = page.getByText(teratas.nomor!, { exact: true }).first();
  await expect(nomor).toBeVisible({ timeout: 10_000 });

  // Kartunya = leluhur terdekat yang bisa diklik (Card ber-cursor-pointer).
  const kartu = nomor.locator("xpath=ancestor::*[contains(@class,'cursor-pointer')][1]");
  const harusnya = tanggalHarusnya(teratas.waktu);
  await expect(kartu, `kartu ${teratas.nomor} harus memuat "${harusnya}"`).toContainText(harusnya);
});

test("modal riwayat opname di tab Stok Perlengkapan menyebut TANGGAL tiap sesi", async ({
  page,
  request,
}) => {
  const r = await request.get(`${BASE}/api/perlengkapan/opname/riwayat`, {
    headers: await token(request),
  });
  expect(r.ok(), `GET /perlengkapan/opname/riwayat (${r.status()})`).toBeTruthy();
  const sesi = (await r.json()) as { nomor: string | null; waktu: string }[];
  expect(sesi.length, "PREMIS: butuh minimal satu sesi opname perlengkapan di cabang bawaan").toBeGreaterThan(0);
  const teratas = sesi[0]!;
  expect(teratas.nomor, "PREMIS: sesi teratas harus bernomor").toBeTruthy();

  await masukLewatSesi(page, request, OWNER_EMAIL, OWNER_PASS);
  await page.goto("/stok");
  // Tab-nya `useState`, bukan URL — jadi diklik, bukan dituju lewat ?tab=.
  await page.getByRole("button", { name: "🧰 Perlengkapan" }).click();
  await page.getByRole("button", { name: "🗂 Riwayat Opname" }).click();
  await expect(page.getByText("🗂 Riwayat Opname Perlengkapan")).toBeVisible();

  const nomor = page.getByText(teratas.nomor!, { exact: true }).first();
  await expect(nomor).toBeVisible({ timeout: 10_000 });
  // Tiap sesi dirender sebagai <button> yang membungkus nomor + stempelnya.
  const baris = nomor.locator("xpath=ancestor::button[1]");
  const harusnya = tanggalHarusnya(teratas.waktu);
  await expect(baris, `sesi ${teratas.nomor} harus memuat "${harusnya}"`).toContainText(harusnya);
});

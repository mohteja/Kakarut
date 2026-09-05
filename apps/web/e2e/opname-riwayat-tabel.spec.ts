import { expect, test, type APIRequestContext } from "@playwright/test";
import { BASE, masukLewatSesi, OWNER_EMAIL, OWNER_PASS, sesiApi } from "./util";

/**
 * RIWAYAT STOCK OPNAME: TANGGALNYA BENAR-BENAR SAMPAI KE LAYAR.
 *
 * Sampai putaran ini halaman `/stok/opname/riwayat` tak disentuh satu pun spec
 * e2e, dan cacat yang dilaporkan pemilik justru cacat yang hanya kelihatan di
 * layar: kodenya memanggil `formatWaktu(s.waktu)` — benar secara tipe, hijau
 * di typecheck, hijau di seluruh vitest — dan yang salah adalah APA YANG
 * DIPULANGKANNYA. Jam dan menit saja, tanpa sehari pun tanggal.
 *
 * Karena itu lengan di bawah TIDAK memeriksa "ada kolom bernama Tanggal"; itu
 * sudah dijaga penjaga statis. Yang diperiksa di sini: teks yang benar-benar
 * dirender sel itu MEMUAT tanggal dari `waktu` yang dikirim server.
 */

type SesiOpname = { session_id: string; nomor: string | null; waktu: string; status: string };

async function riwayatServer(
  request: APIRequestContext,
  jalur: "stok/opname/riwayat" | "perlengkapan/opname/riwayat",
): Promise<SesiOpname[]> {
  const { token } = await sesiApi(request, OWNER_EMAIL, OWNER_PASS);
  const r = await request.get(`${BASE}/api/${jalur}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(r.ok(), `GET /${jalur} (${r.status()})`).toBeTruthy();
  return (await r.json()) as SesiOpname[];
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

test("riwayat SO bahan baku: tabel, dan kolom Tanggal memuat TANGGAL", async ({ page, request }) => {
  const sesi = await riwayatServer(request, "stok/opname/riwayat");
  expect(sesi.length, "PREMIS: harus ada sesi opname bahan di basis uji").toBeGreaterThan(0);

  await masukLewatSesi(page, request, OWNER_EMAIL, OWNER_PASS);
  await page.goto("/stok/opname/riwayat");
  await expect(page.getByRole("heading", { name: "Riwayat Stock Opname" })).toBeVisible();
  // Judulnya muncul sebelum daftarnya tiba; tanpa menunggu barisnya,
  // `allTextContents()` memulangkan larik kosong dan asersinya merah karena
  // WAKTU, bukan karena kolomnya salah.
  await expect(page.locator("table tbody tr").first()).toBeVisible({ timeout: 10_000 });

  expect(await page.locator("table thead th").allTextContents()).toEqual([
    "Nomor",
    "Tanggal",
    "Jam",
    "Oleh",
    "Item",
    "Catatan",
    "Status",
  ]);

  /*
   * INTI. Sel Tanggal baris pertama wajib memuat tanggal dari `waktu` sesi
   * teratas yang dikirim server. Kalau `formatWaktu` kembali dipakai di sana,
   * selnya berisi "18.42" dan asersi ini merah dengan menyebut apa yang
   * seharusnya terbaca.
   */
  const selTanggal = page.locator("table tbody tr").first().locator("td").nth(1);
  const harusnya = tanggalHarusnya(sesi[0]!.waktu);
  await expect(selTanggal, `kolom Tanggal harus memuat "${harusnya}"`).toHaveText(harusnya);

  // Jamnya tetap ada — di kolomnya sendiri, bukan menggantikan tanggalnya.
  await expect(page.locator("table tbody tr").first().locator("td").nth(2)).toHaveText(
    /^\d{2}\.\d{2}$/,
  );

  // Baris masih bisa dibuka: daftar yang bisa diklik saat berbentuk kartu tak
  // boleh jadi daftar yang cuma bisa dipandang begitu ia jadi tabel.
  await page.locator("table tbody tr").first().click();
  await expect(page.getByText("Detail Opname", { exact: false }).first()).toBeVisible({
    timeout: 10_000,
  });
});

test("saringan status & pencarian benar-benar menyaring", async ({ page, request }) => {
  const sesi = await riwayatServer(request, "stok/opname/riwayat");
  const menunggu = sesi.filter((s) => s.status === "menunggu");
  expect(menunggu.length, "PREMIS: butuh sesi berstatus menunggu").toBeGreaterThan(0);
  expect(
    sesi.length,
    "PREMIS: butuh sesi berstatus LAIN, kalau tidak saringannya tak membuktikan apa pun",
  ).toBeGreaterThan(menunggu.length);

  await masukLewatSesi(page, request, OWNER_EMAIL, OWNER_PASS);
  await page.goto("/stok/opname/riwayat");
  await expect(page.locator("table tbody tr").first()).toBeVisible({ timeout: 10_000 });
  expect(await page.locator("table tbody tr").count()).toBe(sesi.length);

  // Saringan status → tepat sebanyak yang dihitung dari balasan server.
  await page.getByLabel("Saring status").selectOption("menunggu");
  await expect(page.locator("table tbody tr")).toHaveCount(menunggu.length);
  // …dan ia hidup di URL, jadi bisa ditautkan & selamat dari muat ulang.
  expect(page.url()).toContain("status=menunggu");
  await page.reload();
  await expect(page.locator("table tbody tr")).toHaveCount(menunggu.length);

  // Pencarian nomor: satu sesi, satu baris.
  await page.getByLabel("Saring status").selectOption("semua");
  const nomor = sesi.find((s) => s.nomor)?.nomor;
  expect(nomor, "PREMIS: butuh sesi bernomor").toBeTruthy();
  await page.getByLabel("Cari riwayat opname").fill(nomor!);
  await expect(page.locator("table tbody tr")).toHaveCount(1);

  // Kata kunci yang tak ada → keadaan kosong yang menyebut SARINGAN, bukan
  // "belum ada riwayat opname" (pernyataan yang salah tentang basis datanya).
  await page.getByLabel("Cari riwayat opname").fill("zzz-tak-mungkin-ada");
  /*
   * Disasar sebagai SEL TABEL, dan itu bukan kerapian. `TabelResponsif`
   * merender keadaan kosongnya DUA KALI — sekali untuk kartu HP, sekali untuk
   * tabel desktop — lalu menyembunyikan yang tak dipakai lewat CSS, bukan
   * lewat DOM. `getByText(...)` karena itu memulangkan dua elemen (strict mode
   * violation), dan `.first()` mendarat justru di varian kartu yang `hidden`
   * pada viewport desktop. Peran `cell` cuma dimiliki varian tabelnya.
   */
  await expect(page.getByRole("cell", { name: /cocok dengan saringan ini/ })).toBeVisible();
});

test("riwayat SO perlengkapan: tabel dengan kolom Selisih, dan tanggalnya ada", async ({
  page,
  request,
}) => {
  const sesi = await riwayatServer(request, "perlengkapan/opname/riwayat");
  expect(sesi.length, "PREMIS: harus ada sesi opname perlengkapan").toBeGreaterThan(0);

  await masukLewatSesi(page, request, OWNER_EMAIL, OWNER_PASS);
  await page.goto("/stok/opname/riwayat?tab=perlengkapan");
  await expect(page.locator("table tbody tr").first()).toBeVisible({ timeout: 10_000 });

  /*
   * Kepalanya berbunyi "Selisih", bukan "Item" — dan itu bukan sinonim. Sisi
   * perlengkapan HANYA mencatat baris berselisih, jadi angkanya menjawab
   * pertanyaan yang berbeda dari angka di tab sebelah. Judul yang sama untuk
   * arti yang berbeda adalah cara tercepat membuat dua tab berdampingan saling
   * membantah.
   */
  expect(await page.locator("table thead th").allTextContents()).toEqual([
    "Nomor",
    "Tanggal",
    "Jam",
    "Oleh",
    "Selisih",
    "Status",
  ]);

  const harusnya = tanggalHarusnya(sesi[0]!.waktu);
  await expect(
    page.locator("table tbody tr").first().locator("td").nth(1),
    `kolom Tanggal harus memuat "${harusnya}"`,
  ).toHaveText(harusnya);

  /*
   * LEMBAR DETAILNYA juga menyebut tanggal sesi. Sampai putaran ini lembar
   * detail perlengkapan tak menampilkan waktu sama sekali — DTO-nya tak
   * membawanya. Diukur dari jumlah kemunculan tanggal di halaman: tabel sudah
   * memuatnya (satu per baris hari itu), jadi yang ditagih adalah BERTAMBAH
   * sesudah lembar terbuka — bukan "ada", yang sudah benar sebelum diklik.
   */
  const sebelum = await page.getByText(harusnya).count();
  await page.locator("table tbody tr").first().click();
  await expect(page.getByText("Detail Opname Perlengkapan")).toBeVisible({ timeout: 10_000 });
  await expect
    .poll(async () => await page.getByText(harusnya).count(), {
      timeout: 10_000,
      message: "lembar detail perlengkapan tak menyebut tanggal sesinya",
    })
    .toBeGreaterThan(sebelum);
  // …dan pencatatnya, dari medan `oleh` yang baru — bukan dirakit dari rows[].
  const olehTeratas = (sesi[0] as { oleh?: string | null }).oleh;
  if (olehTeratas) {
    await expect(page.getByText(`· ${olehTeratas}`).first()).toBeVisible();
  }
});

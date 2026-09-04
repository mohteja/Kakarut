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

/*
 * ---------------------------------------------------------------------------
 * DETAIL FAKTUR = HALAMAN SENDIRI (`/produksi/:fakturId`), bukan modal lagi.
 *
 * KENAPA LENGAN-LENGAN INI MENUMPANG DI BERKAS INI dan bukan
 * `faktur-halaman.spec.ts` sendiri — ini batas fisik, bukan selera:
 * `POST /auth/login` dibatasi 10 per 5 menit per (IP + email)
 * (`modules/auth/routes.ts:75`), cache sesi `util.ts` hidup di MODUL, dan
 * Playwright menjalankan tiap BERKAS spec sebagai proses tersendiri. Terhitung
 * saat lengan ini ditulis: SEPULUH berkas spec sudah memakai `OWNER_EMAIL` —
 * tepat di plafonnya. Berkas ke-11 memulangkan 429, dan yang memerah bukan
 * berkas baru itu melainkan berkas mana pun yang kebetulan berjalan terakhir —
 * kegagalan yang menuduh kode yang tak bersalah. Subjeknya pun memang satu:
 * "riwayat pengadaan, dan apa yang terjadi saat barisnya diklik".
 * ---------------------------------------------------------------------------
 */

/**
 * Nomor & bahan baris pertama — DIBACA dari layar, bukan ditebak dari API.
 *
 * Sel Dokumen berisi lebih dari nomornya: lambang jalur, lencana
 * "✍️ Langsung"/"📋 PM-xxxx", dan kadang no. faktur supplier. Yang dicocokkan
 * karena itu pola nomor faktur produksi saja (`PR-####`, lihat `PREFIKS` di
 * `modules/dokumen/nomor.ts`) — mengambil seluruh teks selnya berarti mencari
 * "✍️ Langsung" di halaman dokumen, yang memang tak ada di sana, dan merahnya
 * akan menuduh halamannya alih-alih pemilihnya.
 */
async function penandaBarisPertama(page: Page) {
  const baris = page.locator("table tbody tr").first();
  // Kolomnya: Dokumen(0) Dibuat(1) Bahan(2) …
  const selDokumen = await baris.locator("td").nth(0).innerText();
  const nomor = selDokumen.match(/PR-\d{4}/)?.[0] ?? "";
  // Nama bahan utama adalah blok pertama sel Bahan (jumlah & "+N lainnya" di
  // blok kedua).
  const bahan = (await baris.locator("td").nth(2).innerText()).split("\n")[0].trim();
  expect(nomor, `PREMIS: baris pertama bernomor PR-#### (sel: ${selDokumen})`).toMatch(
    /PR-\d{4}/,
  );
  expect(bahan.length, "PREMIS: baris pertama punya nama bahan").toBeGreaterThan(1);
  return { nomor, bahan };
}

/**
 * Dokumen yang tampil menyebut `nomor` dan `bahan` — DIBATASI ke `<main>`.
 *
 * `AreaCetak` memportal salinan cetaknya ke luar `#root` sebagai anak langsung
 * `body` (lihat berkasnya: `display:none` di layar, `print:block` di kertas).
 * Jadi tiap teks dokumen ADA DUA KALI di DOM, dan `getByText` tanpa batas
 * memulangkan dua elemen → "strict mode violation" yang berbunyi seperti bug
 * halaman padahal justru bukti area cetaknya terpasang benar.
 */
async function dokumenMenyebut(page: Page, nomor: string, bahan: string) {
  const isi = page.getByRole("main");
  await expect(isi.getByRole("heading", { level: 1 })).toContainText("Dokumen Produksi", {
    timeout: 10_000,
  });
  await expect(isi.getByText(nomor, { exact: false }).first()).toBeVisible();
  await expect(isi.getByText(bahan, { exact: false }).first()).toBeVisible();
}

test("baris diklik pindah ke HALAMAN dokumennya, dan muat ulang tetap menampilkannya", async ({
  page,
  request,
}) => {
  const data = await ringkasServer(request, "produksi");
  expect(data.total, "PREMIS: harus ada faktur").toBeGreaterThan(0);

  await masukLewatSesi(page, request, OWNER_EMAIL, OWNER_PASS);
  await page.goto("/produksi");
  await expect(page.locator("table tbody tr").first()).toBeVisible({ timeout: 10_000 });

  const { nomor, bahan } = await penandaBarisPertama(page);

  // Klik di sel yang BUKAN tombol — `TabelResponsif` sengaja mengabaikan klik
  // yang lahir dari button/select di dalam sel.
  await page.locator("table tbody tr").first().locator("td").nth(2).click();

  // URL-nya berganti, dan itu SELURUH bedanya dengan modal: yang punya URL
  // bisa dikirim, di-bookmark, dan dibuka ulang.
  await expect(page).toHaveURL(/\/produksi\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  await dokumenMenyebut(page, nomor, bahan);

  /*
   * MUAT ULANG — lengan yang membuktikan datanya bukan warisan daftar yang
   * sudah dimuat. Sesudah `reload`, cache react-query kosong dan tak ada
   * `FakturGroup` di tangan siapa pun; kalau halaman ini masih merakit
   * detailnya dari `GET /produksi` yang dibaca layar riwayat, di sini ia
   * kosong. Yang tersisa hanya `GET /produksi/faktur/:id`.
   */
  const url = page.url();
  await page.reload();
  await expect(page).toHaveURL(url);
  await dokumenMenyebut(page, nomor, bahan);
});

test("URL dokumen dibuka langsung tanpa pernah menyentuh riwayat, dan tautannya bisa disalin", async ({
  page,
  request,
  context,
}) => {
  // Premis diambil dari server: satu faktur produksi yang benar-benar ada.
  const { token } = await sesiApi(request, OWNER_EMAIL, OWNER_PASS);
  const r = await request.get(`${BASE}/api/produksi?branch_id=all&per_page=1&page=1`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(r.ok(), `GET /produksi (${r.status()})`).toBeTruthy();
  const rows = ((await r.json()) as { rows: { faktur_id: string | null; bahan: string }[] }).rows;
  const faktur = rows.find((x) => x.faktur_id);
  expect(faktur, "PREMIS: butuh satu baris yang punya faktur_id").toBeTruthy();

  // Izin papan klip HARUS diberikan sebelum halamannya dibuka: tanpa ini
  // `navigator.clipboard.writeText` menolak, tombolnya jatuh ke cadangan
  // `execCommand`, dan lengan di bawah menguji jalan yang salah.
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);

  await masukLewatSesi(page, request, OWNER_EMAIL, OWNER_PASS);
  // LANGSUNG ke URL-nya. Halaman riwayat tak pernah dibuka di uji ini — persis
  // keadaan orang yang menerima tautannya dari rekan kerja.
  await page.goto(`/produksi/${faktur!.faktur_id}`);
  await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toContainText(
    "Dokumen Produksi",
    { timeout: 10_000 },
  );
  await expect(page.getByRole("main").getByText(faktur!.bahan, { exact: false }).first()).toBeVisible();

  // Tombol Salin tautan menyalin URL YANG SEDANG DIBUKA, bukan URL daftarnya.
  await page.getByRole("button", { name: /Salin tautan/ }).click();
  await expect(page.getByRole("button", { name: /Tautan tersalin/ })).toBeVisible();
  const disalin = await page.evaluate(() => navigator.clipboard.readText());
  expect(disalin).toBe(`${BASE}/produksi/${faktur!.faktur_id}`);
});

test("faktur_id ngawur → kalimatnya sendiri, bukan dokumen kosong", async ({ page, request }) => {
  await masukLewatSesi(page, request, OWNER_EMAIL, OWNER_PASS);
  await page.goto("/produksi/00000000-0000-4000-8000-000000000000");

  // Kelas `gagal-muat-bukan-kosong`: dokumen kosong terbaca sebagai "faktur
  // tanpa bahan" — pernyataan tentang fakturnya, padahal yang gagal bacaannya.
  await expect(page.getByText(/Faktur ini tidak bisa dibuka/)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("link", { name: /Kembali ke Produksi Bahan Baku/ })).toBeVisible();
});

/*
 * ---------------------------------------------------------------------------
 * PERMINTAAN STOK: BENTUK TABEL, UBIN SERVER, DAN TAUTAN YANG BENAR.
 *
 * Menumpang berkas ini karena alasan yang SAMA dengan lengan halaman dokumen
 * di atas — kuota `/auth/login` 10 per 5 menit per (IP+email), sepuluh berkas
 * spec sudah memakai akun owner, dan berkas ke-11 memerahkan berkas lain
 * dengan 429. Halaman Permintaan Stok owner/admin-only, jadi akun kasir tak
 * bisa menggantikannya dan seed tak punya akun admin kedua.
 *
 * Subjeknya pun bersambung: sejak putaran ini tiap jalur di Permintaan Stok
 * menautkan ke HALAMAN DOKUMEN FAKTURNYA — halaman yang lengan di atas baru
 * saja menguji. Permintaan → faktur adalah satu rantai.
 * ---------------------------------------------------------------------------
 */

/** Ringkasan server untuk permintaan — sumber kebenaran ubinnya. */
async function ringkasPermintaan(request: APIRequestContext) {
  const { token } = await sesiApi(request, OWNER_EMAIL, OWNER_PASS);
  const r = await request.get(`${BASE}/api/rekomendasi/permintaan?per_page=1`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(r.ok(), `GET /rekomendasi/permintaan (${r.status()})`).toBeTruthy();
  return (await r.json()) as {
    total: number;
    ringkas: { berjalan: number; selesai: number; selesai_ada_ditolak: number };
  };
}

test("Permintaan Stok: bentuk tabel dirender, dan pilihannya bertahan sesudah muat ulang", async ({
  page,
  request,
}) => {
  const data = await ringkasPermintaan(request);
  expect(data.total, "PREMIS: harus ada permintaan").toBeGreaterThan(0);

  await masukLewatSesi(page, request, OWNER_EMAIL, OWNER_PASS);
  await page.goto("/permintaan-stok");
  await expect(page.getByRole("heading", { name: /Data Permintaan Stok/ })).toBeVisible();

  // Bawaannya KARTU — bentuk yang sudah ada sebelum tombol ini.
  await expect(page.getByRole("button", { name: "🗂 Kartu" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator("table")).toHaveCount(0);

  await page.getByRole("button", { name: "☰ Tabel" }).click();
  await expect(page.locator("table thead th").first()).toBeVisible({ timeout: 10_000 });
  expect(await page.locator("table thead th").allTextContents()).toEqual([
    "Dokumen",
    "Dibuat",
    "Tujuan",
    "Isi",
    "Status",
    "Nilai",
    "Orang",
    "Aksi",
  ]);

  /*
   * INTI SEBUAH SAKELAR: pilihannya bertahan. Tanpa lengan ini yang diuji cuma
   * "tombolnya bisa diklik" — dan sakelar yang lupa pilihannya persis cacat
   * yang tak pernah dilaporkan siapa pun, sebab orangnya cuma mengklik lagi.
   */
  await page.reload();
  await expect(page.getByRole("button", { name: "☰ Tabel" })).toHaveAttribute(
    "aria-pressed",
    "true",
    { timeout: 10_000 },
  );
  await expect(page.locator("table thead th").first()).toBeVisible();
});

test("Permintaan Stok: ubin menyebut angka SERVER, bukan jumlahan baris yang tampil", async ({
  page,
  request,
}) => {
  const data = await ringkasPermintaan(request);
  expect(data.total, "PREMIS: harus ada permintaan").toBeGreaterThan(0);

  await masukLewatSesi(page, request, OWNER_EMAIL, OWNER_PASS);
  await page.goto("/permintaan-stok");
  await expect(page.getByRole("heading", { name: /Data Permintaan Stok/ })).toBeVisible();

  /*
   * Angkanya dari agregat server atas SELURUH populasi. Bedanya bukan
   * teoretis: server menaruh yang belum selesai lebih dulu, jadi ubin yang
   * dijumlahkan dari halaman berjalan akan berbunyi "0 selesai" di halaman
   * pertama mana pun. `data.ringkas.selesai` di DB gerbang > 0.
   */
  await expect(
    page.getByText(`${data.ringkas.berjalan} permintaan`).first(),
  ).toBeVisible({ timeout: 10_000 });
  expect(
    data.ringkas.selesai,
    "PREMIS: butuh permintaan selesai, kalau tidak lengan ini hampa",
  ).toBeGreaterThan(0);
  await expect(page.getByText(`${data.ringkas.selesai} permintaan`).first()).toBeVisible();
  // Ketiganya partisi — dan jumlahnya WAJIB total.
  expect(
    data.ringkas.berjalan + data.ringkas.selesai + data.ringkas.selesai_ada_ditolak,
  ).toBe(data.total);
});

test("Permintaan Stok: lencana jalur membuka HALAMAN DOKUMEN fakturnya", async ({
  page,
  request,
}) => {
  const data = await ringkasPermintaan(request);
  expect(data.total, "PREMIS: harus ada permintaan").toBeGreaterThan(0);

  await masukLewatSesi(page, request, OWNER_EMAIL, OWNER_PASS);
  await page.goto("/permintaan-stok");
  await expect(page.getByRole("heading", { name: /Data Permintaan Stok/ })).toBeVisible();
  await page.getByRole("button", { name: "☰ Tabel" }).click();
  await expect(page.locator("table tbody tr").first()).toBeVisible({ timeout: 10_000 });

  /*
   * Tautannya DIBACA DARI LAYAR, bukan ditebak dari API. Versi pertama lengan
   * ini mengambil `faktur_id` lewat `per_page=200` lalu mencarinya di tabel —
   * dan gagal, sebab halamannya berhalaman 20 dan faktur itu duduk di halaman
   * berikutnya. Merahnya benar, tapi ia menuduh tautannya padahal yang salah
   * premis lengannya.
   */
  const tautan = page.locator('table tbody a[href^="/produksi/"]').first();
  await expect(tautan, "PREMIS: ada lencana jalur produksi/kirim di halaman 1").toBeVisible();
  const href = await tautan.getAttribute("href");
  expect(href).toMatch(/^\/produksi\/[0-9a-f-]{36}$/);

  /*
   * SEBELUM putaran ini tautan ini menunjuk `/produksi` — DAFTARNYA, berhalaman
   * 20 — jadi orangnya mendarat di halaman 1 dari 4 dan harus mencari sendiri
   * faktur yang barusan ia klik. Yang diperiksa di sini URL-nya, bukan
   * "sesuatu terbuka": tautan yang salah tetap membuka halaman.
   */
  await tautan.click();
  await expect(page).toHaveURL(new RegExp(`${href}$`));
  await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toContainText(
    "Dokumen Produksi",
    { timeout: 10_000 },
  );
});

test("Permintaan Stok: lencana jalur di bentuk KARTU juga membuka halaman dokumen", async ({
  page,
  request,
}) => {
  /*
   * BENTUK KARTU ADALAH BAWAANNYA — dan itu yang membuat lengan ini bukan
   * duplikat lengan tabel di atasnya.
   *
   * Perbaikan tautan (jalur → halaman dokumen fakturnya, bukan daftarnya)
   * awalnya hanya kena bentuk TABEL: `kolom-permintaan.tsx` diperbaiki,
   * `Bagian` di halamannya tidak. Penjaga statisnya cuma membaca berkas kolom,
   * dan lengan peramban cuma mengklik tabel — jadi keduanya HIJAU sementara
   * bentuk yang paling sering dibuka orang tetap mendaratkannya di halaman 1
   * dari 4 daftar riwayat. Lengan ini yang menutupnya.
   */
  const data = await ringkasPermintaan(request);
  expect(data.total, "PREMIS: harus ada permintaan").toBeGreaterThan(0);

  await masukLewatSesi(page, request, OWNER_EMAIL, OWNER_PASS);
  await page.goto("/permintaan-stok");
  await expect(page.getByRole("heading", { name: /Data Permintaan Stok/ })).toBeVisible();
  // Bawaannya kartu — tak ada tombol yang ditekan lebih dulu, dan itu premisnya.
  await expect(page.getByRole("button", { name: "🗂 Kartu" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  const tautan = page.locator('a[href^="/produksi/"], a[href^="/pembelian/"]').first();
  await expect(
    tautan,
    "kartu tak punya satu pun tautan ke halaman dokumen faktur",
  ).toBeVisible({ timeout: 10_000 });
  const href = await tautan.getAttribute("href");
  expect(href).toMatch(/^\/(produksi|pembelian)\/[0-9a-f-]{36}$/);

  await tautan.click();
  await expect(page).toHaveURL(new RegExp(`${href}$`));
  await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toContainText(
    "Dokumen",
    { timeout: 10_000 },
  );
});

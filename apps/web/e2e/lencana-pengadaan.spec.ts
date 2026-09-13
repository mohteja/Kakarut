import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { BASE, masukLewatSesi, OWNER_EMAIL, OWNER_PASS, sesiApi } from "./util";

/**
 * LENCANA PENGADAAN MENYEBUT SELURUH POPULASI, BUKAN HALAMAN PERTAMA.
 *
 * Sampai 2026-09-12 kedua lencana ini dijumlahkan DI PERAMBAN dari `rows` —
 * `new Set(rows.filter(barisBelumSelesai).map(faktur_id)).size` — atas balasan
 * yang diminta `per_page=500`. Dua hal membuat itu salah, dan keduanya diukur
 * pada DB gerbang:
 *
 *   · servernya MEMBATASI `per_page` di 200. Diminta 500, dilayani 200. Angka
 *     `per_page` yang mengabarkannya tak pernah ada bagi `Layout.tsx`, sebab
 *     amplopnya diketik tangan sebagai `{ rows: … }` — satu dari enam kunci;
 *   · hitungan dari halaman memang bergantung pada halaman: 36 pada
 *     `per_page=500`, 10 pada `per_page=10`, 1 pada `per_page=1`, sementara
 *     `ringkas.harus_dikerjakan.faktur` tetap 36 di ketiganya.
 *
 * Perusahaan dengan lebih dari 200 faktur karena itu melihat lencana yang
 * diam-diam berhenti bertambah — persis cacat yang sudah dibayar untuk lencana
 * Beli Perlengkapan sehari sebelumnya, di berkas yang sama, dua puluh baris di
 * bawahnya.
 *
 * LENGAN KEDUANYA YANG MEMBUAT SPEC INI MENYATAKAN SESUATU. Lengan pertama
 * cuma menyamakan lencana dengan angka server — itu juga hijau pada kode lama
 * selama populasinya kebetulan muat satu halaman. Lengan kedua MENGOSONGKAN
 * `rows` dari balasan sungguhan sambil membiarkan `ringkas` utuh: kode lama
 * membaca 0, kode ini membaca angka yang sama seperti sebelumnya.
 */
const LENCANA_PRODUKSI = "nav-lencana-produksi";
const LENCANA_BELI = "nav-lencana-beli";

interface Ringkas {
  ringkas: { harus_dikerjakan: { faktur: number } };
}

async function harusDikerjakan(request: APIRequestContext, modul: string): Promise<number> {
  const { token } = await sesiApi(request, OWNER_EMAIL, OWNER_PASS);
  const r = await request.get(`${BASE}/api/${modul}?branch_id=all&per_page=1`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(r.ok(), `GET /${modul} (${r.status()})`).toBeTruthy();
  return ((await r.json()) as Ringkas).ringkas.harus_dikerjakan.faktur;
}

/** Balasan SERVER diteruskan apa adanya, hanya `rows` yang dikosongkan. */
async function kosongkanRows(page: Page, glob: string): Promise<void> {
  await page.route(glob, async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as Record<string, unknown>;
    body.rows = [];
    await route.fulfill({ response: res, json: body });
  });
}

test("lencana pengadaan = angka server, dan tak runtuh saat `rows` kosong", async ({
  page,
  request,
}) => {
  const produksi = await harusDikerjakan(request, "produksi");
  const beli = await harusDikerjakan(request, "pembelian");
  /*
   * PREMIS YANG GAGAL KERAS, bukan `skip`. Lencana yang seharusnya berangka nol
   * tak bisa membedakan "benar nol" dari "tak pernah terbaca", jadi seluruh
   * spec ini hampa tanpa antrean yang tak kosong. `verify-api.sh` berjalan
   * lebih dulu di gerbang dan meninggalkan keduanya terisi.
   */
  expect(produksi, "PREMIS: harus ada produksi yang belum selesai").toBeGreaterThan(0);
  expect(beli, "PREMIS: harus ada pembelian yang belum selesai").toBeGreaterThan(0);

  await masukLewatSesi(page, request, OWNER_EMAIL, OWNER_PASS);
  await page.goto("/menu");
  await expect(page.getByRole("heading", { name: /Menu & HPP/ })).toBeVisible();

  // Sidebar dan drawer merender nav yang SAMA, jadi lencananya muncul dua kali.
  const lencanaProduksi = page.getByTestId(LENCANA_PRODUKSI).first();
  const lencanaBeli = page.getByTestId(LENCANA_BELI).first();
  await expect(lencanaProduksi).toBeVisible({ timeout: 10_000 });
  await expect(lencanaProduksi).toHaveText(String(produksi));
  await expect(lencanaBeli).toHaveText(String(beli));

  // ── LENGAN KEDUA: `rows` dikosongkan, `ringkas` dibiarkan utuh ────────────
  await kosongkanRows(page, "**/api/produksi?*");
  await kosongkanRows(page, "**/api/pembelian?*");
  await page.reload();
  await expect(page.getByRole("heading", { name: /Menu & HPP/ })).toBeVisible();
  const sesudah = page.getByTestId(LENCANA_PRODUKSI).first();
  await expect(sesudah).toBeVisible({ timeout: 10_000 });
  /*
   * ANGKANYA TIDAK BERUBAH. Pada kode lama lencana ini membaca `rows` dan akan
   * berbunyi 0 di sini — dan 0 pada `badgeOranye` berarti lencananya HILANG,
   * jadi kegagalannya pun akan terbaca sebagai "tak ada yang perlu dikerjakan".
   */
  await expect(sesudah).toHaveText(String(produksi));
  await expect(page.getByTestId(LENCANA_BELI).first()).toHaveText(String(beli));
});

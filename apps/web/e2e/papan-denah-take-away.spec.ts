import { expect, test } from "@playwright/test";
import { BASE, KASIR_EMAIL, KASIR_PASS, masukLewatSesi, OWNER_EMAIL, OWNER_PASS, pastikanShiftTerbuka, pilihMeja, sesiApi } from "./util";

/**
 * PAPAN DENAH + KASIR & TAKE AWAY (permintaan pemilik 2026-11-11):
 * - papan Pesanan Masuk mengikuti denah meja & ruangan;
 * - meja take away wajib satu ("Kasir & Take Away") dan menampung BANYAK
 *   pesanan sekaligus, masing-masing bernomor antrean TA-n.
 */
type Meja = { id: string; nama: string; tipe: string };
type Menu = { id: string };

async function duaBillTakeAway(request: import("@playwright/test").APIRequestContext) {
  const { token } = await sesiApi(request, KASIR_EMAIL, KASIR_PASS);
  const h = { Authorization: `Bearer ${token}` };
  const meja = (await (await request.get(`${BASE}/api/meja`, { headers: h })).json()) as Meja[];
  const ta = meja.find((m) => m.tipe === "takeaway")!;
  expect(ta.nama).toBe("Kasir & Take Away");
  const menu = ((await (await request.get(`${BASE}/api/menu`, { headers: h })).json()) as Menu[])[0];
  const ids: string[] = [];
  for (const nama of ["Tamu A e2e", "Tamu B e2e"]) {
    const r = await request.post(`${BASE}/api/open-bill`, {
      headers: h,
      data: { meja_id: ta.id, customer_nama: nama, items: [{ menu_id: menu.id, qty: 1 }] },
    });
    expect(r.ok(), `premis: bill take away ${nama} tersimpan`).toBeTruthy();
    ids.push(((await r.json()) as { id: string }).id);
  }
  return { h, ids };
}

test("papan denah: Kasir & Take Away menumpuk pesanan bernomor antrean", async ({ page, request }) => {
  const { h, ids } = await duaBillTakeAway(request);
  try {
    await masukLewatSesi(page, request, OWNER_EMAIL, OWNER_PASS);
    await page.goto("/pesanan");
    await expect(page.getByTestId("denah-pesanan")).toBeVisible();
    const kasir = page.getByTestId("denah-kasir-take-away");
    await expect(kasir).toContainText("Kasir & Take Away");
    const chipA = kasir.getByTestId("chip-antrean").filter({ hasText: "Tamu A e2e" });
    const chipB = kasir.getByTestId("chip-antrean").filter({ hasText: "Tamu B e2e" });
    await expect(chipA).toContainText(/TA-\d+/);
    await expect(chipB).toContainText(/TA-\d+/);
    await chipA.click();
    await expect(page.getByRole("button", { name: "Riwayat" })).toBeVisible();
  } finally {
    for (const id of ids) await request.delete(`${BASE}/api/open-bill/${id}`, { headers: h });
  }
});

test("kasir: pilih Kasir & Take Away → daftar pesanan take away + pesanan baru", async ({ page, request }) => {
  const { h, ids } = await duaBillTakeAway(request);
  try {
    await masukLewatSesi(page, request, KASIR_EMAIL, KASIR_PASS);
    await page.goto("/kasir");
    await pastikanShiftTerbuka(page);
    await pilihMeja(page, "Kasir & Take Away");
    const daftar = page.getByTestId("daftar-take-away");
    await expect(daftar.getByRole("button", { name: /TA-\d+ · Tamu A e2e/ })).toBeVisible();
    await expect(daftar.getByRole("button", { name: /TA-\d+ · Tamu B e2e/ })).toBeVisible();
    // Pesanan baru: modal tertutup, keranjang kosong siap diisi.
    await page.getByTestId("take-away-baru").click();
    await expect(daftar).toHaveCount(0);
  } finally {
    for (const id of ids) await request.delete(`${BASE}/api/open-bill/${id}`, { headers: h });
  }
});

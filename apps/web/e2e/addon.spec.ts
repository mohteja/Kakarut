/**
 * ADD-ON PER MENU — dari form menu sampai struk.
 *
 * Dua jalur yang tak bisa dibuktikan unit test: (1) form menu membaca grup
 * add-on yang tersimpan lalu MENYIMPANNYA KEMBALI tanpa mengubah id-nya
 * (round-trip `grupDariDto` → `grupKeBody`; id yang hilang berarti seluruh
 * add-on dihapus-lunak dan dibuat ulang tiap kali admin menekan Simpan), dan
 * (2) kasir mengetuk menu ber-add-on → pemilih → baris keranjang → struk.
 */
import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  BASE,
  KASIR_EMAIL,
  KASIR_PASS,
  OWNER_EMAIL,
  OWNER_PASS,
  absenMasuk,
  kosongkanMeja,
  masukLewatSesi,
  pastikanShiftTerbuka,
  pilihMeja,
  sesiApi,
} from "./util";

interface MenuDtoE2E {
  id: string;
  addon_groups: { id: string; nama: string; addons: { id: string; nama: string }[] }[];
}

async function buatMenuBerAddon(request: APIRequestContext, nama: string): Promise<MenuDtoE2E> {
  const { token } = await sesiApi(request, OWNER_EMAIL, OWNER_PASS);
  const h = { Authorization: `Bearer ${token}` };
  const kategori = (await (await request.get(`${BASE}/api/kategori`, { headers: h })).json()) as { id: string }[];
  const r = await request.post(`${BASE}/api/menu`, {
    headers: h,
    data: {
      nama,
      category_id: kategori[0].id,
      tipe: "regular",
      mult: 2,
      harga_jual: 15000,
      addon_groups: [
        { nama: "Level pedas", min_pilih: 1, maks_pilih: 1, addons: [{ nama: "Sedang", harga: 0 }, { nama: "Pedas", harga: 0 }] },
        { nama: "Tambahan", addons: [{ nama: "Extra mie", harga: 3000, maks_jumlah: 3 }, { nama: "Tanpa sayur", harga: 0 }] },
      ],
    },
  });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()) as MenuDtoE2E;
}

const idSemua = (m: MenuDtoE2E) => m.addon_groups.flatMap((g) => [g.id, ...g.addons.map((a) => a.id)]).sort();

test("owner: form menu memuat add-on dan menyimpannya kembali dengan id yang sama", async ({ page, request }) => {
  const menu = await buatMenuBerAddon(request, `Mie Addon Form ${Date.now() % 100000}`);
  await masukLewatSesi(page, request, OWNER_EMAIL, OWNER_PASS);
  await page.goto(`/menu/${menu.id}/edit`);
  await expect(page.getByRole("heading", { name: /Add-on \(2 grup\)/ })).toBeVisible();
  await expect(page.getByLabel("Nama add-on").first()).toHaveValue("Sedang");
  await expect(page.getByText("Gratis").first()).toBeVisible();
  await page.getByRole("button", { name: "Simpan Menu" }).click();
  await expect(page).toHaveURL(/\/menu$/);

  const { token } = await sesiApi(request, OWNER_EMAIL, OWNER_PASS);
  const sesudah = (await (
    await request.get(`${BASE}/api/menu/${menu.id}`, { headers: { Authorization: `Bearer ${token}` } })
  ).json()) as MenuDtoE2E;
  expect(idSemua(sesudah)).toEqual(idSemua(menu));
});

test("kasir: pilih add-on wajib + Extra mie ×2 → keranjang & struk memuatnya", async ({ page, request }) => {
  const nama = `Mie Addon Kasir ${Date.now() % 100000}`;
  await buatMenuBerAddon(request, nama);
  const token = await absenMasuk(request, KASIR_EMAIL, KASIR_PASS);
  await kosongkanMeja(request, token, "Meja 2");
  await masukLewatSesi(page, request, KASIR_EMAIL, KASIR_PASS);
  await page.goto("/kasir");
  await pastikanShiftTerbuka(page);
  await pilihMeja(page, "Meja 2");

  await page.getByPlaceholder(/Cari menu/).fill(nama);
  await page.getByRole("button", { name: new RegExp(nama) }).first().click();

  // Pemilih terbuka; grup wajib belum dipilih → tombol Tambah mati.
  const tambah = page.getByRole("button", { name: /^Tambah · / });
  await expect(tambah).toBeDisabled();
  await page.getByRole("button", { name: "Pedas", exact: true }).click();
  await page.getByRole("button", { name: "Extra mie", exact: true }).click();
  await page.getByRole("button", { name: "Tambah Extra mie" }).click();
  await expect(tambah).toBeEnabled();
  await expect(tambah).toContainText("21.000");
  await tambah.click();

  await expect(page.getByText("+ Pedas, Extra mie x2")).toBeVisible();

  await page.getByRole("button", { name: /Lanjut →/ }).click();
  await page.getByRole("button", { name: /Lanjut ke Pembayaran/ }).click();
  await page.getByRole("button", { name: /Uang pas/ }).click();
  await page.getByRole("button", { name: /Simpan & Cetak/ }).click();

  await expect(page.locator("#struk-print")).toContainText("+ Extra mie x2 (+Rp6.000)");
  await expect(page.locator("#struk-print")).toContainText("+ Pedas");
});

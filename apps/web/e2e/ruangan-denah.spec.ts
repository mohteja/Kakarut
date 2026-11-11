import { expect, test } from "@playwright/test";
import { BASE, masukLewatSesi, OWNER_EMAIL, OWNER_PASS } from "./util";

/**
 * RUANGAN DI DENAH (permintaan pemilik 2026-11-11): atur ruangan dulu, lalu
 * meja masuk ke ruangannya. Ruangan bisa dipanjangkan & dilebarkan dengan
 * menarik sudutnya — diukur di peramban, lalu dibaca balik dari server.
 */
type Ruangan = { id: string; nama: string; lebar: number; tinggi: number };

test("denah: tambah ruangan, tarik sudutnya → ukurannya tersimpan", async ({ page, request }) => {
  await masukLewatSesi(page, request, OWNER_EMAIL, OWNER_PASS);
  const mentah = await page.evaluate(() => localStorage.getItem("kakarut.auth"));
  const h = { Authorization: `Bearer ${(JSON.parse(mentah as string) as { token: string }).token}` };
  const nama = `Rz${Date.now() % 100000}`;

  await page.goto("/pengaturan/meja");
  await page.getByRole("button", { name: /Atur Denah/i }).click();
  // Langkah pertama = ruangan.
  await expect(page.getByTestId("tambah-ruangan")).toBeVisible();
  await page.getByTestId("tambah-ruangan").click();
  await page.getByLabel("Nama ruangan").fill(nama);
  await page.getByLabel("Nama ruangan").press("Enter");

  const kotak = page.getByTestId("ruangan-denah").filter({ hasText: nama });
  await expect(kotak).toBeVisible({ timeout: 15_000 });
  const sebelum = (await kotak.boundingBox())!;

  // Tarik sudut kanan bawah → lebih lebar & lebih panjang.
  const pegangan = kotak.getByTestId("ruangan-pegangan");
  const p = (await pegangan.boundingBox())!;
  await page.mouse.move(p.x + p.width / 2, p.y + p.height / 2);
  await page.mouse.down();
  await page.mouse.move(p.x + 80, p.y + 60, { steps: 8 });
  await page.mouse.up();
  const sesudah = (await kotak.boundingBox())!;
  expect(sesudah.width).toBeGreaterThan(sebelum.width + 40);
  expect(sesudah.height).toBeGreaterThan(sebelum.height + 30);

  await page.getByRole("button", { name: "Simpan", exact: true }).first().click();
  await expect(page.getByRole("button", { name: /Atur Denah/i })).toBeVisible({ timeout: 15_000 });

  const r = await request.get(`${BASE}/api/meja/ruangan`, { headers: h });
  expect(r.ok()).toBeTruthy();
  const tersimpan = ((await r.json()) as Ruangan[]).find((x) => x.nama === nama);
  expect(tersimpan, "ruangan tersimpan di server").toBeTruthy();
  // Ruangan baru lahir 30×30; tarikan tadi harus terbawa ke server.
  expect(tersimpan!.lebar).toBeGreaterThan(30);
  expect(tersimpan!.tinggi).toBeGreaterThan(30);

  await request.delete(`${BASE}/api/meja/ruangan/${tersimpan!.id}`, { headers: h });
});

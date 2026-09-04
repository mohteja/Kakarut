/**
 * SALDO PEMBUKA YANG GAGAL DIMUAT TAK BOLEH TAMPIL SEBAGAI "BELUM DIISI".
 *
 * Nilai tersimpan mengisi formulir ini lewat efek. Bacaan yang gagal membuat
 * efeknya tak pernah jalan, `awal` tetap `{}`, dan layar menyajikan formulir
 * KOSONG — tak terbedakan dari "belum pernah diisi". Yang terjadi berikutnya
 * bukan kebingungan melainkan PEKERJAAN: orang mengetik ulang saldo yang sudah
 * ada, dan `POST /stok/awal` MENGGANTI baris lama beserta tanggalnya.
 *
 * Terukur sebelum perbaikan (2026-08-27): 90 baris saldo pembuka tersimpan di
 * basis data, `GET /stok/awal` dibalas 500 → 0 input terisi, TAK SATU PUN
 * kalimat kegagalan di layar, dan tombol simpannya tetap ada.
 */
import { expect, test } from "@playwright/test";
import { BASE, login, OWNER_EMAIL, OWNER_PASS, sesiApi } from "./util";

/*
 * SESINYA LEWAT `sesiApi`, BUKAN `POST /auth/login` SENDIRI — dan itu bukan
 * kerapian.
 *
 * `/auth/login` dibatasi 10 percobaan per 5 menit per (IP + email). Berkas ini
 * dulu menembaknya langsung, jadi ia memakai DUA jatah: satu di sini, satu
 * lagi lewat `login()` di layarnya. Sepuluh berkas spek memakai akun owner
 * yang sama, jadi suite ini duduk PERSIS di langit-langitnya — dan begitu spek
 * ke-sepuluh lahir (2026-09-03, `menu-tampilan-ikon.spec.ts`), jatahnya habis
 * dan berkas INI yang merah.
 *
 * Cara ia merah juga buruk: `(await masuk.json()).token` tak pernah memeriksa
 * `masuk.ok()`, jadi 429 berubah jadi `TypeError: Cannot read properties of
 * undefined (reading 'length')` di baris yang sama sekali tak menyebut kuota.
 * `sesiApi` menyimpan sesinya per email DAN melempar kalimat yang menyebut
 * sebabnya ("KUOTA LOGIN HABIS … INI BUKAN BUG KODE").
 */
async function adaSaldoTersimpan(request: import("@playwright/test").APIRequestContext) {
  const { token } = await sesiApi(request, OWNER_EMAIL, OWNER_PASS);
  const h = { Authorization: `Bearer ${token}` };
  const cek = await request.get(`${BASE}/api/stok/awal`, { headers: h });
  const t = (await cek.json()) as { items: unknown[] };
  if (t.items.length > 0) return t.items.length;
  const stok = await request.get(`${BASE}/api/stok`, { headers: h });
  const ing = ((await stok.json()) as { ingredient_id: string }[])[0].ingredient_id;
  await request.post(`${BASE}/api/stok/awal`, {
    headers: h,
    data: { items: [{ ingredient_id: ing, qty: 777 }] },
  });
  return 1;
}

async function bukaStokAwal(page: import("@playwright/test").Page) {
  await login(page, OWNER_EMAIL, OWNER_PASS);
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 15_000 });
  await page.goto("/stok/awal");
  await page.waitForTimeout(2500);
  return page.evaluate(() => {
    const inp = [...document.querySelectorAll("input")] as HTMLInputElement[];
    return {
      terisi: inp.filter((i) => i.type !== "date" && i.value.trim() !== "").length,
      simpanAktif: [...document.querySelectorAll("button")].some(
        (b) => /Simpan Stok Awal/i.test(b.textContent ?? "") && !(b as HTMLButtonElement).disabled,
      ),
      menyebutGagal: /gagal dimuat/i.test(document.body.innerText),
    };
  });
}

test("stok awal: bacaan GAGAL → dikatakan, dan simpan ditahan", async ({ page, request }) => {
  const n = await adaSaldoTersimpan(request);
  expect(n, "premis: tak ada saldo pembuka tersimpan").toBeGreaterThan(0);
  await page.route("**/api/stok/awal**", (r) =>
    r.request().method() === "GET"
      ? r.fulfill({ status: 500, contentType: "application/json", body: '{"error":"x"}' })
      : r.continue(),
  );
  const h = await bukaStokAwal(page);
  // INTI: kegagalan itu TERTULIS, dan simpan tak bisa menimpa apa pun.
  expect(h.menyebutGagal, "layar tak menyebutkan kegagalannya").toBe(true);
  expect(h.simpanAktif, "simpan masih bisa menimpa saldo yang tak terbaca").toBe(false);
});

test("PASANGAN: jaringan sehat → form terisi nilai tersimpan", async ({ page, request }) => {
  const n = await adaSaldoTersimpan(request);
  expect(n).toBeGreaterThan(0);
  const h = await bukaStokAwal(page);
  expect(h.terisi, "form tak terisi padahal bacaannya berhasil").toBeGreaterThan(0);
  expect(h.menyebutGagal).toBe(false);
});

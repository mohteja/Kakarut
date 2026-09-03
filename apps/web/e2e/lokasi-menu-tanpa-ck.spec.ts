import { expect, test, type APIRequestContext } from "@playwright/test";
import { BASE, masukLewatSesi } from "./util";

/**
 * PEMILIH "TAMPIL DI LOKASI" TIDAK BOLEH MENAWARKAN CENTRAL KITCHEN.
 *
 * Central Kitchen tidak berjualan. Server sudah menolak menyimpan menu dengan
 * lokasi CK (**400**, `modules/menu/routes.ts`), tapi selama dua tahun halaman
 * daftar menu tetap MENAWARKANNYA sebagai pilihan saring — sisa predikat lama
 * `tipe !== "kantor"` yang terlewat saat commit `b3237cc` memperbaiki
 * formulirnya. Memilihnya menyisakan menu ber-`branch_ids` KOSONG (= tanpa
 * pembatasan lokasi) lalu menyajikannya di bawah judul "Menu & HPP (13 dari
 * 40)" seolah tiga belas menu itu dijual di dapur pusat.
 *
 * Penjaga statis (`apps/server/test/lokasi-menu-hanya-store.test.ts`) menjaga
 * SUMBERNYA. Spec ini menjaga yang tak bisa dilihat pemindai sumber: apa yang
 * benar-benar terpasang di DOM sesudah React merender daftar cabang sungguhan
 * dari `GET /cabang`.
 *
 * TENANT SENDIRI, BUKAN MENUMPANG BASOOOPA. Menaikkan tenant bersama ke mode
 * Pro akan menambahkan Central Kitchen + "Cabang 2" + "Kantor" ke perusahaan
 * yang dipakai `pos.spec`/`laporan.spec`/`admin.spec`; pemilih cabang dan
 * pembagian divisi muncul di sidebar mereka, dan prasyarat spec-spec itu
 * bergeser tanpa satu baris pun berubah. Pola tenant segar disalin dari
 * `lupa-password.spec.ts`.
 *
 * Kenapa lewat KANTOR: `divisi` = tipe cabang yang sedang dipilih
 * (`BranchContext`), dan halaman Menu & HPP hanya terbuka saat
 * `penuh = !divisi || divisi === "kantor"` (`Layout.tsx`). Tak ada yang perlu
 * ditanam di localStorage untuk itu — manajemen tanpa pilihan tersimpan MEMANG
 * mendarat di Kantor bila ada ("manajemen mendarat di Kantor (pusat, semua
 * menu) bila ada"), jadi konteks browser yang bersih sudah cukup. Itu juga
 * menghindari `addInitScript` yang menanam ulang di tiap navigasi — jebakan
 * yang sudah dibayar `token-mati-tak-ditembakkan.spec.ts`.
 */

const PASS = "LokasiMenu123!";

interface Cabang {
  id: string;
  nama: string;
  tipe: "store" | "central_kitchen" | "kantor";
  is_active: boolean;
}

/** Tenant baru + verifikasi email, lalu naikkan ke Pro. Pulangkan email & cabangnya. */
async function tenantPro(request: APIRequestContext) {
  const email = `lokasi-menu-${Date.now()}@contoh.id`;

  const daftar = await request.post(`${BASE}/api/auth/register`, {
    data: { nama: "Uji Lokasi Menu", email, password: PASS },
  });
  expect(daftar.ok(), `register (${daftar.status()})`).toBeTruthy();
  const badan = (await daftar.json()) as { dev_verify_kode?: string };
  expect(
    badan.dev_verify_kode,
    "PREMIS: server uji harus tanpa SMTP supaya kode verifikasi dipulangkan",
  ).toBeTruthy();

  const verif = await request.post(`${BASE}/api/auth/verify-email`, {
    data: { email, kode: badan.dev_verify_kode },
  });
  expect(verif.ok(), `verify-email (${verif.status()})`).toBeTruthy();

  /*
   * MENDAFTAR TIDAK MEMBUAT PERUSAHAAN. `POST /auth/register` hanya membuat
   * USER — sesudah verifikasi pun `company_id` dan `role` masih null, dan
   * `POST /company/mode` menolaknya **403 "Akun ini tidak terhubung ke
   * perusahaan"**. Usahanya lahir di langkah tersendiri,
   * `POST /onboarding/perusahaan`, yang memulangkan token BARU berisi
   * `company_id` + peran `owner`. Versi pertama spec ini melompatinya dan
   * merah persis di situ.
   */
  const { token: tokenVerif } = (await verif.json()) as { token: string };
  const dibuat = await request.post(`${BASE}/api/onboarding/perusahaan`, {
    headers: { Authorization: `Bearer ${tokenVerif}` },
    data: { nama: "Warung Uji Lokasi Menu" },
  });
  expect(dibuat.ok(), `onboarding/perusahaan (${dibuat.status()})`).toBeTruthy();
  const { token } = (await dibuat.json()) as { token: string };
  const auth = { Authorization: `Bearer ${token}` };

  // Pro = multi-lokasi: server yang membuat Central Kitchen + Cabang 2 + Kantor.
  const pro = await request.post(`${BASE}/api/company/mode`, {
    headers: auth,
    data: { mode: "pro" },
  });
  expect(pro.ok(), `company/mode pro (${pro.status()})`).toBeTruthy();

  const daftarCabang = await request.get(`${BASE}/api/cabang`, { headers: auth });
  expect(daftarCabang.ok(), `GET /cabang (${daftarCabang.status()})`).toBeTruthy();
  const cabang = (await daftarCabang.json()) as Cabang[];

  /*
   * PREMISNYA DIBUKTIKAN LEBIH DULU, dan itu bukan basa-basi. Tanpa Central
   * Kitchen di data, asersi "tak ada opsi Central Kitchen" lolos secara HAMPA —
   * ia akan tetap hijau bahkan bila perbaikannya dibatalkan.
   */
  const aktif = cabang.filter((b) => b.is_active);
  expect(
    aktif.filter((b) => b.tipe === "central_kitchen").length,
    "PREMIS: mode Pro harus melahirkan tepat satu Central Kitchen",
  ).toBe(1);
  expect(
    aktif.filter((b) => b.tipe === "kantor").length,
    "PREMIS: mode Pro harus melahirkan tepat satu Kantor",
  ).toBe(1);
  expect(
    aktif.filter((b) => b.tipe === "store").length,
    "PREMIS: harus ada DUA cabang store — dengan satu store pemilihnya memang " +
      "sengaja disembunyikan (lokasiOpsi.length > 1), jadi asersinya tak ada gunanya",
  ).toBe(2);

  return { email, cabang: aktif };
}

test("pemilih lokasi menu tak menawarkan Central Kitchen", async ({ page, request }) => {
  const { email, cabang } = await tenantPro(request);

  await masukLewatSesi(page, request, email, PASS);
  await page.goto("/menu");

  // Premis: halamannya benar-benar terbuka. Tanpa ini, pemilih yang "tak
  // memuat CK" bisa saja tak memuat apa pun karena kita terlempar ke /dashboard.
  await expect(page.getByRole("heading", { name: /Menu & HPP/ })).toBeVisible();

  const pemilih = page.getByLabel("Tampil di lokasi");
  await expect(pemilih).toBeVisible();

  const opsi = await pemilih.locator("option").allTextContents();

  // "Semua lokasi" + dua store. Central Kitchen dan Kantor tak termasuk.
  expect(opsi).toHaveLength(3);
  expect(opsi[0]).toBe("Semua lokasi");

  const namaCk = cabang.find((b) => b.tipe === "central_kitchen")!.nama;
  const namaKantor = cabang.find((b) => b.tipe === "kantor")!.nama;
  for (const teks of opsi) {
    expect(teks, `opsi "${teks}" menyebut Central Kitchen`).not.toContain(namaCk);
    expect(teks, `opsi "${teks}" menyebut Kantor`).not.toContain(namaKantor);
    // Ikon jenis lokasi dari `labelCabang`: 🏭 = central kitchen, 🏢 = kantor.
    // Diperiksa terpisah dari namanya supaya penggantian nama cabang tak
    // diam-diam melumpuhkan asersi di atas.
    expect(teks, `opsi "${teks}" berikon dapur pusat`).not.toContain("🏭");
    expect(teks, `opsi "${teks}" berikon kantor`).not.toContain("🏢");
  }

  // Dan yang MEMANG harus ada: kedua cabang store, berikon toko.
  for (const store of cabang.filter((b) => b.tipe === "store")) {
    expect(opsi).toContain(`🏪 ${store.nama}`);
  }
});

/**
 * PILIHAN BENTUK DAFTAR RESEP — DIUKUR DI PERAMBAN, BUKAN DIBACA.
 *
 * Yang tak bisa dijawab pembacaan kode ada dua, dan keduanya justru inti
 * fiturnya:
 *
 * 1. **Pilihannya bertahan sesudah halaman dimuat ulang.** Penulisan
 *    `localStorage` di repo ini SENGAJA boleh gagal diam-diam (lihat
 *    `lib/simpanan.ts`: aksesnya sendiri bisa melempar di Safari yang
 *    memblokir cookie). Jadi "kode memanggil `tulisLokal`" bukan bukti bahwa
 *    pilihannya kembali — hanya membaca ulang di peramban sungguhan yang bisa
 *    mengatakannya.
 * 2. **Bentuk daftarnya masih membuka resep yang sama.** Kartu ikon dan baris
 *    daftar adalah dua pohon JSX yang berbeda; `onClick` yang tertinggal di
 *    salah satunya menghasilkan daftar yang cuma bisa dipandang.
 *
 * PREMIS DIBUKTIKAN LEBIH DULU di tiap langkah: nama resep yang dipakai
 * diambil dari layar ITU SENDIRI, bukan ditebak dari seed. Uji yang mencari
 * teks yang memang tak pernah ada akan "lolos" dengan cara yang paling buruk —
 * dengan tidak menguji apa pun.
 *
 * MASUK LEWAT SESI, bukan layar login: `POST /auth/login` dibatasi 10 per
 * (IP + email) tiap 5 menit dan suite ini duduk persis di langit-langit itu.
 * Alasan lengkapnya ada di `mutasi-gagal-terlihat.spec.ts`.
 */
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { BASE, masukLewatSesi, OWNER_EMAIL, OWNER_PASS, sesiApi } from "./util";

const IKON = "🔳 Ikon";
const DAFTAR = "☰ Daftar";

test("resep: bentuk daftar bertahan sesudah muat ulang, dan barisnya membuka resep", async ({
  page,
  request,
}) => {
  await masukLewatSesi(page, request, OWNER_EMAIL, OWNER_PASS);

  // Bersihkan pilihan tersimpan lebih dulu: uji yang berangkat dari keadaan
  // yang tak diketahui tak bisa membuktikan apa pun tentang bawaannya.
  await page.goto("/resep");
  await page.evaluate(() => localStorage.removeItem("kakarut.resepTampilan"));
  await page.reload();

  // `expect(...).toBeVisible()`, BUKAN `tampak()` dari util: pembantu itu
  // memulangkan boolean dan tak pernah melempar, jadi `await tampak(x)` yang
  // hasilnya tak diperiksa adalah baris yang tak menguji apa pun. Terlihat
  // saat bukti merah dijalankan — versi pertama berkas ini memakainya begitu.
  const tombolDaftar = page.getByRole("button", { name: DAFTAR });
  await expect(tombolDaftar, "premis: tombol bentuk daftar tampil").toBeVisible();

  // PREMIS: bawaannya IKON — tak ada yang berubah bagi pemakai yang tak
  // menyentuh tombolnya.
  await expect(page.getByRole("button", { name: IKON })).toHaveAttribute("aria-pressed", "true");

  // PREMIS: layarnya memang berisi resep. Tanpa ini, "barisnya membuka resep"
  // benar secara hampa.
  const kartu = page.locator("a,div").filter({ hasText: /batch /i });
  await expect(kartu.first(), "premis: ada resep yang tampil").toBeVisible();

  await tombolDaftar.click();
  await expect(tombolDaftar).toHaveAttribute("aria-pressed", "true");

  // Nama resep diambil dari layar ITU SENDIRI — bukan ditebak dari seed.
  // Bentuk daftar adalah TABEL berkepala: namanya dibaca dari sel di bawah
  // kepala "Nama produk", bukan baris pertama `innerText` — sel pertama kini
  // nomor urut, dan versi lama sebenarnya membaca "🍲" (placeholder foto; seed
  // tak punya foto): premis yang lolos hampa. Teks kepala di-uppercase CSS,
  // jadi dicocokkan tanpa peduli huruf.
  const kepala = page.getByRole("columnheader");
  await expect(
    kepala.filter({ hasText: /nama produk/i }),
    "premis: kepala tabel memuat kolom Nama produk",
  ).toHaveCount(1);
  const idxNama = (await kepala.allInnerTexts()).findIndex((t) => /nama produk/i.test(t));
  const barisPertama = page.locator("tbody tr").first();
  await expect(barisPertama, "premis: bentuk daftar merender barisnya").toBeVisible();
  const namaResep = (await barisPertama.getByRole("cell").nth(idxNama).innerText()).trim();
  expect(namaResep.length, "premis: baris pertama punya nama").toBeGreaterThan(0);
  // PASANGAN peran: owner melihat kolom uang — server menyaring biaya untuk
  // peran lain, layar memagari kolomnya; yang dipaku di sini sisi yang tampil.
  await expect(
    kepala.filter({ hasText: /harga \/ satuan/i }),
    "owner tidak melihat kolom Harga / satuan",
  ).toHaveCount(1);

  // 1) Pilihannya bertahan melewati muat ulang.
  await page.reload();
  await expect(
    page.getByRole("button", { name: DAFTAR }),
    "pilihan bentuk daftar tidak bertahan sesudah muat ulang",
  ).toHaveAttribute("aria-pressed", "true");

  // 2) Barisnya benar-benar membuka resepnya (detail = ?bahan=<id>).
  await page.getByRole("row").filter({ hasText: namaResep }).first().click();
  await expect(page, "baris daftar tidak membuka detail resep").toHaveURL(/[?&]bahan=/);
  await expect(page.getByText(namaResep, { exact: false }).first()).toBeVisible();

  // PASANGAN: kembali ke IKON tetap bekerja, dan ikut tersimpan — tombolnya
  // harus dua arah, bukan pintu satu arah menuju bentuk baru.
  await page.goto("/resep");
  await page.getByRole("button", { name: IKON }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: IKON })).toHaveAttribute("aria-pressed", "true");
});


/*
 * RESEP DIBUKA TERKUNCI, DAN EDIT ADALAH TINDAKAN SADAR.
 *
 * Diminta pemilik repo: *"resep ketika di klik ingin read only saja, dan ingin
 * ada tombol edit untuk admin dan owner"*. Sebelumnya panel detail langsung
 * bisa diketik begitu resepnya diklik — satu klik nyasar di medan takaran
 * sudah cukup mengubah HPP seluruh menu yang memakai bahan itu.
 *
 * Kenapa lengan PERAMBAN, bukan penjaga statis: yang dijanjikan bukan
 * "sumbernya menyebut `sedangUbah`" melainkan "medannya benar-benar tak bisa
 * diketik saat halaman dibuka". Atribut `disabled` yang terpasang di JSX tapi
 * tertimpa di tempat lain tetap lolos pembacaan sumber; ia tak lolos ini.
 */

/**
 * Buka resep yang BENAR-BENAR PUNYA BAHAN, id-nya dari server.
 *
 * Versi pertama lengan ini mengklik baris pertama tabel dan gagal di premisnya
 * — resep teratas kebetulan belum punya satu bahan pun, jadi tak ada medan
 * takaran untuk diperiksa terkunci. Merahnya benar tapi menuduh fiturnya,
 * padahal yang salah pilihan fiksturnya. `/bahan/resep-ringkas` memulangkan
 * peta `id → jumlah bahan`; yang dipakai id pertama yang jumlahnya > 0.
 */
async function bukaResepBerbahan(page: Page, request: APIRequestContext) {
  const { token } = await sesiApi(request, OWNER_EMAIL, OWNER_PASS);
  const r = await request.get(`${BASE}/api/bahan/resep-ringkas`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(r.ok(), `GET /bahan/resep-ringkas (${r.status()})`).toBeTruthy();
  const ringkas = (await r.json()) as Record<string, number>;
  const id = Object.keys(ringkas).find((k) => (ringkas[k] ?? 0) > 0);
  expect(id, "PREMIS: butuh satu resep yang punya bahan").toBeTruthy();
  await page.goto(`/resep?bahan=${id}`);
  const takaran = page.getByPlaceholder("qty").first();
  await expect(takaran, "PREMIS: panel resepnya terbuka & punya baris bahan").toBeVisible({
    timeout: 10_000,
  });
  return takaran;
}

test("resep dibuka TERKUNCI, dan tombol Edit yang membukanya", async ({ page, request }) => {
  await masukLewatSesi(page, request, OWNER_EMAIL, OWNER_PASS);
  const takaran = await bukaResepBerbahan(page, request);

  // INTI 1: keadaan diam halaman ini TERKUNCI, dan tombol simpan tak ada.
  await expect(takaran).toBeDisabled();
  await expect(page.getByRole("button", { name: "Simpan Resep" })).toHaveCount(0);
  const tombolEdit = page.getByRole("button", { name: /Edit resep/ });
  await expect(tombolEdit).toBeVisible();

  // INTI 2: Edit membukanya — medannya bisa diketik, Simpan & Batal muncul.
  await tombolEdit.click();
  await expect(takaran).toBeEnabled();
  await expect(page.getByRole("button", { name: "Simpan Resep" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Batal" })).toBeVisible();
  await expect(tombolEdit).toHaveCount(0);

  /*
   * INTI 3: Batal TANPA mengetik apa pun tidak bertanya — konfirmasi yang
   * muncul juga saat tak ada yang diubah adalah konfirmasi yang orang belajar
   * menekan "OK" tanpa membaca. Dialog apa pun di sini = merah.
   */
  page.on("dialog", (d) => {
    throw new Error(`Batal bertanya padahal tak ada yang diketik: "${d.message()}"`);
  });
  await page.getByRole("button", { name: "Batal" }).click();
  await expect(takaran).toBeDisabled();
  await expect(page.getByRole("button", { name: /Edit resep/ })).toBeVisible();
});

test("perubahan yang belum disimpan tak hilang tanpa ditanya", async ({ page, request }) => {
  await masukLewatSesi(page, request, OWNER_EMAIL, OWNER_PASS);
  const takaran = await bukaResepBerbahan(page, request);
  await page.getByRole("button", { name: /Edit resep/ }).click();
  await expect(takaran).toBeEnabled();
  const semula = await takaran.inputValue();
  await takaran.fill("123,45");

  // Batal SESUDAH mengetik → wajib bertanya, dan menolak = tetap di mode ubah.
  let ditanya = 0;
  page.once("dialog", (d) => {
    ditanya += 1;
    void d.dismiss();
  });
  await page.getByRole("button", { name: "Batal" }).click();
  expect(ditanya, "Batal membuang ketikan tanpa bertanya").toBe(1);
  await expect(takaran).toBeEnabled();
  await expect(takaran).toHaveValue("123,45");

  // Menerima → draf dipulihkan ke nilai saat Edit ditekan, panel terkunci lagi.
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Batal" }).click();
  await expect(takaran).toBeDisabled();
  await expect(takaran).toHaveValue(semula);
});

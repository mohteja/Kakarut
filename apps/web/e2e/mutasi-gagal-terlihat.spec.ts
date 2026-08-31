/**
 * PENULISAN YANG GAGAL HARUS TERLIHAT — DIUKUR DI PERAMBAN, BUKAN DIBACA.
 *
 * `useMutation` yang gagal tidak melempar dan tidak merender apa pun sendiri:
 * `onSuccess` sekadar tak jalan. Tombolnya ditekan, tak ada yang berubah, tak
 * ada yang dikatakan — dan orangnya menekan lagi.
 *
 * Sapuan sisi kode (`apps/server/test/mutasi-gagal-terlihat.test.ts`)
 * menyatakan ke-124 mutasi web punya jalan ke layar. Berkas ini menjawab
 * pertanyaan yang TIDAK bisa dijawab pembacaan kode: apakah jalan itu
 * benar-benar berakhir di mata orang.
 *
 * KEGAGALANNYA DIPAKSA SECARA NYATA, bukan lewat `page.route` yang memalsukan
 * balasan: mejanya DIHAPUS lewat API sesudah layarnya memuat daftar, lalu
 * tombol hapus di layar ditekan. Itu balapan yang sesungguhnya — dua orang di
 * dua perangkat menghapus meja yang sama — dan server menjawab 404 aslinya
 * ("Meja tidak ditemukan"). Balasan palsu hanya menguji penanganan `Error`;
 * yang ini menguji kontraknya.
 */
import { expect, test } from "@playwright/test";
import { BASE, masukLewatSesi, OWNER_EMAIL, OWNER_PASS } from "./util";

type Meja = { id: string; nama: string };

/**
 * MASUK LEWAT SESI, bukan lewat layar login — dan itu bukan pilihan gaya.
 *
 * `POST /auth/login` dibatasi 10 per (IP + email) tiap 5 menit
 * (`modules/auth/routes.ts:56`), dan suite ini duduk PERSIS di langit-langit
 * itu. Spec baru yang memakai layar login mendorongnya lewat — TERUKUR:
 * dengan `login()`, `stok-awal-gagal.spec.ts` (spec yang tak ada hubungannya)
 * memerah dengan `TypeError: Cannot read properties of undefined (reading
 * 'length')`, yaitu balasan 429 yang tak punya medan yang diharapkannya;
 * tanpa spec ini suite hijau 10/10.
 *
 * `util.ts` sudah menyediakan jalannya (`masukLewatSesi`) beserta alasannya:
 * *"spec yang tidak sedang menguji layar login tak perlu memakai jatah itu"*.
 * Yang diuji di sini kegagalan MUTASI, bukan layar login.
 */
async function tokenDariSesi(page: import("@playwright/test").Page) {
  const mentah = await page.evaluate(() => localStorage.getItem("kakarut.auth"));
  expect(mentah, "premis: sesi peramban tersimpan").toBeTruthy();
  return (JSON.parse(mentah as string) as { token: string }).token;
}

test("meja: hapus yang KALAH BALAPAN mengatakan sebabnya di layar", async ({ page, request }) => {
  await masukLewatSesi(page, request, OWNER_EMAIL, OWNER_PASS);
  const h = { Authorization: `Bearer ${await tokenDariSesi(page)}` };

  // Meja khusus uji ini — supaya kegagalannya tak bergantung data seed.
  // Nama PENDEK: daftar meja memotong nama panjang, dan pemilih yang
  // mencocokkan teks penuh tak akan pernah menemukan barisnya.
  const nama = `Zz${Date.now() % 100000}`;
  const buat = await request.post(`${BASE}/api/meja`, { headers: h, data: { nama } });
  expect(buat.ok(), "premis: mejanya berhasil dibuat").toBeTruthy();
  const meja = (await buat.json()) as Meja;

  await page.goto("/pengaturan/meja");

  // PREMIS: mejanya memang tampil. Tanpa ini, "tak ada kalimat gagal" bisa
  // berarti "tombolnya tak pernah ditekan" — dan sapuan yang menembak layar
  // kosong akan terbaca sebagai kebersihan sempurna.
  const baris = page.getByText(nama, { exact: false }).first();
  await expect(baris, "premis: meja uji tampil di layar").toBeVisible({ timeout: 15_000 });

  // Perangkat LAIN menghapusnya lebih dulu.
  const hapusDuluan = await request.delete(`${BASE}/api/meja/${meja.id}`, { headers: h });
  expect(hapusDuluan.ok(), "premis: penghapusan pertama berhasil").toBeTruthy();

  // Tombol Hapus hanya ada di mode atur denah.
  await page.getByRole("button", { name: /Atur Denah/i }).click();

  // Sekarang layar ini menekan hapus atas meja yang sudah tak ada → 404.
  page.once("dialog", (d) => void d.accept());
  const barisDaftar = page
    .locator("div")
    .filter({ hasText: nama })
    .filter({ has: page.getByRole("button", { name: /^Hapus$/ }) })
    .last();
  await barisDaftar.getByRole("button", { name: /^Hapus$/ }).click();

  // Kalimat server ("Meja tidak ditemukan") harus sampai ke layar. Yang
  // dipaku BUKAN ejaannya melainkan bahwa ADA kalimat kegagalan — ejaan
  // adalah milik server, dan gerbang yang memakunya akan memerah tiap kali
  // pesannya diperbaiki.
  await expect
    .poll(async () => (await page.locator("body").innerText()).toLowerCase(), {
      timeout: 15_000,
      message: "kegagalan hapus meja tak dikatakan apa pun di layar",
    })
    .toMatch(/tidak ditemukan|gagal|tak ditemukan/);
});

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
import { expect, test } from "@playwright/test";
import { masukLewatSesi, OWNER_EMAIL, OWNER_PASS } from "./util";

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
  const barisPertama = page.locator("div.cursor-pointer").first();
  await expect(barisPertama, "premis: bentuk daftar merender barisnya").toBeVisible();
  const namaResep = (await barisPertama.innerText()).split("\n")[0]!.trim();
  expect(namaResep.length, "premis: baris pertama punya nama").toBeGreaterThan(0);

  // 1) Pilihannya bertahan melewati muat ulang.
  await page.reload();
  await expect(
    page.getByRole("button", { name: DAFTAR }),
    "pilihan bentuk daftar tidak bertahan sesudah muat ulang",
  ).toHaveAttribute("aria-pressed", "true");

  // 2) Barisnya benar-benar membuka resepnya (detail = ?bahan=<id>).
  await page.locator("div.cursor-pointer").first().click();
  await expect(page, "baris daftar tidak membuka detail resep").toHaveURL(/[?&]bahan=/);
  await expect(page.getByText(namaResep, { exact: false }).first()).toBeVisible();

  // PASANGAN: kembali ke IKON tetap bekerja, dan ikut tersimpan — tombolnya
  // harus dua arah, bukan pintu satu arah menuju bentuk baru.
  await page.goto("/resep");
  await page.getByRole("button", { name: IKON }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: IKON })).toHaveAttribute("aria-pressed", "true");
});

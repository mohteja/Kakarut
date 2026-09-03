/**
 * PRATINJAU FOTO MENU — DIUKUR DI PERAMBAN, SEBAB DI SITULAH JANJINYA DIBUAT.
 *
 * Menu & HPP kini punya bentuk ikon yang menjanjikan satu hal spesifik:
 * "beginilah foto ini akan terlihat di kasir". `menu-tampilan-ikon.test.ts`
 * sudah memaku bahwa kartunya SATU komponen dan kelas fotonya cuma ada di satu
 * berkas — tapi pembacaan kode tak bisa menjawab tiga hal, dan ketiganya
 * justru inti fiturnya:
 *
 * 1. **Fotonya benar-benar sampai ke layar sebagai `<img>`.** DTO-nya sudah
 *    membawa `image_url` bertahun-tahun dan halaman ini tak pernah sekali pun
 *    memakainya; "medan itu ada" bukan bukti "gambarnya muncul".
 * 2. **Pilihannya bertahan sesudah muat ulang.** `lib/simpanan` SENGAJA boleh
 *    gagal diam-diam (Safari yang memblokir cookie melempar saat penyimpanan
 *    diakses), jadi "kode memanggil `tulisLokal`" bukan bukti apa pun.
 * 3. **Kartunya bisa diklik dan membuka menunya.** Grid ikon dan tabel adalah
 *    dua pohon JSX; yang satu bisa kehilangan jalan keluarnya tanpa yang lain
 *    berubah.
 *
 * PREMISNYA DIBUKTIKAN DENGAN MEMBUAT MENUNYA SENDIRI, dan itu bukan kerapian.
 * Data seed repo ini TIDAK memuat satu pun foto menu (`seed/data/*.json` tak
 * punya medan gambar sama sekali). Diukur pada DB gerbang 2026-09-03: 102 menu
 * aktif, 2 berfoto — dan KEDUANYA sisa dari `verify-api.sh` §145/§253, bukan
 * dari seed. Spek yang cuma membuka halaman lalu mencari `<img>` karena itu
 * akan hijau di gerbang penuh (verify-api jalan lebih dulu) dan MERAH saat
 * `npm run test:e2e` dijalankan sendiri terhadap DB yang baru di-seed —
 * hijau karena sampah orang lain adalah bentuk hampa yang paling sulit
 * terlihat. Jadi spek ini menanam fotonya sendiri.
 */
import { expect, test, type APIRequestContext } from "@playwright/test";
import { BASE, masukLewatSesi, OWNER_EMAIL, OWNER_PASS, sesiApi } from "./util";

const IKON = "🔳 Ikon";
const DAFTAR = "☰ Daftar";
/** PNG 1×1 transparan — supaya `<img>`-nya benar-benar MUAT, bukan sekadar ada. */
const FOTO =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

async function buatMenuBerfoto(request: APIRequestContext) {
  const { token } = await sesiApi(request, OWNER_EMAIL, OWNER_PASS);
  const h = { Authorization: `Bearer ${token}` };

  const rKat = await request.get(`${BASE}/api/kategori`, { headers: h });
  expect(rKat.ok(), `GET /kategori (${rKat.status()})`).toBeTruthy();
  const kategori = (await rKat.json()) as { id: string; nama: string }[];
  expect(kategori.length, "PREMIS: perusahaan uji punya kategori menu").toBeGreaterThan(0);

  const nama = `Uji Foto ${Date.now()}`;
  const r = await request.post(`${BASE}/api/menu`, {
    headers: h,
    data: {
      nama,
      category_id: kategori[0].id,
      tipe: "regular",
      // `mult` WAJIB untuk menu reguler — server menolak 400 "Menu reguler
      // wajib punya mult (markup)" tanpanya. Ketahuan saat gerbang pertama:
      // premisnya merah, bukan asersinya, dan itu memang cara premis harus
      // gagal.
      mult: 3,
      harga_jual: 12345,
      image_url: FOTO,
    },
  });
  expect(r.ok(), `POST /menu (${r.status()})`).toBeTruthy();
  const menu = (await r.json()) as { id: string; image_url: string | null };
  expect(menu.image_url, "PREMIS: server benar-benar menyimpan fotonya").toBe(FOTO);
  return { id: menu.id, nama, kategori: kategori[0].nama };
}

test("Menu & HPP: bentuk ikon memperlihatkan foto seperti di kasir, dan pilihannya bertahan", async ({
  page,
  request,
}) => {
  const menu = await buatMenuBerfoto(request);
  await masukLewatSesi(page, request, OWNER_EMAIL, OWNER_PASS);

  // Berangkat dari keadaan yang DIKETAHUI: uji yang mulai dari pilihan
  // tersimpan entah apa tak bisa membuktikan apa pun tentang bawaannya.
  await page.goto("/menu");
  await page.evaluate(() => localStorage.removeItem("kakarut.menuTampilan"));
  await page.reload();

  // PREMIS: bawaannya DAFTAR — tak ada layar siapa pun yang berubah tanpa ia
  // menekan tombolnya.
  await expect(page.getByRole("button", { name: DAFTAR })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("table tbody tr").first(), "premis: tabelnya merender baris").toBeVisible();
  // …dan bentuk daftar memang belum menampilkan foto apa pun.
  await expect(page.locator(`img[src="${FOTO}"]`)).toHaveCount(0);

  // Cari menu yang barusan dibuat supaya layarnya tak dipenuhi 100 menu lain.
  await page.getByLabel("Cari menu").fill(menu.nama);

  await page.getByRole("button", { name: IKON }).click();
  await expect(page.getByRole("button", { name: IKON })).toHaveAttribute("aria-pressed", "true");

  // 1) FOTONYA SAMPAI KE LAYAR — dan lewat kotak yang sama dengan kasir.
  const foto = page.locator(`img[src="${FOTO}"]`);
  await expect(foto, "foto menu tidak dirender di bentuk ikon").toBeVisible();
  await expect(
    foto,
    "kotak fotonya bukan kotak kasir — potongan `object-cover`-nya jadi lain",
  ).toHaveClass(/h-20 w-full rounded-lg object-cover/);

  // 2) Pilihannya bertahan melewati muat ulang.
  await page.reload();
  await expect(
    page.getByRole("button", { name: IKON }),
    "pilihan bentuk ikon tidak bertahan sesudah muat ulang",
  ).toHaveAttribute("aria-pressed", "true");

  // 3) Kartunya membuka menunya — pratinjau yang cuma bisa dipandang adalah
  //    jalan buntu di halaman yang justru pintu utama menyunting menu.
  await page.getByLabel("Cari menu").fill(menu.nama);
  await page.getByRole("button", { name: new RegExp(menu.nama) }).click();
  await expect(page, "kartu ikon tidak membuka layar ubah menu").toHaveURL(
    new RegExp(`/menu/${menu.id}/edit$`),
  );
});

test("menu tanpa foto memakai lambang yang sama dengan kasir, dan chipnya menyaringnya", async ({
  page,
  request,
}) => {
  const menu = await buatMenuBerfoto(request);
  await masukLewatSesi(page, request, OWNER_EMAIL, OWNER_PASS);
  await page.goto("/menu");
  await page.getByRole("button", { name: IKON }).click();

  // PREMIS: katalog uji memang berisi menu TANPA foto — kalau semuanya berfoto,
  // lengan di bawah benar secara hampa. (Terukur: 100 dari 102 tanpa foto.)
  const chip = page.getByRole("button", { name: /tanpa foto/ });
  await expect(chip, "premis: ada menu tanpa foto di katalog").toBeVisible();
  const jumlah = Number((await chip.innerText()).replace(/\D+/g, ""));
  expect(jumlah, "premis: hitungannya bukan nol").toBeGreaterThan(0);

  // Lambang 🍜 dipakai untuk menu tanpa foto — sama seperti kartu kasir.
  await expect(page.getByText("🍜", { exact: true }).first()).toBeVisible();

  /*
   * Chipnya MENYARING: menu berfoto yang barusan dibuat harus lenyap.
   *
   * SENGAJA TANPA mengetik di kotak cari lebih dulu, walau itu yang pertama
   * terpikir. Hitungan chip menghormati saringan cari (memang begitu
   * rancangannya — angkanya harus sama dengan yang bisa dibuka tombolnya),
   * jadi mencari nama menu BERFOTO membuat hitungannya jatuh ke nol dan
   * chipnya lenyap tepat sebelum diklik. Ditemukan saat menulis spek ini, dan
   * ditulis di sini supaya tak dicoba lagi.
   */
  const fotoDiGrid = page.locator(`img[src="${FOTO}"]`);
  // `.first()`, bukan `toHaveCount(1)`: tiap jalan spek ini menanam satu menu
  // berfoto lagi dengan PNG yang sama, jadi jumlahnya tumbuh tiap kali suite
  // dijalankan atas DB yang tidak di-reset. Yang perlu dibuktikan bukan
  // "tepat satu" melainkan "sedang tampil" — dan sesudah chipnya ditekan,
  // NOL, yang justru asersi lebih kuat: saringannya membuang SEMUA menu
  // berfoto, bukan cuma yang barusan dibuat.
  await expect(fotoDiGrid.first(), "premis: menu berfotonya memang sedang tampil").toBeVisible();
  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await expect(
    fotoDiGrid,
    "chip 'tanpa foto' tidak menyaring — menu berfoto masih tampil",
  ).toHaveCount(0);
});

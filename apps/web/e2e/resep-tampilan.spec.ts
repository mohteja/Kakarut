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
 * Buka resep yang BENAR-BENAR PUNYA BAHAN **dan boleh disimpan**, id-nya dari
 * server.
 *
 * Versi pertama lengan ini mengklik baris pertama tabel dan gagal di premisnya
 * — resep teratas kebetulan belum punya satu bahan pun. Versi kedua memakai
 * `/bahan/resep-ringkas` (peta `id → jumlah bahan`) dan mengambil id PERTAMA
 * yang jumlahnya > 0. Itu pun salah, dua kali:
 *
 * 1. **PILIHANNYA TAK MENENTU.** Rutenya sebuah `GROUP BY` TANPA `ORDER BY`
 *    (`bahan/routes.ts`), diserialkan jadi objek JSON — jadi "yang pertama"
 *    adalah apa pun yang kebetulan dipulangkan Postgres. Lengan ini hijau
 *    berbulan-bulan karena UNTUNG, lalu merah karena putaran yang menyisipkan
 *    baris ke tabel lain menggeser tata letak fisiknya. Merah yang tak
 *    menyatakan apa pun tentang produk, dan yang paling mahal untuk didiagnosis
 *    justru karena ia pernah hijau. Karena itu kandidatnya DIURUT.
 * 2. **TAK DIJAMIN BISA DISIMPAN.** `PUT /bahan/:id/resep` menolak dengan 409
 *    selama bahan itu punya produksi ber-status `rencana`/`dikerjakan` —
 *    penjaga yang benar, sebab `catatKonsumsiProduksi` membaca resep LIVE.
 *    Lengan yang MENYIMPAN resep karena itu menuntut resep yang boleh
 *    disimpan, dan tuntutan itu tak pernah dinyatakan di mana pun. Terukur:
 *    layarnya memajang kalimat 409-nya dengan benar, dan yang gagal justru
 *    asersi "✓ Tersimpan" — kegagalan yang menuduh fitur yang tak bersalah.
 *
 * Penyaring di bawah adalah CERMIN penjaga server, bukan tebakan: himpunan
 * status yang sama (`rencana`, `dikerjakan`), sumber yang sama
 * (`productions` lewat `GET /produksi`).
 */
async function bukaResepBerbahan(page: Page, request: APIRequestContext) {
  const { token } = await sesiApi(request, OWNER_EMAIL, OWNER_PASS);
  const kepala = { Authorization: `Bearer ${token}` };
  const r = await request.get(`${BASE}/api/bahan/resep-ringkas`, { headers: kepala });
  expect(r.ok(), `GET /bahan/resep-ringkas (${r.status()})`).toBeTruthy();
  const ringkas = (await r.json()) as Record<string, number>;

  /*
   * Bahan yang produksinya masih berjalan → resepnya TERKUNCI di server.
   *
   * `branch_id=all`, dan itu BUKAN kehati-hatian berlebih: penjaga 409 di
   * `PUT /bahan/:id/resep` menanyakan `productions` TANPA syarat cabang sama
   * sekali, sementara `GET /produksi` terkurung cabang. Tanpa `all`, premis ini
   * melihat 10 bahan terkunci padahal server melihat 19 — dan sembilan
   * selisihnya justru yang berproduksi di Central Kitchen, tempat sebagian
   * besar produksi memang terjadi. Versi pertama penyaring ini (putaran lalu)
   * ditulis tanpa `all`, jadi ia menyaring hal yang nyaris tak pernah cocok
   * dan gerbang berikutnya mendarat lagi di resep yang terkunci.
   */
  const prod = await request.get(`${BASE}/api/produksi?per_page=200&branch_id=all`, {
    headers: kepala,
  });
  expect(prod.ok(), `GET /produksi (${prod.status()})`).toBeTruthy();
  const { rows, total } = (await prod.json()) as {
    rows: { ingredient_id?: string; status: string }[];
    total: number;
  };
  /*
   * Daftar yang DIPOTONG membuat penyaring ini diam-diam kurang: bahan yang
   * terkunci di faktur ke-201 tak pernah terlihat, dan premisnya memilihnya
   * dengan yakin. Kalau plafonnya kelak terlampaui, ia harus BERBUNYI — bukan
   * menyaring separuh lalu gagal di tempat lain dengan sebab yang menyesatkan.
   */
  expect(
    total,
    `PREMIS: ${total} faktur produksi melewati per_page=200 — penyaring "produksi berjalan" ` +
      `jadi tak lengkap; naikkan plafonnya atau telusuri halamannya`,
  ).toBeLessThanOrEqual(200);
  const terkunci = new Set(
    rows
      .filter((b) => b.status === "rencana" || b.status === "dikerjakan")
      .map((b) => b.ingredient_id)
      .filter((x): x is string => !!x),
  );

  const id = Object.keys(ringkas)
    .filter((k) => (ringkas[k] ?? 0) > 0 && !terkunci.has(k))
    // `.sort()` BUKAN kerapian: tanpanya pilihannya berpindah tiap kali tata
    // letak tabel bergeser, dan uji yang subjeknya berpindah sendiri tak bisa
    // dipercaya saat ia merah MAUPUN saat ia hijau.
    .sort()[0];
  expect(
    id,
    `PREMIS: butuh resep berbahan yang produksinya TIDAK berjalan — ` +
      `${Object.keys(ringkas).length} resep berbahan, ${terkunci.size} bahan terkunci produksi`,
  ).toBeTruthy();
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

/**
 * RIWAYAT RESEP & HARGA — ada di KEDUA mode, dan simpan menambahnya.
 *
 * Dua hal yang tak bisa dijawab pembacaan kode, dan keduanya inti fiturnya:
 *
 * 1. **Panelnya ada saat halaman TERKUNCI.** Permintaan pemiliknya eksplisit
 *    ("di edit ataupun readonly"), dan alasannya bukan kelengkapan: riwayat
 *    dipakai untuk memutuskan APAKAH perlu mengedit — terutama saat kotak
 *    persetujuan harga di atasnya menawarkan menggeser HPP beberapa menu
 *    sekaligus. Riwayat yang cuma muncul sesudah menekan Edit datang
 *    terlambat.
 * 2. **Daftarnya segar sesudah Simpan.** Baris riwayatnya LAHIR dari simpan
 *    itu. Tanpa `invalidateQueries(["riwayat-resep", …])` panelnya memajang
 *    daftar tanpa perubahan yang barusan disimpan, tepat pada detik seseorang
 *    paling mungkin melihatnya — dan diamnya terbaca sebagai "simpanan saya
 *    tak tercatat". Cache react-query tak bisa diperiksa dari kode; hanya
 *    peramban yang bisa mengatakan apakah daftarnya benar-benar berubah.
 */
test("riwayat resep tampil di mode BACA, dan Simpan menambah barisnya", async ({
  page,
  request,
}) => {
  await masukLewatSesi(page, request, OWNER_EMAIL, OWNER_PASS);
  const takaran = await bukaResepBerbahan(page, request);

  // INTI 1: panelnya ada sebelum tombol Edit pernah disentuh.
  const kepala = page.getByRole("button", { name: /Riwayat resep & harga/ });
  await expect(kepala, "panel riwayat tak ada di mode baca").toBeVisible();
  await expect(page.getByRole("button", { name: /Edit resep/ })).toBeVisible();

  // PREMIS: panelnya terbuka dan benar-benar memuat sesuatu — entah daftar,
  // entah kalimat "belum ada". Menghitung baris pada panel yang masih memutar
  // spinner akan mengukur nol dan menyebutnya jawaban.
  const baris = page.locator("li").filter({ hasText: /Dibuat|Resep|Harga/ });
  await expect
    .poll(async () => await baris.count(), { timeout: 10_000 })
    .toBeGreaterThan(0);
  const sebelum = await baris.count();

  // INTI 2: ubah takaran ke nilai yang PASTI berbeda, simpan, dan daftarnya
  // harus bertambah tanpa muat ulang halaman.
  await page.getByRole("button", { name: /Edit resep/ }).click();
  await expect(kepala, "panel riwayat hilang saat mode ubah").toBeVisible();
  await expect(takaran).toBeEnabled();
  const semula = await takaran.inputValue();
  await takaran.fill(semula === "7" ? "8" : "7");
  await page.getByRole("button", { name: "Simpan Resep" }).click();

  await expect(page.getByText("✓ Tersimpan")).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(async () => await baris.count(), {
      timeout: 15_000,
      message: "riwayat tak bertambah sesudah simpan — panelnya tak disegarkan",
    })
    .toBe(sebelum + 1);

  /*
   * Isinya menyebut perubahan yang barusan dilakukan, bukan sekadar bertambah.
   *
   * NILAINYA DIFORMAT DULU, dan itu bukan kerapian: `inputValue()` memulangkan
   * angka MENTAH ("2000") sementara panelnya merender lewat `formatAngka`, yang
   * mengelompokkan ribuan ala id-ID ("2.000"). Membandingkan keduanya langsung
   * hanya hijau selama takaran resep yang terpilih di bawah 1.000 — dan itu
   * persis kenapa lengan ini baru merah sekarang: perbaikan cakupan cabang di
   * `bukaResepBerbahan` menggeser pilihannya ke resep bertakaran 2.000.
   */
  const tampil = (v: string) =>
    new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(Number(v));
  await expect(baris.first()).toContainText(`${tampil(semula)} → `);
});

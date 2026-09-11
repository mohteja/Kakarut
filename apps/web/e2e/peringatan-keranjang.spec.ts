/**
 * PERINGATAN KERANJANG — kalimat SERVER, dibaca dari DOM sungguhan.
 *
 * `POST /penjualan/cek-stok` lahir supaya kasir membaca, sebelum menekan Bayar,
 * kalimat yang PERSIS SAMA dengan yang akan ia terima kalau ia menekannya.
 * verify-api §300 sudah memaku separuhnya dari kawat: ramalan == vonis, byte
 * per byte, dan predikat gerbangnya satu (`gerbangBerlaku`).
 *
 * Separuh yang lain tak pernah diuji siapa pun: **apakah kalimat itu sampai ke
 * layar.** Yang menahannya selama ini penjaga STATIS — sebuah asersi bahwa
 * `KasirPage.tsx` menyebut `cekStok.pesan` — dan penjaga statis tak bisa
 * membedakan "dirender" dari "dirender di cabang yang tak pernah menyala".
 *
 * Spec ini pernah ditulis dan DICABUT 2026-09-06: `pilihMeja` menggantung
 * sesudah `masukLewatSesi`. Sebabnya bukan kombinasi itu — `printer.spec.ts`
 * memakai keduanya sejak lama — melainkan satu baris yang hilang di antaranya:
 * `masukLewatSesi` berakhir di `/`, dan tanpa `goto("/kasir")` layar kasirnya
 * tak pernah terbuka, jadi modal mejanya memang tak akan pernah datang.
 *
 * DUA CABANG DIUJI, dan itu yang membuat lengan ini menyatakan sesuatu:
 * setelan "Tolak pesanan yang melebihi stok" MATI → spanduk kuning "keranjang
 * ini membuat stok minus"; MENYALA → spanduk merah "akan DITOLAK saat Bayar".
 * Kalau cuma satu yang diuji, hijau tak membedakan spanduk yang mengikuti
 * setelan dari spanduk yang selalu sama.
 */
import { expect, test } from "@playwright/test";
import {
  BASE, KASIR_EMAIL, KASIR_PASS, OWNER_EMAIL, OWNER_PASS,
  absenMasuk, kosongkanMeja, masukLewatSesi, pastikanShiftTerbuka, pilihMeja, sesiApi,
} from "./util";

const MENU = "Premium Basooopa A";
/** Meja 1–3 dipakai spec lain; dua spec yang berbagi meja saling menjatuhkan. */
const MEJA = "Meja 4";

test("kasir: keranjang melebihi stok → kalimat server muncul, dan setelannya yang menentukan warnanya", async ({
  page,
  request,
}) => {
  const { token: owner } = await sesiApi(request, OWNER_EMAIL, OWNER_PASS);
  const h = { Authorization: `Bearer ${owner}` };
  const setel = async (nyala: boolean) => {
    const r = await request.patch(`${BASE}/api/company`, {
      headers: h,
      data: { blokir_jual_minus: nyala },
    });
    expect(r.ok(), `PATCH /company (status ${r.status()})`).toBeTruthy();
  };

  // Keadaan awal DIBACA, bukan diasumsikan — setelan ini bertahan di basis
  // data, dan spec yang meninggalkannya berubah akan menjatuhkan spec lain
  // lewat keadaan, bukan lewat kode.
  const semula = (await (await request.get(`${BASE}/api/company`, { headers: h })).json()) as {
    blokirJualMinus: boolean;
  };

  try {
    // ── PREMIS: menunya memang langka, dan seberapa langkanya DIBACA ────────
    const menus = (await (await request.get(`${BASE}/api/menu`, { headers: h })).json()) as {
      id: string;
      nama: string;
      is_active: boolean;
    }[];
    const pba = menus.find((m) => m.nama.startsWith(MENU) && m.is_active);
    expect(pba, `${MENU} tak ada / tak aktif di basis data ini`).toBeTruthy();
    const sisa = (await (
      await request.get(`${BASE}/api/menu/ketersediaan`, { headers: h })
    ).json()) as { menu_id: string; porsi: number | null; pembatas: { nama: string } | null }[];
    const baris = sisa.find((s) => s.menu_id === pba!.id);
    expect(baris?.pembatas, "menu ini tak punya bahan pembatas — premisnya runtuh").toBeTruthy();
    const porsi = baris!.porsi ?? 0;
    /*
     * Jumlah klik "+" dibatasi, dan batasnya PREMIS yang gagal keras — bukan
     * `skip`. Sebuah spec yang melewati dirinya sendiri saat datanya tak cocok
     * adalah spec yang berhenti bisa menuduh, dan kita tak akan tahu kapan.
     *
     * ANGKANYA 30, dan pernah 5 — versi pertama spec ini lolos di basis data
     * yang sudah AUS oleh jalan e2e sebelumnya (`porsi` 0 di sana), lalu
     * premisnya runtuh pada seed segar yang memberi 23. Batas yang hanya benar
     * atas sisa keadaan adalah cacat yang sama dengan yang dikeluhkan di skrip
     * gerbang; di sini ia dibayar dengan memakai ANGKA DARI KAWAT, bukan angka
     * yang dihafal.
     */
    expect(porsi, `sisa porsi ${MENU} terlalu besar untuk diuji lewat tombol +`).toBeLessThanOrEqual(30);
    // Negatif mungkin (stok sudah minus dari spec lain): nol klik pun sudah
    // melebihi, sebab keranjangnya tetap berisi satu porsi.
    const klik = Math.max(0, porsi);
    const bahanKurang = baris!.pembatas!.nama;

    // ── Setelan MATI dulu: itu bawaannya, dan cabang kuningnya yang berlaku ──
    await setel(false);

    const kasir = await absenMasuk(request, KASIR_EMAIL, KASIR_PASS);
    await kosongkanMeja(request, kasir, MEJA);
    await masukLewatSesi(page, request, KASIR_EMAIL, KASIR_PASS);
    // BARIS YANG DULU HILANG: `masukLewatSesi` berakhir di `/`, dan modal meja
    // cuma hidup di layar kasir.
    await page.goto("/kasir");
    await expect(page).toHaveURL(/\/kasir/);
    await pastikanShiftTerbuka(page);
    await pilihMeja(page, MEJA);

    await page.getByRole("button", { name: "Paket Premium" }).click();
    const tombolMenu = page.getByRole("button", { name: new RegExp(MENU) });
    await tombolMenu.click();
    // qty = porsi + 1 → keranjangnya PASTI melebihi stok, berapa pun sisanya.
    for (let i = 0; i < klik; i += 1) {
      await page.getByRole("button", { name: "+", exact: true }).first().click();
    }

    const kuning = page.getByText(/Keranjang ini membuat stok minus/);
    await expect(kuning).toBeVisible();
    // KALIMATNYA MILIK SERVER: yang dipaku bukan spanduknya melainkan bahwa
    // ISINYA menyebut bahan pembatas yang dihitung server. Spanduk yang
    // merakit kalimatnya sendiri akan lolos asersi "spanduk tampak".
    await expect(kuning).toContainText(bahanKurang);
    await expect(page.getByText(/sedang mati/)).toBeVisible();

    // ── Setelan MENYALA: spanduk yang sama berubah jadi vonis ───────────────
    await setel(true);
    /*
     * Kunci query `cek-stok` memuat BADANnya, jadi menyalakan setelan di server
     * saja tak menarik jawaban baru — itu benar dan disengaja (dua keranjang
     * yang sama tak perlu ditanyakan dua kali). Menambah satu porsi mengubah
     * badannya, dan itulah cara paling jujur memancing pembacaan ulang: lewat
     * layar, seperti yang dilakukan kasir.
     */
    await page.getByRole("button", { name: "+", exact: true }).first().click();

    const merah = page.getByText(/Pesanan ini akan DITOLAK saat Bayar/);
    await expect(merah).toBeVisible();
    /*
     * DAN NAMA BAHANNYA HARUS TERBACA DI SPANDUK ITU, bukan di mana pun di
     * halaman. Asersi pertama versi spec ini justru tak berpagar, dan
     * Playwright yang menegurnya: `getByText(/Baso aci original/)` cocok DUA
     * kali — spanduknya, dan lencana "Habis · {bahan}" di grid menu. Tanpa
     * pagar ini, lengan merahnya akan hijau bahkan bila spanduknya lupa
     * menyebut kalimat server sama sekali.
     *
     * Cabang merah merender vonisnya di dalam `<b>`, jadi `merah` menunjuk
     * elemen yang LEBIH KECIL dari spanduknya; yang dicari di sini adalah satu
     * elemen yang memuat keduanya.
     */
    const spandukMerah = page
      .getByText(new RegExp(bahanKurang))
      .filter({ hasText: /Pesanan ini akan DITOLAK saat Bayar/ });
    await expect(spandukMerah).toHaveCount(1);
    await expect(page.getByText(/Tolak pesanan yang melebihi stok/)).toBeVisible();
    // …dan spanduk kuningnya benar-benar PERGI, bukan menumpuk di sebelahnya.
    await expect(kuning).toHaveCount(0);
  } finally {
    // Dikembalikan apa pun yang terjadi di atas — termasuk saat asersinya
    // gagal. Spec yang meninggalkan setelan menyala membuat spec berikutnya
    // gagal karena alasan yang tak ada hubungannya.
    await setel(semula.blokirJualMinus);
  }
});

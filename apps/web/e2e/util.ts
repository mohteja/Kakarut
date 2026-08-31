/**
 * Perkakas bersama untuk uji end-to-end.
 *
 * SATU RUMAH, bukan disalin per berkas. Ketiga spec di sini memerlukan
 * prasyarat yang SAMA (absen masuk, shift terbuka, meja bebas), dan prasyarat
 * itu bertambah seiring produknya. Saat `pos.spec.ts` diperbaiki, ketiga
 * salinan `login()` yang ada ternyata sudah usang dengan cara yang sama —
 * persis bentuk cacat yang dijaga `konsep-satu-rumah.test.ts` di sisi server.
 */
import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";

export const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
export const KASIR_EMAIL = process.env.E2E_KASIR_EMAIL ?? "kasir@basooopa.id";
export const KASIR_PASS = process.env.E2E_KASIR_PASS ?? "Kasir123!";
export const OWNER_EMAIL = process.env.E2E_OWNER_EMAIL ?? "terahokiindonesia@gmail.com";
export const OWNER_PASS = process.env.E2E_OWNER_PASS ?? "Basooopa123!";

export async function login(page: Page, email: string, pass: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(pass);
  await page.getByRole("button", { name: "Masuk" }).click();
}

/**
 * "Apakah elemen ini muncul?" — DITUNGGU, bukan ditembak sekejap.
 *
 * `isVisible()` memulangkan jawaban SEKARANG JUGA. Dipakai tepat setelah
 * navigasi atau sebuah mutasi, ia hampir selalu memulangkan false — bukan
 * karena elemennya tak akan muncul, melainkan karena ia belum sempat. Cabang
 * "kalau belum ada, klik tombolnya" lalu berjalan salah dan kliknya mengenai
 * overlay yang justru sedang muncul. Dua kali menggigit saat berkas ini
 * ditulis, di dua langkah berbeda.
 */
export async function tampak(l: Locator, ms = 5000) {
  return l
    .waitFor({ state: "visible", timeout: ms })
    .then(() => true)
    .catch(() => false);
}

/**
 * Token API, DISIMPAN per email selama satu jalan.
 *
 * KENAPA DISIMPAN, dan ini bukan optimasi. `POST /auth/login` dibatasi
 * 10 percobaan per 5 menit per (IP + email) — penjaga tebak-password yang
 * memang harus ada. Tiap spec memakai dua login untuk akun yang sama (satu
 * lewat API untuk menyiapkan absen, satu lewat layar), jadi tanpa penyimpanan
 * ini jalan ketiga berturut-turut MENTOK kuota dan seluruh suite memerah
 * karena alasan yang sama sekali bukan kode.
 *
 * Terukur saat berkas ini ditulis: jalan 1 lolos 5/5, jalan 2 lolos 4/5,
 * jalan 3 lolos 3/5 — makin lama makin merah tanpa satu baris pun berubah.
 */
async function sesiApi(request: APIRequestContext, email: string, pass: string) {
  const tersimpan = sesiTersimpan.get(email);
  if (tersimpan) return tersimpan;
  const masuk = await request.post(`${BASE}/api/auth/login`, { data: { email, password: pass } });
  if (masuk.status() === 429) {
    throw new Error(
      `KUOTA LOGIN HABIS untuk ${email} — /auth/login dibatasi 10 per 5 menit per (IP+email). ` +
        "INI BUKAN BUG KODE: tunggu beberapa menit, atau jalankan suite ini terhadap server yang baru dinyalakan.",
    );
  }
  expect(masuk.ok(), `login API (status ${masuk.status()})`).toBeTruthy();
  // Badan login SUDAH berbentuk `AuthState` yang disimpan web di
  // `localStorage["kakarut.auth"]` — tak perlu disusun ulang dari /profil.
  const sesi = (await masuk.json()) as { token: string; user: unknown };
  sesiTersimpan.set(email, sesi);
  return sesi;
}

/**
 * Absen masuk lewat API — syarat `POST /shift/buka` (400 "Absen masuk dulu
 * sebelum buka kasir" tanpa ini).
 *
 * Lewat API, bukan lewat layar, karena layar absen menuntut FOTO SWAFOTO dan
 * berada di dalam radius titik cabang — dua hal yang tak bisa dipalsukan
 * browser tanpa menumpulkan penjaganya. Yang diuji spec-spec ini alur JUALAN;
 * absen punya asersinya sendiri di verify-api.
 */
const sesiTersimpan = new Map<string, { token: string; user: unknown }>();

export async function absenMasuk(request: APIRequestContext, email: string, pass: string) {
  const { token } = await sesiApi(request, email, pass);
  const absen = await request.post(`${BASE}/api/absensi/saya`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { foto_url: "https://example.com/e2e-absen.jpg" },
  });
  // 201 = baru absen, 409 = sudah absen hari ini. Keduanya memenuhi syarat.
  expect([201, 409], `absen masuk (status ${absen.status()})`).toContain(absen.status());
  return token;
}

/**
 * Kosongkan meja uji supaya jalan KEDUA tidak gagal oleh sisa jalan pertama.
 *
 * Sesudah dibayar, meja dine-in tetap `isi` dengan `lunas_masih_duduk: true` —
 * tamunya sudah bayar tapi belum beranjak. Itu perilaku POS yang benar, bukan
 * kebocoran: mejanya baru bebas setelah dibereskan. Tanpa langkah ini, uji
 * hanya lulus di basis data yang baru di-seed, dan merahnya di jalan kedua tak
 * mengatakan apa pun tentang kodenya.
 */
export async function kosongkanMeja(request: APIRequestContext, token: string, nama: string) {
  const st = await request.get(`${BASE}/api/meja/status`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const baris = ((await st.json()) as { meja_id: string; nama: string; status: string }[]).find(
    (m) => m.nama === nama,
  );
  if (!baris || baris.status === "kosong") return;
  await request.post(`${BASE}/api/meja/${baris.meja_id}/kosongkan`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { paksa: true },
  });
}

/**
 * Masuk dengan MENANAM SESI, bukan lewat layar login.
 *
 * `POST /auth/login` dibatasi 10 per 5 menit per (IP + email). Spec yang tidak
 * sedang menguji layar login tak perlu memakai jatah itu: sesi web disimpan di
 * `localStorage["kakarut.auth"]` (lihat `AUTH_STORAGE_KEY` di lib/api.ts), dan
 * tokennya sudah ada di tangan dari setup API yang tersimpan.
 *
 * `pos.spec.ts` sengaja TETAP memakai layar login — di sanalah login memang
 * bagian dari yang diuji. Yang dihemat hanya spec yang menumpang lewat.
 */
export async function masukLewatSesi(
  page: Page,
  request: APIRequestContext,
  email: string,
  pass: string,
) {
  /*
   * SESINYA DIAMBIL APA ADANYA DARI BALASAN LOGIN, bukan disusun ulang dari
   * `/profil` — dan `sesiApi` di atas sudah menuliskan alasannya:
   * *"Badan login SUDAH berbentuk `AuthState` … tak perlu disusun ulang dari
   * /profil."* Versi pertama fungsi ini menyusunnya ulang, dan kedua bentuk
   * itu TIDAK sama:
   *
   *   login  → { sub, email, nama, role, company_id, branch_id, is_super_admin }
   *   profil → { email, nama, role, cabang, employee_code }
   *
   * Sesi tanpa `company_id`/`branch_id`/`sub` cukup untuk halaman kasir —
   * yang kebetulan satu-satunya yang dikunjungi spec lama — dan DIAM-DIAM
   * gagal untuk halaman bergerbang peran: `/pengaturan/meja` memantulkan
   * pengunjungnya ke `/dashboard`, jadi premis "layarnya terbuka" runtuh
   * tanpa satu galat pun. Terukur saat spec mutasi ditulis: `getByText(nama)`
   * tak pernah menemukan apa pun, dan yang salah bukan pemilihnya melainkan
   * halaman yang tak pernah terbuka.
   */
  const sesi = await sesiApi(request, email, pass);
  await page.addInitScript(
    ([kunci, isi]) => window.localStorage.setItem(kunci as string, isi as string),
    ["kakarut.auth", JSON.stringify(sesi)] as const,
  );
  await page.goto("/");
}

/** Buka shift bila memang belum terbuka (shift adalah keadaan yang bertahan). */
export async function pastikanShiftTerbuka(page: Page) {
  const belumDibuka = page.getByRole("heading", { name: "Kasir Belum Dibuka" });
  if (await tampak(belumDibuka)) {
    await page.getByPlaceholder("mis. 200000").fill("200000");
    await page.getByRole("button", { name: /Buka Kasir/ }).click();
  }
  await expect(belumDibuka).toHaveCount(0);
}

/** Pilih meja bernama `nama` (modal muncul sendiri bila belum ada meja terpilih). */
export async function pilihMeja(page: Page, nama: string) {
  const modal = page.getByRole("heading", { name: "Pilih Meja" });
  if (!(await tampak(modal))) {
    await page.getByRole("button", { name: /Pilih meja/ }).first().click();
  }
  await expect(modal).toBeVisible();
  await page.getByPlaceholder(/Cari meja/).fill(nama.replace(/\D+/g, ""));
  await page.getByRole("button", { name: new RegExp(nama) }).click();
  // DITUNGGU sampai modalnya benar-benar tutup: selama overlay masih terpasang
  // ia mencegat klik berikutnya, dan yang terlihat cuma "tombol X tak ditemukan"
  // di langkah setelahnya — jauh dari sebabnya.
  await expect(modal).toHaveCount(0);
}

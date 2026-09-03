import { expect, test, type APIRequestContext } from "@playwright/test";
import { BASE, login } from "./util";

/**
 * LAYAR MASUK MENGATAKAN KENAPA IA MENOLAK — dilihat dari browser.
 *
 * Sampai 2026-09-03 keempat penolakan `POST /login` dijawab satu kalimat yang
 * sama, "Email atau password salah". Pemilik repo meminta alasannya
 * disebutkan; biayanya (enumerasi akun terbuka, penahannya tinggal `batasLogin`
 * 10 per 5 menit per IP+email) disampaikan lebih dulu dan ia memilih tetap.
 * Catatan lengkapnya di `POST /login` dan di `PESAN_LOGIN` (packages/shared).
 *
 * Yang diukur di sini justru bagian yang TAK terlihat dari HTTP: apakah
 * alasannya benar-benar sampai ke layar, dan apakah alasan yang bisa
 * diselesaikan orangnya sendiri membawa jalan keluarnya. "Email tidak
 * terdaftar" adalah satu-satunya dari keempatnya yang begitu — dan pembacanya
 * yang paling sering adalah karyawan yang SUDAH diundang: `POST
 * /karyawan/undang` cuma menulis baris `invitations`, akunnya baru lahir saat
 * ia mendaftar sendiri. Tanpa tautan di sebelah kalimatnya, ia menyimpulkan
 * undangannya gagal dan menunggu orang lain memperbaikinya.
 *
 * Email unik per jalan: kedua ember batas laju berkunci email, jadi alamat
 * segar = kuota yang selalu penuh (pelajaran yang sudah dibayar
 * `lupa-password.spec.ts`).
 */
const PASS = "BenarSekali123!";

function emailUnik(tanda: string) {
  return `masuk-${tanda}-${Date.now()}@contoh.id`;
}

async function daftarSaja(request: APIRequestContext, email: string) {
  // Tak perlu diverifikasi: cek verifikasi berjalan SESUDAH password cocok,
  // jadi jalur "password salah" tetap jalur yang sama persis.
  const r = await request.post(`${BASE}/api/auth/register`, {
    data: { nama: "Uji Alasan Masuk", email, password: PASS },
  });
  expect(r.ok(), `register (${r.status()})`).toBeTruthy();
}

test.describe("alasan penolakan masuk sampai ke layar", () => {
  test("email tak terdaftar: kalimatnya disebut, DAN tautan daftarnya membawa emailnya", async ({
    page,
  }) => {
    const email = emailUnik("asing");
    await login(page, email, PASS);

    await expect(page.getByText(/Email tidak terdaftar/)).toBeVisible();
    // Masih di layar masuk — alasan yang disebutkan tak boleh jadi alasan
    // untuk melempar orangnya ke tempat lain tanpa ia meminta.
    await expect(page).toHaveURL(/\/login$/);

    const tautan = page.getByRole("link", { name: /Daftar dengan email ini/ });
    await expect(tautan).toBeVisible();
    await tautan.click();

    await expect(page).toHaveURL(/\/daftar\?email=/);
    // Tautan yang berjanji "email ini" lalu membuka formulir kosong berbohong,
    // dan orangnya mengetik ulang alamat yang barusan ditolak — persis
    // kesempatan kedua untuk salah ketik yang membuatnya sampai ke sini.
    await expect(page.getByLabel("Email")).toHaveValue(email);
  });

  test("password salah: kalimatnya menyebut password, dan TIDAK menawarkan daftar", async ({
    page,
    request,
  }) => {
    const email = emailUnik("salah");
    await daftarSaja(request, email);

    await login(page, email, "SalahSekali123!");
    await expect(page.getByText(/Password salah/)).toBeVisible();
    // Jalan keluar yang salah lebih buruk daripada tak ada: akunnya JELAS ada,
    // dan menyuruhnya mendaftar ulang akan membuangnya ke jalan buntu.
    await expect(page.getByRole("link", { name: /Daftar dengan email ini/ })).toHaveCount(0);
    await expect(page.getByText(/Email tidak terdaftar/)).toHaveCount(0);

    // Password yang BENAR pada akun yang sama melewati pemeriksaan itu — bukti
    // bahwa kalimat di atas memang soal password, bukan soal akunnya. (Akun
    // ini belum terverifikasi, jadi ia berhenti di kalimat berikutnya — dan
    // itu justru menunjukkan urutan pemeriksaannya utuh.)
    await login(page, email, PASS);
    await expect(page.getByText(/Password salah/)).toHaveCount(0);
    await expect(page.getByText(/belum diverifikasi/)).toBeVisible();
  });
});

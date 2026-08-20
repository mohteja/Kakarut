import { HTTPException } from "hono/http-exception";

/**
 * Pengenal galat Postgres yang dipakai bersama modul-modul.
 *
 * Dulu tinggal di dalam `kebersihan/routes.ts` sebagai fungsi lokal, jadi
 * modul lain yang butuh pengaman yang sama tak punya apa pun untuk dipakai —
 * dan yang terjadi bukan mereka menyalinnya, melainkan mereka tidak
 * memasangnya sama sekali.
 */

/**
 * Benarkah galat ini pelanggaran indeks/constraint UNIK (SQLSTATE 23505)?
 *
 * Drizzle membungkus galat driver, jadi kodenya bisa berada di `err.code`
 * maupun `err.cause.code` — keduanya diperiksa.
 *
 * Dipakai untuk pola **sisipkan lalu tangkap**: saat ada indeks unik yang
 * menjadi sumber kebenaran, memeriksa lebih dulu dengan SELECT tidak pernah
 * cukup — selalu ada jeda antara memeriksa dan menyisipkan. Yang menutup jeda
 * itu indeksnya; tugas kode adalah menerjemahkan penolakannya jadi hasil yang
 * bisa dibaca, bukan 500.
 */
export function bentrokUnik(err: unknown): boolean {
  const kode =
    (err as { cause?: { code?: string }; code?: string })?.cause?.code ??
    (err as { code?: string })?.code;
  return kode === "23505";
}

/**
 * Bentrok unik pada indeks TERTENTU — dikenali dari nama constraint-nya.
 *
 * KENAPA PERLU YANG SPESIFIK, padahal `bentrokUnik` sudah ada.
 *
 * Satu penulisan sering berdiri di belakang BEBERAPA indeks unik sekaligus,
 * dan masing-masing berarti hal yang berbeda bagi pemanggilnya. Pembuatan
 * karyawan menabrak `users_email_unique` ("email itu sudah dipakai orang lain",
 * 409 dan berhenti) maupun `memberships_company_kode_uq` ("kode karyawan acak
 * yang barusan dipilih kebetulan sudah ada", coba lagi). Menerjemahkan
 * keduanya sebagai satu hal membuat retry kode karyawan berubah jadi penolakan
 * yang salah — atau sebaliknya, email kembar terus diulang tiga kali sebelum
 * gagal.
 *
 * Nama constraint dicocokkan dengan `includes`, bukan sama-persis: Postgres
 * memulangkannya apa adanya, tetapi jalur galat yang dibungkus driver sesekali
 * menyisipkan awalan skema.
 */
export function bentrokUnikPada(err: unknown, ...namaConstraint: string[]): boolean {
  if (!bentrokUnik(err)) return false;
  const e = err as { constraint?: string; cause?: { constraint?: string } };
  const nama = e?.constraint ?? e?.cause?.constraint ?? "";
  return namaConstraint.some((n) => nama.includes(n));
}

/**
 * Benarkah galat ini "sintaks nilai tak sah" (SQLSTATE 22P02)?
 *
 * Yang melahirkannya di sini hampir selalu satu hal: id dari PATH/QUERY masuk
 * langsung ke pembanding kolom `uuid`. `/customer/abc` membuat Postgres
 * melempar `invalid input syntax for type uuid`, dan tanpa terjemahan itu
 * keluar sebagai **500** — padahal murni salah input klien.
 *
 * Ada 142 pembacaan `c.req.param()` di modul-modul dan hanya lima berkas yang
 * memasang saringan uuid sendiri. Menyalin saringan ke 137 tempat sisanya
 * bukan perbaikan, itu daftar tugas yang tak akan selesai — jadi
 * terjemahannya dipasang di SATU pintu keluar galat (`app.onError`).
 *
 * Sengaja TIDAK membuatnya senyap: 400-nya tetap dicatat ke `error_logs`.
 * 22P02 bisa juga lahir dari literal cacat yang disusun kode sendiri, dan itu
 * cacat server sungguhan — yang berubah cuma labelnya, bukan keberadaannya di
 * panel.
 */
export function nilaiTakSah(err: unknown): boolean {
  const kode =
    (err as { cause?: { code?: string }; code?: string })?.cause?.code ??
    (err as { code?: string })?.code;
  return kode === "22P02";
}

/**
 * Jalankan tulisan yang bisa menabrak indeks unik, lalu terjemahkan
 * penolakannya jadi 409 berpesan.
 *
 * Kenapa perlu: jalur MEMBUAT di repo ini rata-rata sudah menjaga nama kembar
 * (pra-cek atau `onConflictDoNothing` + 409), tapi jalur MENGGANTI NAMA tidak —
 * sampai sekarang tak ada satu pun yang menjaganya. Padahal indeksnya sama, dan
 * mengetik nama yang sudah dipakai adalah hal paling biasa yang dilakukan orang.
 * Tanpa ini hasilnya 23505 mentah alias 500 — dan di web, 500 yang bukan galat
 * aplikasi memicu overlay global "server sedang diperbarui": aplikasinya
 * terlihat tumbang gara-gara salah ketik nama meja.
 *
 * UPDATE tak punya `ON CONFLICT`, jadi sisipkan-lalu-tangkap adalah satu-satunya
 * cara — dan itu justru yang benar: indeksnya yang jadi sumber kebenaran, bukan
 * pra-cek yang selalu punya jeda sebelum tulisannya.
 */
export async function tanpaBentrok<T>(
  pesan: string,
  jalankan: () => Promise<T>,
  /**
   * Batasi terjemahannya ke indeks yang DISEBUT. Kosong = indeks unik mana pun,
   * perilaku asli helper ini.
   *
   * Diperlukan begitu satu penulisan berdiri di belakang lebih dari satu indeks:
   * `invitations` misalnya dijaga `..._email_pending_uq` (yang memang berarti
   * "sudah diundang") DAN `invitations_token_unique` (token acak yang kebetulan
   * kembar — hal lain sama sekali, dan menyebutnya "sudah diundang" membuat
   * pengundang berhenti padahal cukup mencoba lagi).
   */
  ...hanyaConstraint: string[]
): Promise<T> {
  try {
    return await jalankan();
  } catch (err) {
    const cocok =
      hanyaConstraint.length === 0
        ? bentrokUnik(err)
        : bentrokUnikPada(err, ...hanyaConstraint);
    if (cocok) throw new HTTPException(409, { message: pesan });
    throw err;
  }
}

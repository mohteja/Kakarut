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
): Promise<T> {
  try {
    return await jalankan();
  } catch (err) {
    if (bentrokUnik(err)) throw new HTTPException(409, { message: pesan });
    throw err;
  }
}

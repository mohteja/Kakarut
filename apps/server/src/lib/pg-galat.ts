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

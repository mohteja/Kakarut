import path from "node:path";

/**
 * Susun jalur berkas di dalam sebuah direktori dasar, dan TOLAK yang keluar.
 *
 * Kedua penyimpanan lokal (unggahan & cadangan) sudah punya penjaga traversal,
 * dan keduanya memakai bentuk yang sama:
 *
 *     const p = path.join(baseDir, key);
 *     if (!p.startsWith(baseDir)) throw …
 *
 * Bentuk itu meleset di satu titik yang tak kelihatan: `startsWith` menyamakan
 * TEKS, bukan batas direktori. Dengan `baseDir = "/data/uploads"`, jalur
 * `/data/uploads-lama/x` lolos — ia memang berawalan sama, tapi ia direktori
 * SEBELAH, bukan isi. Perbandingan yang benar menuntut pemisah di belakang
 * dasarnya.
 *
 * `path.resolve` dipakai menggantikan `path.join` karena keduanya berbeda pada
 * kunci ABSOLUT: `join("/data", "/etc/passwd")` diam-diam menulis ulang jadi
 * `/data/etc/passwd`, sedangkan `resolve` memulangkan `/etc/passwd` apa adanya
 * — sehingga penjaga di bawah bisa MENOLAKNYA. Ditolak lebih baik daripada
 * ditulis ulang diam-diam ke tempat yang tak diminta siapa pun.
 *
 * CATATAN JUJUR: hari ini tak ada masukan pengguna yang sampai ke sini. Kunci
 * unggahan disusun server (`companies/<company_id>/<tujuan>/<uuid>.<ext>`) dan
 * kunci cadangan lahir dari stempel waktu. Ini menutup perangkap yang menunggu
 * — bukan lubang yang sedang menganga.
 */
export function jalurDalam(baseDir: string, key: string): string {
  const dasar = path.resolve(baseDir);
  const jalur = path.resolve(dasar, key);
  if (jalur !== dasar && !jalur.startsWith(dasar + path.sep)) {
    throw new Error("Kunci berkas tidak valid");
  }
  return jalur;
}

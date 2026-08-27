import { unlink } from "node:fs/promises";
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

/**
 * Hapus satu berkas lokal, IDEMPOTEN — dan hanya itu.
 *
 * Kontrak kedua penyimpanan menuliskan batasnya sendiri (`storage.ts`):
 * *"Hapus satu berkas; berkas yang sudah tak ada bukan galat."* Kedua driver
 * lokal dulu menuliskannya sebagai `unlink(...).catch(() => {})` — yang menelan
 * JAUH lebih banyak daripada yang dijanjikan: `EPERM`, `EISDIR`, `EACCES`,
 * `EROFS`. Saudara kandungnya di R2 tidak: `DeleteObject` memang idempoten
 * untuk kunci yang hilang, dan melempar untuk kegagalan sungguhan. Satu
 * antarmuka, dua kejujuran yang berlawanan — dan yang lokal itulah yang dipakai
 * pemasangan tanpa R2.
 *
 * Akibatnya bukan teoretis, dan ketiganya terukur lewat HTTP (2026-08-26):
 * `DELETE /admin/sistem/backup/:id` membalas 200 `{ok:true}` sementara
 * berkasnya masih di disk; retensi melapor `dibuang: 1` untuk objek yang tetap
 * ada; sapuan yatim melapor `dihapus: 3` padahal hanya 2 yang benar terhapus.
 * Di ketiganya baris yang MENAMAI objek itu ikut terhapus — jadi yang tersisa
 * adalah objek berbayar yang tak tercatat di mana pun lagi.
 *
 * Yang boleh diam karena itu HANYA `ENOENT`. Sisanya dilempar, dan pemanggilnya
 * yang memutuskan (menahan barisnya, atau menghitungnya sebagai gagal).
 */
export async function hapusBerkasLokal(baseDir: string, key: string): Promise<void> {
  try {
    await unlink(jalurDalam(baseDir, key));
  } catch (e) {
    // "Sudah tidak ada" adalah hasil yang DIMINTA, bukan kegagalan.
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return;
    throw e;
  }
}

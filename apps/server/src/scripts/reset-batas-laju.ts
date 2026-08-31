/**
 * KOSONGKAN EMBER BATAS LAJU — alat uji, bukan jalan pintas produksi.
 *
 * `verify-api.sh` dan suite Playwright berjalan BERURUTAN di satu server dan
 * satu alamat IP, memakai akun seed yang sama. `POST /auth/login` dibatasi 10
 * per (IP + email) tiap 5 menit — dan verify-api sendiri menyebut rute itu 19
 * kali, sebagian justru untuk MENGUJI batasnya. Jatahnya karena itu sudah
 * habis sebelum spec pertama Playwright menyala, dan seluruh suite mati dengan
 * "KUOTA LOGIN HABIS" — kegagalan yang tak menyatakan apa pun tentang produk.
 *
 * Yang dikosongkan hanya TABEL EMBERNYA; penjaganya sendiri tak disentuh, dan
 * verify-api tetap menguji batas itu di dalam jendelanya sendiri.
 *
 * Dipakai di antara kedua fase, di CI maupun lokal, lewat satu perintah yang
 * sama — supaya prosedur lokal tak lagi lebih longgar daripada CI. Perbedaan
 * itu yang membuat rilis pertama putaran ini merah: lokal menghapus embernya,
 * CI tidak, dan suite yang hijau di sini merah di sana.
 */
import { db } from "../db/client";
import { rateLimits } from "../db/schema";

const dihapus = await db.delete(rateLimits).returning({ bucket: rateLimits.bucket });
console.log(`Ember batas laju dikosongkan: ${dihapus.length} baris.`);
process.exit(0);

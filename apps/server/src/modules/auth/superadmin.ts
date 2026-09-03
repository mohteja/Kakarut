import bcrypt from "bcryptjs";
import { and, eq, isNull } from "drizzle-orm";
import { env } from "../../config/env";
import type { Db, Tx } from "../../db/client";
import { kunciAntrean } from "../../lib/kunci";
import { users } from "../../db/schema";
import { PESAN_LOGIN } from "@kakarut/shared";

/**
 * Pastikan ADA satu super admin platform yang aktif. Dipanggil saat boot —
 * AMAN & idempoten: hanya MEMBUAT bila belum ada super admin aktif, TIDAK
 * pernah menghapus/menimpa data apa pun (beda dengan `seed` yang menghapus
 * semua). Berguna untuk deployment yang belum pernah di-seed: akun super admin
 * dibuat otomatis dari SEED_SUPERADMIN_EMAIL/PASSWORD.
 *
 * Mengembalikan true bila membuat akun baru, false bila sudah ada (no-op).
 *
 * DUA BOOT YANG BERTINDIH ADALAH KEADAAN NORMAL DI SINI, bukan kecelakaan —
 * `lib/kunci.ts` sudah menuliskannya: penyebaran repo ini "memutar instance
 * baru sebelum yang lama berhenti". Maka periksa-lalu-tulis di bawah dipegang
 * satu kunci antrean, dan alasannya bukan kerapian.
 *
 * Yang menahannya SELAMA INI cuma `users_email_unique`, dan itu indeks atas
 * aturan yang SALAH: ia menjaga "satu user per email", sedangkan aturan di
 * sini "paling banyak satu super admin aktif". Keduanya berimpit hanya selama
 * seluruh instance membaca `SEED_SUPERADMIN_EMAIL` yang sama.
 *
 * Akibatnya tidak merusak data — jumlah barisnya memang tetap satu — melainkan
 * merusak apa yang DIKATAKAN log boot. TERUKUR atas Postgres sungguhan, 8
 * ronde dua panggilan serentak dari keadaan nol super admin:
 *
 *   3/8  bersih
 *   4/8  yang kalah ditolak `23505 users_email_unique`, dan `index.ts`
 *        mencetaknya sebagai "Gagal memastikan super admin: Failed query:
 *        insert into users …" — pembacanya tak bisa tahu akunnya ada atau tidak
 *   1/8  yang kalah membaca `emailDipakai` SESUDAH yang menang commit, lalu
 *        mencetak kalimat yang KELIRU: "email … sudah dipakai akun lain —
 *        lewati pembuatan otomatis". Email itu dipakai super admin yang baru
 *        saja lahir; tak ada akun lain
 *   0/8  jumlah barisnya salah
 *
 * Lima dari delapan boot karena itu menutup dengan galat atau dengan kalimat
 * yang salah, di satu-satunya tempat pemilik sistem bisa membacanya.
 *
 * Tetangganya `backfillEmployeeCode` sudah memegang kunci sejenis sejak awal,
 * dan berjalan di boot yang SAMA.
 */
export async function pastikanSuperAdmin(dbx: Db | Tx): Promise<boolean> {
  return dbx.transaction(async (tx) => {
    await kunciAntrean(tx, "super-admin");
    const [ada] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.isSuperAdmin, true), isNull(users.deletedAt)))
      .limit(1);
    if (ada) {
      await peringatkanEnvMenyimpang(tx);
      return false;
    }

    const email = env.SEED_SUPERADMIN_EMAIL.trim().toLowerCase();
    // Jangan menimpa akun lain yang kebetulan memakai email itu.
    const [emailDipakai] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (emailDipakai) {
      console.warn(
        `Super admin belum ada, tapi email ${email} sudah dipakai akun lain — lewati pembuatan otomatis.`,
      );
      return false;
    }

    await tx.insert(users).values({
      email,
      passwordHash: bcrypt.hashSync(env.SEED_SUPERADMIN_PASSWORD, 10),
      nama: "Super Admin",
      isSuperAdmin: true,
      emailVerifiedAt: new Date(),
    });
    return true;
  });
}

/**
 * ENV YANG SUDAH TAK BERLAKU HARUS MENGATAKANNYA — sebab kalau tidak, ia
 * berbohong dengan cara yang paling mahal: diam.
 *
 * `SEED_SUPERADMIN_PASSWORD` hanya dibaca SEKALI, saat akunnya dibuat. Sesudah
 * itu passwordnya hidup sebagai hash di basis data, dan mengubah nilai env
 * tidak mengubah apa pun. Yang terlihat pemilik sistem: env-nya jelas berisi
 * password yang benar, tapi masuk selalu ditolak "Password salah" — kalimat
 * yang benar dan tetap tak menolong: yang salah bukan yang ia ketik, melainkan
 * anggapannya bahwa env itu masih dibaca.
 *
 * Terukur: akun super admin dengan password bawaan → 200; nilai env apa pun
 * yang lain → 401, dengan akun aktif, terverifikasi, `token_version` 0. Tak
 * ada satu baris log pun yang menyebutkan penyimpangannya.
 *
 * Maka penyimpangan itu dikatakan di boot, sekali, tanpa pernah mencetak
 * password apa pun. Ia TIDAK menimpa akun yang ada — menyelaraskan diam-diam
 * berarti siapa pun yang bisa menyunting env bisa merebut akun super admin
 * dengan me-restart proses, dan itu jauh lebih buruk daripada bingung.
 */
async function peringatkanEnvMenyimpang(dbx: Db | Tx): Promise<void> {
  const email = env.SEED_SUPERADMIN_EMAIL.trim().toLowerCase();
  const [sa] = await dbx
    .select({ email: users.email, passwordHash: users.passwordHash })
    .from(users)
    .where(and(eq(users.isSuperAdmin, true), isNull(users.deletedAt)))
    .limit(1);
  if (!sa) return;
  if (sa.email !== email) {
    console.warn(
      `Super admin aktif beremail ${sa.email}, sedangkan SEED_SUPERADMIN_EMAIL berisi ` +
        `${email}. Nilai env itu hanya dipakai saat akun PERTAMA dibuat, jadi ia tak ` +
        "berpengaruh apa pun sekarang.",
    );
    return;
  }
  if (!bcrypt.compareSync(env.SEED_SUPERADMIN_PASSWORD, sa.passwordHash)) {
    console.warn(
      `SEED_SUPERADMIN_PASSWORD TIDAK cocok dengan password akun ${sa.email} yang ada. ` +
        "Nilai env hanya dipakai saat akun pertama dibuat — mengubahnya tidak mengubah " +
        `password. Masuk akan ditolak '${PESAN_LOGIN.passwordSalah}'. Untuk menggantinya, ` +
        "pakai alur lupa password, atau setel ulang password_hash-nya langsung " +
        "(dan naikkan token_version supaya sesi lama ikut mati).",
    );
  }
}

import bcrypt from "bcryptjs";
import { and, eq, isNull } from "drizzle-orm";
import { env } from "../../config/env";
import type { Db, Tx } from "../../db/client";
import { users } from "../../db/schema";

/**
 * Pastikan ADA satu super admin platform yang aktif. Dipanggil saat boot —
 * AMAN & idempoten: hanya MEMBUAT bila belum ada super admin aktif, TIDAK
 * pernah menghapus/menimpa data apa pun (beda dengan `seed` yang menghapus
 * semua). Berguna untuk deployment yang belum pernah di-seed: akun super admin
 * dibuat otomatis dari SEED_SUPERADMIN_EMAIL/PASSWORD.
 *
 * Mengembalikan true bila membuat akun baru, false bila sudah ada (no-op).
 */
export async function pastikanSuperAdmin(dbx: Db | Tx): Promise<boolean> {
  const [ada] = await dbx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.isSuperAdmin, true), isNull(users.deletedAt)))
    .limit(1);
  if (ada) {
    await peringatkanEnvMenyimpang(dbx);
    return false;
  }

  const email = env.SEED_SUPERADMIN_EMAIL.trim().toLowerCase();
  // Jangan menimpa akun lain yang kebetulan memakai email itu.
  const [emailDipakai] = await dbx.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (emailDipakai) {
    console.warn(
      `Super admin belum ada, tapi email ${email} sudah dipakai akun lain — lewati pembuatan otomatis.`,
    );
    return false;
  }

  await dbx.insert(users).values({
    email,
    passwordHash: bcrypt.hashSync(env.SEED_SUPERADMIN_PASSWORD, 10),
    nama: "Super Admin",
    isSuperAdmin: true,
    emailVerifiedAt: new Date(),
  });
  return true;
}

/**
 * ENV YANG SUDAH TAK BERLAKU HARUS MENGATAKANNYA — sebab kalau tidak, ia
 * berbohong dengan cara yang paling mahal: diam.
 *
 * `SEED_SUPERADMIN_PASSWORD` hanya dibaca SEKALI, saat akunnya dibuat. Sesudah
 * itu passwordnya hidup sebagai hash di basis data, dan mengubah nilai env
 * tidak mengubah apa pun. Yang terlihat pemilik sistem: env-nya jelas berisi
 * password yang benar, tapi masuk selalu ditolak "Email atau password salah" —
 * kalimat yang SENGAJA netral (anti-enumerasi), jadi ia tak bisa menolong.
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
        "password. Masuk akan ditolak 'Email atau password salah'. Untuk menggantinya, " +
        "pakai alur lupa password, atau setel ulang password_hash-nya langsung " +
        "(dan naikkan token_version supaya sesi lama ikut mati).",
    );
  }
}

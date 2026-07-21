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
  if (ada) return false;

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
  });
  return true;
}

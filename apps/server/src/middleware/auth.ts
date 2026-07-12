import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import jwt from "jsonwebtoken";
import type { AuthUser, UserRole } from "@kakarut/shared";
import { env } from "../config/env";
import { db } from "../db/client";
import { branches, users } from "../db/schema";

export type AppEnv = { Variables: { auth: AuthUser } };

/**
 * Verifikasi password login akun (dipakai konfirmasi aksi merusak: hapus/edit
 * transaksi). Lempar 401 bila akun tak ada/nonaktif atau password salah.
 */
export async function verifikasiPassword(userId: string, password: string): Promise<void> {
  if (!password) throw new HTTPException(401, { message: "Password wajib diisi" });
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user || !user.isActive || !bcrypt.compareSync(password, user.passwordHash)) {
    throw new HTTPException(401, { message: "Password salah" });
  }
}

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) {
    throw new HTTPException(401, { message: "Perlu login (token tidak ada)" });
  }
  try {
    const payload = jwt.verify(header.slice(7), env.JWT_SECRET) as AuthUser;
    c.set("auth", payload);
  } catch {
    throw new HTTPException(401, { message: "Token tidak valid atau kedaluwarsa" });
  }
  await next();
};

/** Rute internal perusahaan — butuh keanggotaan (bukan super admin tanpa tenant). */
export const requireCompany: MiddlewareHandler<AppEnv> = async (c, next) => {
  const auth = c.get("auth");
  if (!auth.company_id) {
    throw new HTTPException(403, { message: "Akun ini tidak terhubung ke perusahaan" });
  }
  await next();
};

export const requireRole = (...roles: UserRole[]): MiddlewareHandler<AppEnv> => {
  return async (c, next) => {
    const auth = c.get("auth");
    if (!auth.role || !roles.includes(auth.role)) {
      throw new HTTPException(403, { message: "Peran Anda tidak diizinkan mengakses ini" });
    }
    await next();
  };
};

export const requireSuperAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get("auth").is_super_admin) {
    throw new HTTPException(403, { message: "Hanya super admin platform" });
  }
  await next();
};

/** Pastikan cabang milik perusahaan; lempar 404 bila bukan. */
export async function pastikanCabang(branchId: string, companyId: string): Promise<string> {
  const [b] = await db
    .select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.id, branchId), eq(branches.companyId, companyId)));
  if (!b) throw new HTTPException(404, { message: "Cabang tidak ditemukan" });
  return b.id;
}

/**
 * Peran yang TERIKAT ke satu cabang (kasir & tim) — selalu terkunci ke
 * cabangnya sendiri; owner/admin bebas lintas cabang.
 */
export function terikatCabang(role: string | null): boolean {
  return role === "cashier" || role === "tim";
}

/**
 * Cabang aktif untuk request ini: kasir/tim selalu terkunci ke cabangnya;
 * owner/admin boleh memilih via ?branch_id= (divalidasi milik perusahaan),
 * default cabang pertama.
 */
export async function resolveBranchId(c: Context<AppEnv>): Promise<string> {
  const auth = c.get("auth");
  if (terikatCabang(auth.role)) {
    if (!auth.branch_id) throw new HTTPException(403, { message: "Akun tanpa cabang" });
    return auth.branch_id;
  }
  const q = c.req.query("branch_id");
  if (q) return pastikanCabang(q, auth.company_id!);
  const [first] = await db
    .select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.companyId, auth.company_id!), eq(branches.isActive, true)))
    .orderBy(branches.createdAt)
    .limit(1);
  if (!first) throw new HTTPException(404, { message: "Perusahaan belum punya cabang" });
  return first.id;
}

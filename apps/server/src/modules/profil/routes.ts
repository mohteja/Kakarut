import bcrypt from "bcryptjs";
import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../../db/client";
import { branches, memberships, users } from "../../db/schema";
import { verifikasiPassword, type AppEnv } from "../../middleware/auth";

const GantiPasswordBody = z.object({
  password_lama: z.string(),
  password_baru: z.string().min(8, "password baru minimal 8 karakter"),
});

/**
 * Profil akun SENDIRI — dapat diakses semua peran (termasuk kasir): identitas,
 * kode karyawan + QR untuk absen, dan ganti password (wajib password lama).
 */
export const profilRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const auth = c.get("auth");
    // nama/email diambil segar dari DB (JWT bisa basi setelah ganti nama)
    const [user] = await db
      .select({ nama: users.nama, email: users.email })
      .from(users)
      .where(eq(users.id, auth.sub));

    const [m] = auth.company_id
      ? await db
          .select({
            employeeCode: memberships.employeeCode,
            branchId: memberships.branchId,
          })
          .from(memberships)
          .where(
            and(eq(memberships.userId, auth.sub), eq(memberships.companyId, auth.company_id)),
          )
      : [];
    let cabang: string | null = null;
    if (m?.branchId) {
      const [b] = await db
        .select({ nama: branches.nama })
        .from(branches)
        .where(eq(branches.id, m.branchId));
      cabang = b?.nama ?? null;
    }

    return c.json({
      nama: user?.nama ?? auth.nama,
      email: user?.email ?? auth.email,
      role: auth.role,
      cabang,
      employee_code: m?.employeeCode ?? null,
    });
  })
  /** Ganti password sendiri: verifikasi password lama dulu. */
  .post("/password", zValidator("json", GantiPasswordBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    await verifikasiPassword(auth.sub, body.password_lama);
    await db
      .update(users)
      .set({ passwordHash: bcrypt.hashSync(body.password_baru, 10) })
      .where(eq(users.id, auth.sub));
    return c.json({ ok: true });
  });

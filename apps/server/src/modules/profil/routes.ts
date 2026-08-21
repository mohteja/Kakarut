import bcrypt from "bcryptjs";
import { zValidator } from "../../lib/validator";
import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../../db/client";
import { branches, fakturLogs, memberships, users } from "../../db/schema";
import { verifikasiPassword, type AppEnv } from "../../middleware/auth";
import { buatSesi } from "../auth/session";

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
  /** Riwayat kegiatan SENDIRI (log faktur yang dilakukan akun ini). */
  .get("/aktivitas", async (c) => {
    const auth = c.get("auth");
    if (!auth.company_id) return c.json({ rows: [] });
    const rows = await db
      .select({
        id: fakturLogs.id,
        jalur: fakturLogs.jalur,
        aksi: fakturLogs.aksi,
        detail: fakturLogs.detail,
        cabang: branches.nama,
        faktur_id: fakturLogs.fakturId,
        waktu: fakturLogs.waktu,
      })
      .from(fakturLogs)
      .leftJoin(branches, eq(fakturLogs.branchId, branches.id))
      .where(and(eq(fakturLogs.companyId, auth.company_id), eq(fakturLogs.userId, auth.sub)))
      .orderBy(desc(fakturLogs.waktu), desc(fakturLogs.id))
      .limit(50);
    return c.json({ rows });
  })
  /** Ganti password sendiri: verifikasi password lama dulu. */
  .post("/password", zValidator("json", GantiPasswordBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    await verifikasiPassword(auth.sub, body.password_lama);
    // Naikkan token_version → semua token lama (perangkat/tab lain, atau token
    // yang bocor) langsung batal. Kembalikan baris terbaru untuk re-issue sesi.
    const [updated] = await db
      .update(users)
      .set({
        passwordHash: bcrypt.hashSync(body.password_baru, 10),
        tokenVersion: sql`${users.tokenVersion} + 1`,
      })
      .where(eq(users.id, auth.sub))
      .returning();
    // Re-issue sesi untuk TAB INI (token baru berversi terbaru) agar user yang
    // baru mengganti password tidak ikut ter-logout. Pertahankan perusahaan
    // aktif saat ini (penting untuk akun multi-perusahaan).
    const sesi = await buatSesi(updated, auth.company_id ?? undefined);
    return c.json({ ok: true, ...sesi });
  });

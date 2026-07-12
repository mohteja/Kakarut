import { zValidator } from "@hono/zod-validator";
import bcrypt from "bcryptjs";
import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import jwt from "jsonwebtoken";
import { z } from "zod";
import type { AuthUser } from "@kakarut/shared";
import { env } from "../../config/env";
import { db } from "../../db/client";
import { branches, companies, memberships, users } from "../../db/schema";
import { requireAuth, type AppEnv } from "../../middleware/auth";

const LoginSchema = z.object({
  email: z.string().trim().toLowerCase(),
  password: z.string().min(1),
});

export const authRoutes = new Hono<AppEnv>()
  .post("/login", zValidator("json", LoginSchema), async (c) => {
    const { email, password } = c.req.valid("json");
    const [user] = await db.select().from(users).where(eq(users.email, email));
    if (!user || !user.isActive || !bcrypt.compareSync(password, user.passwordHash)) {
      throw new HTTPException(401, { message: "Email atau password salah" });
    }

    let payload: AuthUser = {
      sub: user.id,
      email: user.email,
      nama: user.nama,
      is_super_admin: user.isSuperAdmin,
      company_id: null,
      role: null,
      branch_id: null,
    };
    let company: typeof companies.$inferSelect | null = null;
    let branch: { id: string; nama: string } | null = null;

    if (!user.isSuperAdmin) {
      // membership terarsip = karyawan sudah dikeluarkan → tidak bisa masuk
      const [m] = await db
        .select()
        .from(memberships)
        .innerJoin(companies, eq(memberships.companyId, companies.id))
        .where(
          and(
            eq(memberships.userId, user.id),
            eq(companies.isActive, true),
            isNull(memberships.archivedAt),
          ),
        );
      if (!m) {
        throw new HTTPException(403, {
          message: "Akun tidak terhubung ke perusahaan aktif mana pun",
        });
      }
      company = m.companies;
      payload = {
        ...payload,
        company_id: m.memberships.companyId,
        role: m.memberships.role,
        branch_id: m.memberships.branchId,
      };
      if (m.memberships.branchId) {
        const [b] = await db
          .select({ id: branches.id, nama: branches.nama })
          .from(branches)
          .where(eq(branches.id, m.memberships.branchId));
        branch = b ?? null;
      }
    }

    const token = jwt.sign(payload, env.JWT_SECRET, {
      expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
    });

    return c.json({
      token,
      user: payload,
      company: company
        ? {
            id: company.id,
            nama: company.nama,
            slug: company.slug,
            logo_url: company.logoUrl,
            pb1_enabled: company.pb1Enabled,
            pb1_rate: company.pb1Rate,
            diskon_maks_persen: company.diskonMaksPersen,
            timezone: company.timezone,
          }
        : null,
      branch,
    });
  })
  .get("/me", requireAuth, async (c) => {
    const auth = c.get("auth");
    let company = null;
    if (auth.company_id) {
      const [co] = await db
        .select()
        .from(companies)
        .where(eq(companies.id, auth.company_id));
      if (co) {
        company = {
          id: co.id,
          nama: co.nama,
          slug: co.slug,
          logo_url: co.logoUrl,
          pb1_enabled: co.pb1Enabled,
          pb1_rate: co.pb1Rate,
          diskon_maks_persen: co.diskonMaksPersen,
          timezone: co.timezone,
        };
      }
    }
    return c.json({ user: auth, company });
  });

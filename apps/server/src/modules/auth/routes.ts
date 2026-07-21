import { zValidator } from "@hono/zod-validator";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { db } from "../../db/client";
import { companies, users } from "../../db/schema";
import { requireAuth, type AppEnv } from "../../middleware/auth";
import { autoTerimaUndanganEmail } from "../onboarding/service";
import { buatSesi } from "./session";

const LoginSchema = z.object({
  email: z.string().trim().toLowerCase(),
  password: z.string().min(1),
});

const RegisterSchema = z.object({
  nama: z.string().trim().min(1, "Nama wajib diisi"),
  email: z.string().trim().toLowerCase().email("Email tidak valid"),
  password: z.string().min(8, "Password minimal 8 karakter"),
});

export const authRoutes = new Hono<AppEnv>()
  .post("/login", zValidator("json", LoginSchema), async (c) => {
    const { email, password } = c.req.valid("json");
    const [user] = await db.select().from(users).where(eq(users.email, email));
    if (
      !user ||
      user.deletedAt ||
      !user.isActive ||
      !bcrypt.compareSync(password, user.passwordHash)
    ) {
      throw new HTTPException(401, { message: "Email atau password salah" });
    }
    // User tanpa perusahaan TETAP boleh masuk → diarahkan ke onboarding
    // (buat perusahaan / terima undangan). buatSesi mengembalikan company null.
    return c.json(await buatSesi(user));
  })
  // Daftar akun sendiri (self sign-up). Membuat user TANPA perusahaan; bila ada
  // undangan pending untuk email ini, langsung auto-join (mereka set password
  // sendiri saat daftar). Selesai → langsung login (kembalikan sesi).
  .post("/register", zValidator("json", RegisterSchema), async (c) => {
    const { nama, email, password } = c.req.valid("json");
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (existing) {
      throw new HTTPException(409, { message: `Email ${email} sudah terdaftar` });
    }
    const passwordHash = bcrypt.hashSync(password, 10);
    const { user, preferredCompanyId } = await db.transaction(async (tx) => {
      const [u] = await tx.insert(users).values({ email, passwordHash, nama }).returning();
      const cid = await autoTerimaUndanganEmail(tx, u.id, email);
      return { user: u, preferredCompanyId: cid };
    });
    return c.json(await buatSesi(user, preferredCompanyId ?? undefined), 201);
  })
  .get("/me", requireAuth, async (c) => {
    const auth = c.get("auth");
    let company = null;
    if (auth.company_id) {
      const [co] = await db.select().from(companies).where(eq(companies.id, auth.company_id));
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

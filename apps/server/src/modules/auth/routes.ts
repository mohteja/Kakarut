import { createHash, randomBytes } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import bcrypt from "bcryptjs";
import { and, eq, gt, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { env } from "../../config/env";
import { db } from "../../db/client";
import { companies, passwordResetTokens, users } from "../../db/schema";
import { requireAuth, type AppEnv } from "../../middleware/auth";
import { emailTerkonfigurasi, kirimEmail } from "../mail/service";
import { autoTerimaUndanganEmail } from "../onboarding/service";
import { GUEST } from "../../seed/guest";
import { buatSesi } from "./session";

/** Token reset disimpan sebagai hash (bukan nilai mentah). */
const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

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
  // Masuk sebagai TAMU (guest mode) — akun bersama untuk mencoba aplikasi,
  // tanpa password. Dua peran: owner & kasir, di perusahaan demo (tanpa
  // geofence → absen bebas). Data bersifat sandbox bersama.
  .post(
    "/guest",
    zValidator("json", z.object({ peran: z.enum(["owner", "kasir"]) })),
    async (c) => {
      const { peran } = c.req.valid("json");
      const email = peran === "owner" ? GUEST.ownerEmail : GUEST.kasirEmail;
      const [user] = await db.select().from(users).where(eq(users.email, email));
      if (!user || !user.isActive || user.deletedAt) {
        throw new HTTPException(503, { message: "Akun tamu belum siap — coba lagi sebentar" });
      }
      return c.json(await buatSesi(user));
    },
  )
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
  // Lupa password: selalu balas 200 (jangan bocorkan apakah email terdaftar).
  // Bila akun ada & aktif, buat token reset + kirim tautan via email. Saat email
  // BELUM dikonfigurasi & bukan produksi, kembalikan tautan langsung (bantuan
  // dev/setup — di produksi tak pernah dibocorkan).
  .post(
    "/forgot-password",
    zValidator("json", z.object({ email: z.string().trim().toLowerCase().email() })),
    async (c) => {
      const { email } = c.req.valid("json");
      const [user] = await db.select().from(users).where(eq(users.email, email));
      let devUrl: string | undefined;
      if (user && !user.deletedAt && user.isActive) {
        const raw = randomBytes(32).toString("hex");
        await db.insert(passwordResetTokens).values({
          userId: user.id,
          tokenHash: hashToken(raw),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 jam
        });
        const url = `${env.APP_BASE_URL}/reset-password?token=${raw}`;
        try {
          await kirimEmail({
            to: email,
            subject: "Reset password Terakasir",
            html: `<p>Halo ${user.nama},</p><p>Ada permintaan atur ulang password akun Terakasir Anda. Klik tautan di bawah (berlaku 1 jam):</p><p><a href="${url}">Atur ulang password</a></p><p>Abaikan email ini bila Anda tidak meminta.</p>`,
          });
        } catch {
          /* best-effort: jangan gagalkan permintaan bila email error */
        }
        if (!(await emailTerkonfigurasi()) && process.env.NODE_ENV !== "production") {
          devUrl = url;
        }
      }
      return c.json({ ok: true, ...(devUrl ? { dev_reset_url: devUrl } : {}) });
    },
  )
  // Reset password dengan token dari email.
  .post(
    "/reset-password",
    zValidator(
      "json",
      z.object({
        token: z.string().min(1),
        password: z.string().min(8, "Password minimal 8 karakter"),
      }),
    ),
    async (c) => {
      const { token, password } = c.req.valid("json");
      const [row] = await db
        .select()
        .from(passwordResetTokens)
        .where(
          and(
            eq(passwordResetTokens.tokenHash, hashToken(token)),
            isNull(passwordResetTokens.usedAt),
            gt(passwordResetTokens.expiresAt, new Date()),
          ),
        );
      if (!row) {
        throw new HTTPException(400, { message: "Tautan reset tidak valid atau sudah kedaluwarsa" });
      }
      const [user] = await db.select().from(users).where(eq(users.id, row.userId));
      if (!user || user.deletedAt || !user.isActive) {
        throw new HTTPException(400, { message: "Akun tidak aktif" });
      }
      await db.transaction(async (tx) => {
        await tx
          .update(users)
          .set({ passwordHash: bcrypt.hashSync(password, 10) })
          .where(eq(users.id, user.id));
        await tx
          .update(passwordResetTokens)
          .set({ usedAt: new Date() })
          .where(eq(passwordResetTokens.id, row.id));
      });
      return c.json({ ok: true });
    },
  )
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

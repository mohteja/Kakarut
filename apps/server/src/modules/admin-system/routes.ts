import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { SmtpSettingsDto } from "@kakarut/shared";
import { db } from "../../db/client";
import { smtpSettings } from "../../db/schema";
import { migrationStatus, runMigrations } from "../../db/migrate";
import { getStorage } from "../upload/storage";
import { getSmtpRow, kirimEmail, penyediaEmail, ujiKoneksiSmtp, type SmtpRow } from "../mail/service";
import type { AppEnv } from "../../middleware/auth";

function smtpDto(row: SmtpRow | null): SmtpSettingsDto {
  const provider = penyediaEmail(row);
  return {
    host: row?.host ?? null,
    port: row?.port ?? 587,
    username: row?.username ?? null,
    has_password: Boolean(row?.password),
    encryption: row?.encryption ?? "starttls",
    sender_name: row?.senderName ?? null,
    sender_email: row?.senderEmail ?? null,
    configured: provider !== "none",
    provider,
  };
}

const SmtpBody = z.object({
  host: z.string().trim().nullish(),
  port: z.number().int().min(1).max(65535).optional(),
  username: z.string().trim().nullish(),
  /** kosong/undefined = jangan ubah password; isi = ganti */
  password: z.string().optional(),
  encryption: z.enum(["none", "ssl", "starttls"]).optional(),
  sender_name: z.string().trim().nullish(),
  sender_email: z.string().trim().email().nullish(),
});

/** Panel sistem super-admin: status DB & migrasi + pengaturan email (SMTP). */
export const adminSystemRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    let databaseOk = true;
    try {
      await db.execute(sql`SELECT 1`);
    } catch {
      databaseOk = false;
    }
    return c.json({
      database_ok: databaseOk,
      storage_mode: getStorage().mode,
      node_version: process.version,
      migrations: await migrationStatus(),
    });
  })
  .post("/migrate", async (c) => {
    try {
      await runMigrations();
    } catch (e) {
      console.error("Migrasi manual gagal:", e);
      throw new HTTPException(500, {
        message: `Migrasi gagal: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
    return c.json({ ok: true, migrations: await migrationStatus() });
  })
  // Pengaturan email (SMTP) tingkat platform — dipakai reset password & undangan.
  .get("/smtp", async (c) => {
    return c.json(smtpDto(await getSmtpRow()));
  })
  .put("/smtp", zValidator("json", SmtpBody), async (c) => {
    const body = c.req.valid("json");
    const existing = await getSmtpRow();
    const set = {
      ...(body.host !== undefined && { host: body.host || null }),
      ...(body.port !== undefined && { port: body.port }),
      ...(body.username !== undefined && { username: body.username || null }),
      // hanya ubah password bila diisi non-kosong (UI menyamarkannya)
      ...(body.password ? { password: body.password } : {}),
      ...(body.encryption !== undefined && { encryption: body.encryption }),
      ...(body.sender_name !== undefined && { senderName: body.sender_name || null }),
      ...(body.sender_email !== undefined && { senderEmail: body.sender_email || null }),
      updatedAt: new Date(),
    };
    if (existing) {
      await db.update(smtpSettings).set(set).where(eq(smtpSettings.id, existing.id));
    } else {
      await db.insert(smtpSettings).values(set);
    }
    return c.json(smtpDto(await getSmtpRow()));
  })
  // Test koneksi SMTP (verify) memakai konfigurasi tersimpan.
  .post("/smtp/test", async (c) => {
    try {
      await ujiKoneksiSmtp(await getSmtpRow());
    } catch (e) {
      throw new HTTPException(400, {
        message: `Koneksi gagal: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
    return c.json({ ok: true });
  })
  // Kirim email percobaan ke alamat tujuan (default: email super admin).
  .post(
    "/smtp/test-email",
    zValidator("json", z.object({ to: z.string().trim().email().optional() })),
    async (c) => {
      const auth = c.get("auth");
      const to = c.req.valid("json").to ?? auth.email;
      try {
        const provider = await kirimEmail({
          to,
          subject: "Email percobaan Kakarut",
          html: `<p>Halo! Ini email percobaan dari pengaturan SMTP Kakarut.</p><p>Bila Anda menerima ini, konfigurasi email sudah benar.</p>`,
        });
        return c.json({ ok: true, to, provider });
      } catch (e) {
        throw new HTTPException(400, {
          message: `Gagal kirim: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
    },
  );

import { zValidator } from "../../lib/validator";
import { and, desc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { periksaCadangan, type BackupRunDto, type BackupStatusDto, type SmtpSettingsDto } from "@kakarut/shared";
import { db } from "../../db/client";
import { backupRuns, smtpSettings, users } from "../../db/schema";
import { env } from "../../config/env";
import { migrationStatus, runMigrations } from "../../db/migrate";
import { getStorage } from "../upload/storage";
import { getCadanganStorage } from "../upload/backup-storage";
import {
  backupSuksesTerakhir,
  jadwalBerikutnya,
  jalankanBackup,
  terapkanRetensi,
  zonaWaktuCadangan,
} from "../../lib/backup";
import { keadaanCadangan, peringatanTerakhir } from "../../lib/backup-peringatan";
import { periksaSetelan } from "../../lib/pemeriksaan-setelan";
import { getSmtpRow, kirimEmail, penyediaEmail, ujiKoneksiSmtp, type SmtpRow } from "../mail/service";
import type { AppEnv } from "../../middleware/auth";

function backupDto(row: typeof backupRuns.$inferSelect): BackupRunDto {
  return {
    id: row.id,
    waktu: row.waktu.toISOString(),
    pemicu: row.pemicu as "otomatis" | "manual",
    status: row.status as "berjalan" | "sukses" | "gagal",
    storage_mode: row.storageMode as "r2" | "local",
    object_key: row.objectKey,
    ukuran_bytes: row.ukuranBytes,
    jumlah_tabel: row.jumlahTabel,
    jumlah_baris: row.jumlahBaris,
    durasi_ms: row.durasiMs,
    error: row.error,
    bisa_unduh: row.status === "sukses" && Boolean(row.objectKey),
  };
}

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
}).strict();

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
      // Temuan yang sama dengan yang dicetak ke log boot. Log boot dibaca
      // sekali, oleh orang yang sedang menunggu deploy selesai; ini tempat
      // orang benar-benar melihatnya.
      pemeriksaan: await periksaSetelan().catch(() => []),
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
  // ── PENCADANGAN DATABASE ──────────────────────────────────────────────
  // Konfigurasi + riwayat cadangan (50 terbaru).
  .get("/backup", async (c) => {
    const rows = await db
      .select()
      .from(backupRuns)
      .orderBy(desc(backupRuns.waktu))
      .limit(50);
    const terakhir = await backupSuksesTerakhir();
    const zona = await zonaWaktuCadangan();
    // Peringatan dihitung dengan aturan YANG SAMA dengan penjaga yang mengirim
    // email (`periksaCadangan` di @kakarut/shared) — panel dan email tak boleh
    // bisa berbeda pendapat soal kapan keadaan disebut gawat.
    const keadaan = await keadaanCadangan();
    const periksa = periksaCadangan(keadaan, Date.now());
    const [smtp, penerima, dikirim] = await Promise.all([
      getSmtpRow(),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(users)
        .where(and(eq(users.isSuperAdmin, true), eq(users.isActive, true), isNull(users.deletedAt)))
        .then((r) => r[0]?.n ?? 0),
      peringatanTerakhir(),
    ]);
    const status: BackupStatusDto = {
      aktif: env.BACKUP_ENABLED,
      jam_lokal: env.BACKUP_HOUR,
      zona_waktu: zona,
      berikutnya: env.BACKUP_ENABLED
        ? jadwalBerikutnya(zona, env.BACKUP_HOUR).toISOString()
        : null,
      simpan: env.BACKUP_KEEP,
      storage_mode: getCadanganStorage().mode,
      terakhir_sukses: terakhir ? terakhir.toISOString() : null,
      peringatan: {
        gawat: periksa.gawat,
        ambang_hari: keadaan.ambang_hari,
        umur_jam: periksa.umur_jam,
        sejak: keadaan.sejak,
        terakhir_dikirim: dikirim ? dikirim.toISOString() : null,
        email_siap: penyediaEmail(smtp) !== "none",
        penerima,
      },
      riwayat: rows.map(backupDto),
    };
    return c.json(status);
  })
  // Picu cadangan manual sekarang.
  .post("/backup", async (c) => {
    const auth = c.get("auth");
    try {
      const h = await jalankanBackup({ pemicu: "manual", olehUserId: auth.sub });
      if (h.status === "gagal") {
        throw new HTTPException(500, { message: `Cadangan gagal: ${h.error}` });
      }
      const [row] = await db.select().from(backupRuns).where(eq(backupRuns.id, h.id));
      return c.json(backupDto(row), 201);
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      // mis. lock (cadangan lain sedang berjalan)
      throw new HTTPException(409, {
        message: e instanceof Error ? e.message : String(e),
      });
    }
  })
  // Unduh berkas cadangan (di-stream lewat server — tak pernah URL publik).
  .get("/backup/:id/unduh", async (c) => {
    const id = c.req.param("id");
    const [row] = await db.select().from(backupRuns).where(eq(backupRuns.id, id));
    if (!row) throw new HTTPException(404, { message: "Cadangan tidak ditemukan" });
    if (row.status !== "sukses" || !row.objectKey) {
      throw new HTTPException(400, { message: "Cadangan ini tidak punya berkas" });
    }
    let buf: Buffer;
    try {
      buf = await getCadanganStorage().ambil(row.objectKey);
    } catch (e) {
      throw new HTTPException(404, {
        message: `Berkas cadangan tak bisa diambil: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="${row.objectKey}"`,
        "Content-Length": String(buf.byteLength),
        "Cache-Control": "no-store",
      },
    });
  })
  // Hapus satu cadangan (berkas + baris riwayat).
  .delete("/backup/:id", async (c) => {
    const id = c.req.param("id");
    const [row] = await db.select().from(backupRuns).where(eq(backupRuns.id, id));
    if (!row) throw new HTTPException(404, { message: "Cadangan tidak ditemukan" });
    if (row.objectKey) {
      await getCadanganStorage()
        .hapus(row.objectKey)
        .catch(() => {
          /* objek mungkin sudah hilang — tetap hapus barisnya */
        });
    }
    await db.delete(backupRuns).where(eq(backupRuns.id, id));
    return c.json({ ok: true });
  })
  // Terapkan retensi sekarang (buang cadangan lama di luar batas simpan).
  .post("/backup/retensi", async (c) => {
    const dibuang = await terapkanRetensi();
    return c.json({ ok: true, dibuang });
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
  // Kirim email percobaan — tujuan, subjek, & isi (HTML) bisa ditentukan; bila
  // kosong pakai default (tujuan = email super admin pemanggil).
  .post(
    "/smtp/test-email",
    zValidator(
      "json",
      z.object({
        to: z.string().trim().email().optional(),
        subject: z.string().trim().optional(),
        html: z.string().optional(),
      }).strict(),
    ),
    async (c) => {
      const auth = c.get("auth");
      const body = c.req.valid("json");
      const to = body.to || auth.email;
      const subject = body.subject?.trim() || "Email percobaan Terakasir";
      const html =
        body.html?.trim() ||
        `<p>Halo! Ini email percobaan dari pengaturan SMTP Terakasir.</p><p>Bila Anda menerima ini, konfigurasi email sudah benar.</p>`;
      try {
        const provider = await kirimEmail({ to, subject, html });
        return c.json({ ok: true, to, provider });
      } catch (e) {
        throw new HTTPException(400, {
          message: `Gagal kirim: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
    },
  );

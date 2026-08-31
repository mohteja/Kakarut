import { and, desc, eq, gte, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ErrorLogDetailDto, ErrorLogDto, ErrorLogKelompokRow } from "@kakarut/shared";
import { db } from "../../db/client";
import { companies, errorLogs, users } from "../../db/schema";
import { pangkasErrorLog } from "../../lib/error-log";
import type { AppEnv } from "../../middleware/auth";

/**
 * LOG GALAT PLATFORM — panel super admin. Gerbangnya dipasang di app.ts
 * (`/admin/*` → requireAuth + requireSuperAdmin); tabelnya LINTAS TENANT, jadi
 * modul ini tak boleh dipasang di router tenant mana pun.
 *
 * Daftar disajikan sebagai KELOMPOK (agregasi per `sidik`), bukan baris mentah:
 * dengan 4xx ikut tercatat, satu tombol yang rusak bisa menghasilkan ribuan
 * baris yang sebenarnya satu masalah. Kronologi mentahnya tetap ada dan bisa
 * dibuka lewat detail kelompok.
 */

const HARI_DEFAULT = 7;
const HARI_MAKS = 90;
const LIMIT_KELOMPOK = 200;
const LIMIT_KEJADIAN = 50;

function batasWaktu(hari: number): Date {
  return new Date(Date.now() - hari * 24 * 60 * 60_000);
}

/** `?hari=` → bilangan 1..90 (default 7); nilai ngawur → default. */
function bacaHari(q: string | undefined): number {
  const n = Number(q);
  if (!Number.isFinite(n) || n < 1) return HARI_DEFAULT;
  return Math.min(Math.floor(n), HARI_MAKS);
}

/**
 * Agregasi kelompok. `pesan`/`metode`/`jalur_pola` diambil dari kejadian
 * TERBARU pada kelompok (max(waktu)) — bukan sembarang baris — supaya yang
 * tampil adalah wajah terkini masalahnya.
 */
async function ambilKelompok(sejak: Date, saring?: "4xx" | "5xx", cari?: string) {
  const kondisi = [gte(errorLogs.waktu, sejak)];
  if (saring === "5xx") kondisi.push(gte(errorLogs.status, 500));
  if (saring === "4xx")
    kondisi.push(and(gte(errorLogs.status, 400), sql`${errorLogs.status} < 500`)!);
  if (cari) {
    const pola = `%${cari}%`;
    kondisi.push(sql`(${errorLogs.pesan} ILIKE ${pola} OR ${errorLogs.jalurPola} ILIKE ${pola})`);
  }

  const rows = await db
    .select({
      sidik: errorLogs.sidik,
      jumlah: sql<number>`count(*)::int`,
      pertama_pada: sql<string>`min(${errorLogs.waktu})`,
      terakhir_pada: sql<string>`max(${errorLogs.waktu})`,
      jumlah_user: sql<number>`count(distinct ${errorLogs.userId})::int`,
      jumlah_perusahaan: sql<number>`count(distinct ${errorLogs.companyId})::int`,
      status: sql<number>`(array_agg(${errorLogs.status} ORDER BY ${errorLogs.waktu} DESC))[1]::int`,
      metode: sql<string>`(array_agg(${errorLogs.metode} ORDER BY ${errorLogs.waktu} DESC))[1]`,
      jalur_pola: sql<string>`(array_agg(${errorLogs.jalurPola} ORDER BY ${errorLogs.waktu} DESC))[1]`,
      pesan: sql<string>`(array_agg(${errorLogs.pesan} ORDER BY ${errorLogs.waktu} DESC))[1]`,
    })
    .from(errorLogs)
    .where(and(...kondisi))
    .groupBy(errorLogs.sidik)
    .orderBy(desc(sql`max(${errorLogs.waktu})`), errorLogs.sidik)
    .limit(LIMIT_KELOMPOK);

  return rows.map(
    (r): ErrorLogKelompokRow => ({
      sidik: r.sidik,
      status: Number(r.status),
      metode: r.metode,
      jalur_pola: r.jalur_pola,
      pesan: r.pesan,
      jumlah: r.jumlah,
      pertama_pada: new Date(r.pertama_pada).toISOString(),
      terakhir_pada: new Date(r.terakhir_pada).toISOString(),
      jumlah_user: r.jumlah_user,
      jumlah_perusahaan: r.jumlah_perusahaan,
    }),
  );
}

export const adminErrorLogRoutes = new Hono<AppEnv>()
  /**
   * Daftar kelompok galat + ringkasan.
   * `?hari=` (1..90, default 7) · `?status=semua|4xx|5xx` (default semua)
   * · `?q=` cari pada pesan/jalur.
   */
  .get("/", async (c) => {
    const hari = bacaHari(c.req.query("hari"));
    const sejak = batasWaktu(hari);
    const qStatus = c.req.query("status");
    const saring = qStatus === "4xx" || qStatus === "5xx" ? qStatus : undefined;
    const cari = (c.req.query("q") ?? "").trim() || undefined;

    // Ringkasan dihitung atas SELURUH rentang (tanpa saringan status/pencarian)
    // supaya angka pada kartu tak ikut berubah saat tab disaring.
    const [ringkas] = await db
      .select({
        total: sql<number>`count(*)::int`,
        total_5xx: sql<number>`count(*) filter (where ${errorLogs.status} >= 500)::int`,
        total_4xx: sql<number>`count(*) filter (where ${errorLogs.status} between 400 and 499)::int`,
      })
      .from(errorLogs)
      .where(gte(errorLogs.waktu, sejak));

    const rows = await ambilKelompok(sejak, saring, cari);
    const dto: ErrorLogDto = {
      hari,
      total: ringkas?.total ?? 0,
      total_5xx: ringkas?.total_5xx ?? 0,
      total_4xx: ringkas?.total_4xx ?? 0,
      jumlah_kelompok: rows.length,
      rows,
    };
    return c.json(dto);
  })

  /** Buang SEMUA baris log (tombol "Bersihkan" di panel). */
  .delete("/", async (c) => {
    const dihapus = await db.delete(errorLogs).returning({ id: errorLogs.id });
    return c.json({ ok: true, dihapus: dihapus.length });
  })

  /** Jalankan pemangkasan retensi/kuota sekarang (biasanya lewat penjadwal). */
  .post("/pangkas", async (c) => {
    const dihapus = await pangkasErrorLog();
    return c.json({ ok: true, dihapus });
  })

  /**
   * Detail satu kelompok: metanya + kejadian terbaru (kronologi mentah, dengan
   * pelapor & perusahaannya). `?hari=` mengikuti daftar agar angka konsisten.
   */
  .get("/:sidik", async (c) => {
    const sidik = c.req.param("sidik");
    const hari = bacaHari(c.req.query("hari"));
    const sejak = batasWaktu(hari);

    const semua = await ambilKelompok(sejak);
    const kelompok = semua.find((k) => k.sidik === sidik);
    if (!kelompok) {
      throw new HTTPException(404, { message: "Kelompok galat tidak ditemukan pada rentang ini" });
    }

    const kejadian = await db
      .select({
        id: errorLogs.id,
        waktu: errorLogs.waktu,
        status: errorLogs.status,
        metode: errorLogs.metode,
        jalur: errorLogs.jalur,
        pesan: errorLogs.pesan,
        stack: errorLogs.stack,
        user_nama: users.nama,
        user_email: users.email,
        peran: errorLogs.peran,
        perusahaan_nama: companies.nama,
        ip: errorLogs.ip,
        user_agent: errorLogs.userAgent,
      })
      .from(errorLogs)
      .leftJoin(users, eq(users.id, errorLogs.userId))
      .leftJoin(companies, eq(companies.id, errorLogs.companyId))
      .where(and(eq(errorLogs.sidik, sidik), gte(errorLogs.waktu, sejak)))
      .orderBy(desc(errorLogs.waktu), desc(errorLogs.id))
      .limit(LIMIT_KEJADIAN);

    const dto: ErrorLogDetailDto = {
      kelompok,
      kejadian: kejadian.map((k) => ({
        ...k,
        waktu: k.waktu.toISOString(),
      })),
    };
    return c.json(dto);
  });

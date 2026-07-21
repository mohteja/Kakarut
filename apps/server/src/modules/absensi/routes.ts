import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { absenTipeBerikutnya, jarakMeter, type AbsenResult, type AbsensiRow } from "@kakarut/shared";
import { db } from "../../db/client";
import { attendances, branches, companies, memberships, users } from "../../db/schema";
import { tanggalDi } from "../../lib/time";
import { requireRole, resolveBranchId, type AppEnv } from "../../middleware/auth";

/** Koordinat perangkat — divalidasi terhadap radius titik cabang bila diatur. */
const KoordinatBody = {
  /** foto swafoto bukti absen (URL upload) — WAJIB (anti-titip absen) */
  foto_url: z.string().trim().min(1, "Foto absen wajib dilampirkan"),
  lat: z.number().min(-90).max(90).nullish(),
  lng: z.number().min(-180).max(180).nullish(),
};
/** Absen operator (pindai QR / ketik kode karyawan). */
const ClockBody = z.object({ kode: z.string().trim().min(1), ...KoordinatBody });
/** Absen SENDIRI (tombol absen di aplikasi) — tanpa kode, atas nama pemanggil. */
const SelfBody = z.object(KoordinatBody);

/** Validasi tanggal YYYY-MM-DD yang benar (menolak bulan/hari di luar rentang). */
function tanggalValid(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

async function timezoneOf(companyId: string): Promise<string> {
  const [company] = await db
    .select({ timezone: companies.timezone })
    .from(companies)
    .where(eq(companies.id, companyId));
  return company?.timezone ?? "Asia/Jakarta";
}

/**
 * Radius absen: bila titik lokasi cabang diatur, absen HANYA diterima dalam
 * radius itu — perangkat wajib mengirim koordinat GPS. Mengembalikan nama
 * cabang + jarak (m) atau null bila cabang tanpa titik lokasi.
 */
async function cekRadius(
  branchId: string,
  lat: number | null | undefined,
  lng: number | null | undefined,
): Promise<{ jarakM: number | null; namaCabang: string }> {
  const [lok] = await db
    .select({
      nama: branches.nama,
      latitude: branches.latitude,
      longitude: branches.longitude,
      radius: branches.radiusAbsenM,
    })
    .from(branches)
    .where(eq(branches.id, branchId));
  const namaCabang = lok?.nama ?? "";
  if (lok?.latitude != null && lok.longitude != null) {
    if (lat == null || lng == null) {
      throw new HTTPException(400, {
        message: `Absen di ${namaCabang} butuh lokasi — izinkan akses GPS lalu coba lagi`,
      });
    }
    const jarakM = Math.round(jarakMeter(lat, lng, lok.latitude, lok.longitude));
    if (jarakM > lok.radius) {
      throw new HTTPException(400, {
        message: `Di luar radius absen ${namaCabang}: jarak ${jarakM} m (maks ${lok.radius} m)`,
      });
    }
    return { jarakM, namaCabang };
  }
  return { jarakM: null, namaCabang };
}

/**
 * Catat cap masuk/keluar untuk seorang karyawan di cabang: tentukan tipe dari
 * cap terakhir HARI INI di cabang itu (branch-scoped, konsisten dgn ringkasan
 * GET), lalu sisipkan baris absensi. Mengembalikan AbsenResult.
 */
async function catatAbsen(opts: {
  companyId: string;
  branchId: string;
  userId: string;
  employeeCode: string;
  nama: string;
  namaCabang: string;
  fotoUrl: string;
  jarakM: number | null;
}): Promise<AbsenResult> {
  const tanggal = tanggalDi(await timezoneOf(opts.companyId));
  const [last] = await db
    .select({ tipe: attendances.tipe })
    .from(attendances)
    .where(
      and(
        eq(attendances.companyId, opts.companyId),
        eq(attendances.branchId, opts.branchId),
        eq(attendances.userId, opts.userId),
        eq(attendances.attendDate, tanggal),
      ),
    )
    .orderBy(desc(attendances.waktu))
    .limit(1);
  const tipe = absenTipeBerikutnya(last?.tipe ?? null);
  const [ins] = await db
    .insert(attendances)
    .values({
      companyId: opts.companyId,
      branchId: opts.branchId,
      userId: opts.userId,
      tipe,
      attendDate: tanggal,
      fotoUrl: opts.fotoUrl,
    })
    .returning({ waktu: attendances.waktu });
  return {
    user_id: opts.userId,
    nama: opts.nama,
    employee_code: opts.employeeCode,
    tipe,
    waktu: ins.waktu.toISOString(),
    branch_nama: opts.namaCabang,
    jarak_m: opts.jarakM,
    foto_url: opts.fotoUrl,
  };
}

/**
 * Apakah karyawan SEDANG HADIR (sudah absen masuk & belum absen keluar) hari
 * ini di cabang tsb — dipakai gerbang buka-shift kasir: kasir wajib absen dulu.
 * Cap absen terakhir hari ini = 'masuk' → hadir; 'keluar' atau belum ada → tidak.
 */
export async function sedangHadir(
  companyId: string,
  branchId: string,
  userId: string,
): Promise<boolean> {
  const tanggal = tanggalDi(await timezoneOf(companyId));
  const [last] = await db
    .select({ tipe: attendances.tipe })
    .from(attendances)
    .where(
      and(
        eq(attendances.companyId, companyId),
        eq(attendances.branchId, branchId),
        eq(attendances.userId, userId),
        eq(attendances.attendDate, tanggal),
      ),
    )
    .orderBy(desc(attendances.waktu))
    .limit(1);
  return last?.tipe === "masuk";
}

/**
 * Absensi karyawan. Dua jalur:
 *  - POST /       : STASIUN pindai — admin/kasir memindai QR / ketik kode
 *    karyawan; baris dicatat atas nama pemilik kode, bukan operator.
 *  - POST /saya   : ABSEN SENDIRI — semua peran (termasuk TIM) menekan tombol
 *    absen di aplikasi; dicatat atas nama pemanggil sendiri (tak bisa titip).
 * Keduanya tunduk pada radius titik cabang + wajib foto swafoto.
 */
export const absensiRoutes = new Hono<AppEnv>()
  .post("/", requireRole("owner", "admin", "cashier"), zValidator("json", ClockBody), async (c) => {
    const auth = c.get("auth");
    const branchId = await resolveBranchId(c);
    const { lat, lng, foto_url } = c.req.valid("json");
    const kode = c.req.valid("json").kode.trim();
    const { jarakM, namaCabang } = await cekRadius(branchId, lat, lng);

    // Resolusi karyawan lewat kode (case-insensitive) dalam perusahaan pemanggil.
    // Karyawan terarsip diperlakukan seperti tidak ditemukan (sudah keluar).
    const [m] = await db
      .select({
        userId: memberships.userId,
        kode: memberships.employeeCode,
        nama: users.nama,
        isActive: users.isActive,
      })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .where(
        and(
          eq(memberships.companyId, auth.company_id!),
          sql`upper(${memberships.employeeCode}) = upper(${kode})`,
          isNull(memberships.archivedAt),
        ),
      );
    if (!m) throw new HTTPException(404, { message: `Kode karyawan "${kode}" tidak ditemukan` });
    if (!m.isActive) throw new HTTPException(400, { message: `${m.nama} berstatus nonaktif` });

    const result = await catatAbsen({
      companyId: auth.company_id!,
      branchId,
      userId: m.userId,
      employeeCode: m.kode ?? kode,
      nama: m.nama,
      namaCabang,
      fotoUrl: foto_url,
      jarakM,
    });
    return c.json(result, 201);
  })
  // Absen SENDIRI — atas nama pemanggil (auth.sub). Aman untuk peran tim: tak
  // ada kode yang bisa dititipkan; server memakai keanggotaan pemanggil.
  .post("/saya", zValidator("json", SelfBody), async (c) => {
    const auth = c.get("auth");
    const branchId = await resolveBranchId(c);
    const { lat, lng, foto_url } = c.req.valid("json");
    const { jarakM, namaCabang } = await cekRadius(branchId, lat, lng);

    const [m] = await db
      .select({
        kode: memberships.employeeCode,
        nama: users.nama,
        isActive: users.isActive,
      })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .where(
        and(
          eq(memberships.companyId, auth.company_id!),
          eq(memberships.userId, auth.sub),
          isNull(memberships.archivedAt),
        ),
      );
    if (!m) throw new HTTPException(403, { message: "Akun Anda bukan karyawan aktif cabang ini" });
    if (!m.kode) {
      throw new HTTPException(400, { message: "Kode karyawan Anda belum diatur — hubungi admin" });
    }
    if (!m.isActive) throw new HTTPException(400, { message: "Akun Anda berstatus nonaktif" });

    const result = await catatAbsen({
      companyId: auth.company_id!,
      branchId,
      userId: auth.sub,
      employeeCode: m.kode,
      nama: m.nama,
      namaCabang,
      fotoUrl: foto_url,
      jarakM,
    });
    return c.json(result, 201);
  })
  // Ringkasan absensi hari ini (atau ?tanggal=YYYY-MM-DD) di cabang: jam masuk
  // pertama & jam keluar terakhir per karyawan.
  .get("/", async (c) => {
    const auth = c.get("auth");
    const branchId = await resolveBranchId(c);
    const tanggalQ = c.req.query("tanggal");
    if (tanggalQ !== undefined && !tanggalValid(tanggalQ)) {
      throw new HTTPException(400, { message: "Format tanggal harus YYYY-MM-DD" });
    }
    const tanggal = tanggalQ ?? tanggalDi(await timezoneOf(auth.company_id!));
    const rows = await db
      .select({
        user_id: attendances.userId,
        nama: users.nama,
        employee_code: memberships.employeeCode,
        masuk: sql<string | null>`min(${attendances.waktu}) filter (where ${attendances.tipe} = 'masuk')`,
        keluar: sql<string | null>`max(${attendances.waktu}) filter (where ${attendances.tipe} = 'keluar')`,
        // foto pada cap masuk PERTAMA & keluar TERAKHIR (urut waktu)
        foto_masuk: sql<
          string | null
        >`(array_agg(${attendances.fotoUrl} order by ${attendances.waktu}) filter (where ${attendances.tipe} = 'masuk'))[1]`,
        foto_keluar: sql<
          string | null
        >`(array_agg(${attendances.fotoUrl} order by ${attendances.waktu} desc) filter (where ${attendances.tipe} = 'keluar'))[1]`,
      })
      .from(attendances)
      .innerJoin(users, eq(attendances.userId, users.id))
      .leftJoin(
        memberships,
        and(
          eq(memberships.userId, attendances.userId),
          eq(memberships.companyId, attendances.companyId),
        ),
      )
      .where(
        and(
          eq(attendances.companyId, auth.company_id!),
          eq(attendances.branchId, branchId),
          eq(attendances.attendDate, tanggal),
        ),
      )
      .groupBy(attendances.userId, users.nama, memberships.employeeCode)
      .orderBy(sql`min(${attendances.waktu})`);
    const dto: AbsensiRow[] = rows.map((r) => ({
      user_id: r.user_id,
      nama: r.nama,
      employee_code: r.employee_code ?? null,
      masuk: r.masuk ? new Date(r.masuk).toISOString() : null,
      keluar: r.keluar ? new Date(r.keluar).toISOString() : null,
      foto_masuk: r.foto_masuk ?? null,
      foto_keluar: r.foto_keluar ?? null,
    }));
    return c.json(dto);
  });

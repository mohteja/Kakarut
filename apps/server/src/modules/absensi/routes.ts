import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { absenTipeBerikutnya, type AbsenResult, type AbsensiRow } from "@kakarut/shared";
import { db } from "../../db/client";
import { attendances, branches, companies, memberships, users } from "../../db/schema";
import { tanggalDi } from "../../lib/time";
import { resolveBranchId, type AppEnv } from "../../middleware/auth";

const ClockBody = z.object({ kode: z.string().trim().min(1) });

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
 * Absensi karyawan mode kiosk: perangkat kasir dipakai bergantian oleh semua
 * karyawan. Karyawan mengetik kode atau memindai QR (yang memuat kodenya) →
 * server tentukan cap masuk/keluar otomatis dari cap terakhir hari ini.
 * Semua peran boleh (tak digerbang di app.ts); operator hanya untuk auth +
 * konteks perusahaan/cabang — baris absensi dicatat atas nama karyawan pemilik
 * kode, bukan operator perangkat.
 */
export const absensiRoutes = new Hono<AppEnv>()
  .post("/", zValidator("json", ClockBody), async (c) => {
    const auth = c.get("auth");
    const branchId = await resolveBranchId(c);
    const kode = c.req.valid("json").kode.trim();

    // Resolusi karyawan lewat kode (case-insensitive) dalam perusahaan pemanggil.
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
        ),
      );
    if (!m) throw new HTTPException(404, { message: `Kode karyawan "${kode}" tidak ditemukan` });
    if (!m.isActive) throw new HTTPException(400, { message: `${m.nama} berstatus nonaktif` });

    const tanggal = tanggalDi(await timezoneOf(auth.company_id!));

    // cap terakhir hari ini untuk karyawan ini DI CABANG INI → tentukan
    // masuk/keluar. Branch-scoped agar konsisten dengan ringkasan GET yang juga
    // per-cabang (tiap kiosk cabang berpasangan masuk↔keluar sendiri).
    const [last] = await db
      .select({ tipe: attendances.tipe })
      .from(attendances)
      .where(
        and(
          eq(attendances.companyId, auth.company_id!),
          eq(attendances.branchId, branchId),
          eq(attendances.userId, m.userId),
          eq(attendances.attendDate, tanggal),
        ),
      )
      .orderBy(desc(attendances.waktu))
      .limit(1);
    const tipe = absenTipeBerikutnya(last?.tipe ?? null);

    const [ins] = await db
      .insert(attendances)
      .values({
        companyId: auth.company_id!,
        branchId,
        userId: m.userId,
        tipe,
        attendDate: tanggal,
      })
      .returning({ waktu: attendances.waktu });
    const [branch] = await db
      .select({ nama: branches.nama })
      .from(branches)
      .where(eq(branches.id, branchId));

    const result: AbsenResult = {
      user_id: m.userId,
      nama: m.nama,
      employee_code: m.kode ?? kode,
      tipe,
      waktu: ins.waktu.toISOString(),
      branch_nama: branch?.nama ?? "",
    };
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
    }));
    return c.json(dto);
  });

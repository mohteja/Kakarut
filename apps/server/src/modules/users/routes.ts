import { zValidator } from "@hono/zod-validator";
import bcrypt from "bcryptjs";
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { db } from "../../db/client";
import {
  branches,
  fakturLogs,
  memberships,
  storageLocationPetugas,
  storageLocations,
  users,
} from "../../db/schema";
import { type AppEnv } from "../../middleware/auth";
import { isKodeKaryawanConflict, resolveKodeKaryawan } from "./service";

const KaryawanBody = z.object({
  nama: z.string().trim().min(1),
  email: z.string().trim().toLowerCase(),
  password: z.string().min(8, "password minimal 8 karakter"),
  role: z.enum(["owner", "admin", "cashier", "tim"]),
  branch_id: z.string().uuid().nullish(),
});

/** kasir & tim terikat ke satu cabang — wajib punya lokasi kerja */
const WAJIB_CABANG = new Set(["cashier", "tim"]);

const PatchKaryawanBody = z.object({
  nama: z.string().trim().min(1).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  role: z.enum(["owner", "admin", "cashier", "tim"]).optional(),
  branch_id: z.string().uuid().nullish().optional(),
  is_active: z.boolean().optional(),
  password: z.string().min(8).optional(),
  /** true = arsipkan (keluar dari daftar, riwayat tetap); false = pulihkan */
  arsip: z.boolean().optional(),
});

async function pastikanCabangMilikPerusahaan(branchId: string, companyId: string) {
  const [b] = await db
    .select({ id: branches.id, tipe: branches.tipe })
    .from(branches)
    .where(and(eq(branches.id, branchId), eq(branches.companyId, companyId)));
  if (!b) throw new HTTPException(400, { message: "Cabang tidak valid" });
  return b;
}

/**
 * Central Kitchen hanya punya SATU peran lapangan: karyawan (tim) — kasir
 * tidak berjualan di dapur produksi.
 */
function pastikanPeranCocokCabang(role: string, tipe: string) {
  if (role === "cashier" && tipe === "central_kitchen") {
    throw new HTTPException(400, {
      message: "Central Kitchen hanya menerima peran Karyawan — bukan kasir",
    });
  }
}

export const karyawanRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const auth = c.get("auth");
    // default = karyawan berjalan; ?arsip=true = yang sudah diarsipkan (keluar)
    const lihatArsip = c.req.query("arsip") === "true";
    const rows = await db
      .select({
        user_id: users.id,
        nama: users.nama,
        email: users.email,
        is_active: users.isActive,
        role: memberships.role,
        branch_id: memberships.branchId,
        cabang: branches.nama,
        employee_code: memberships.employeeCode,
        archived_at: memberships.archivedAt,
      })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .leftJoin(branches, eq(memberships.branchId, branches.id))
      .where(
        and(
          eq(memberships.companyId, auth.company_id!),
          lihatArsip ? isNotNull(memberships.archivedAt) : isNull(memberships.archivedAt),
        ),
      );
    return c.json(rows);
  })
  .post("/", zValidator("json", KaryawanBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    if (body.role === "owner" && auth.role !== "owner") {
      throw new HTTPException(403, { message: "Hanya owner yang boleh menambah owner" });
    }
    if (WAJIB_CABANG.has(body.role)) {
      if (!body.branch_id) {
        throw new HTTPException(400, { message: "Kasir/Tim wajib punya cabang" });
      }
      const cb = await pastikanCabangMilikPerusahaan(body.branch_id, auth.company_id!);
      pastikanPeranCocokCabang(body.role, cb.tipe);
    }
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, body.email));
    if (existing) {
      throw new HTTPException(409, { message: `Email ${body.email} sudah terdaftar` });
    }
    // Retry bila kode karyawan bentrok: generate kode membaca snapshot, jadi dua
    // pembuatan bersamaan dgn inisial sama bisa memilih kode yang sama → coba
    // ulang (resolveKodeKaryawan membaca ulang & menomori BS2, dst.).
    const passwordHash = bcrypt.hashSync(body.password, 10);
    let result: { user_id: string; email: string; nama: string; role: string; employee_code: string } | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        result = await db.transaction(async (tx) => {
          const [user] = await tx
            .insert(users)
            .values({ email: body.email, passwordHash, nama: body.nama })
            .returning();
          // kode karyawan otomatis (ID cepat absensi via ketik/scan QR), unik per perusahaan
          const employeeCode = await resolveKodeKaryawan(tx, auth.company_id!, body.nama);
          await tx.insert(memberships).values({
            userId: user.id,
            companyId: auth.company_id!,
            role: body.role,
            branchId: WAJIB_CABANG.has(body.role) ? body.branch_id : (body.branch_id ?? null),
            employeeCode,
          });
          return { user_id: user.id, email: user.email, nama: user.nama, role: body.role, employee_code: employeeCode };
        });
        break;
      } catch (e) {
        if (attempt < 2 && isKodeKaryawanConflict(e)) continue;
        throw e;
      }
    }
    return c.json(result!, 201);
  })
  /**
   * Riwayat KEGIATAN satu karyawan: semua log faktur yang ia lakukan (buat
   * faktur, ubah tahap, konfirmasi, penerimaan) — pelacakan per orang.
   */
  .get("/:userId/aktivitas", async (c) => {
    const auth = c.get("auth");
    const userId = c.req.param("userId");
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
      .where(and(eq(fakturLogs.companyId, auth.company_id!), eq(fakturLogs.userId, userId)))
      .orderBy(desc(fakturLogs.waktu), desc(fakturLogs.id))
      .limit(100);
    return c.json({ rows });
  })
  /**
   * Tempat penyimpanan yang jadi tugas SO karyawan ini (petugas opname).
   * Dipakai halaman Karyawan untuk menugaskan tempat SO per karyawan.
   * `tersedia` = semua tempat aktif di CABANG karyawan; `assigned` = yang
   * sedang ditugaskan. Karyawan tanpa cabang (owner/admin) tak punya tempat.
   */
  .get("/:userId/tempat", async (c) => {
    const auth = c.get("auth");
    const userId = c.req.param("userId");
    const [member] = await db
      .select({ branchId: memberships.branchId })
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.companyId, auth.company_id!)));
    if (!member) throw new HTTPException(404, { message: "Karyawan tidak ditemukan" });
    if (!member.branchId) return c.json({ assigned: [], tersedia: [] });
    const tersedia = await db
      .select({ id: storageLocations.id, nama: storageLocations.nama })
      .from(storageLocations)
      .where(
        and(
          eq(storageLocations.companyId, auth.company_id!),
          eq(storageLocations.branchId, member.branchId),
          eq(storageLocations.isActive, true),
        ),
      )
      .orderBy(asc(storageLocations.nama));
    const tersediaIds = new Set(tersedia.map((t) => t.id));
    const rows = await db
      .select({ locId: storageLocationPetugas.storageLocationId })
      .from(storageLocationPetugas)
      .where(
        and(
          eq(storageLocationPetugas.companyId, auth.company_id!),
          eq(storageLocationPetugas.userId, userId),
        ),
      );
    const assigned = rows.map((r) => r.locId).filter((id) => tersediaIds.has(id));
    return c.json({ assigned, tersedia });
  })
  /**
   * Ganti seluruh penugasan tempat SO karyawan (dalam cabangnya). Menulis ke
   * tabel yang sama dengan PUT /penyimpanan/:id/petugas → konsisten dua arah.
   * Hanya menyentuh tempat di cabang karyawan (tak mengganggu cabang lain).
   */
  .put(
    "/:userId/tempat",
    zValidator("json", z.object({ tempat_ids: z.array(z.string().uuid()) })),
    async (c) => {
      const auth = c.get("auth");
      const userId = c.req.param("userId");
      const body = c.req.valid("json");
      const [member] = await db
        .select({ branchId: memberships.branchId })
        .from(memberships)
        .where(and(eq(memberships.userId, userId), eq(memberships.companyId, auth.company_id!)));
      if (!member) throw new HTTPException(404, { message: "Karyawan tidak ditemukan" });
      if (!member.branchId) {
        throw new HTTPException(400, {
          message: "Karyawan tanpa cabang tak bisa ditugaskan tempat SO",
        });
      }
      // Lingkup penugasan yang boleh diganti = tempat AKTIF di cabang karyawan.
      // Sama persis dengan yang ditampilkan GET (tersedia aktif) agar simetris:
      // penugasan pada tempat nonaktif (tak tampak di modal) tak ikut terhapus.
      const lokasiCabang = await db
        .select({ id: storageLocations.id })
        .from(storageLocations)
        .where(
          and(
            eq(storageLocations.companyId, auth.company_id!),
            eq(storageLocations.branchId, member.branchId),
            eq(storageLocations.isActive, true),
          ),
        );
      const idCabang = new Set(lokasiCabang.map((l) => l.id));
      const uniqueIds = [...new Set(body.tempat_ids)];
      for (const id of uniqueIds) {
        if (!idCabang.has(id)) {
          throw new HTTPException(400, { message: "Ada tempat di luar cabang karyawan" });
        }
      }
      await db.transaction(async (tx) => {
        if (idCabang.size > 0) {
          await tx
            .delete(storageLocationPetugas)
            .where(
              and(
                eq(storageLocationPetugas.companyId, auth.company_id!),
                eq(storageLocationPetugas.userId, userId),
                inArray(storageLocationPetugas.storageLocationId, [...idCabang]),
              ),
            );
        }
        if (uniqueIds.length > 0) {
          await tx.insert(storageLocationPetugas).values(
            uniqueIds.map((tid) => ({
              companyId: auth.company_id!,
              storageLocationId: tid,
              userId,
            })),
          );
        }
      });
      return c.json({ ok: true, assigned: uniqueIds });
    },
  )
  .patch("/:userId", zValidator("json", PatchKaryawanBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const userId = c.req.param("userId");

    const [member] = await db
      .select()
      .from(memberships)
      .where(
        and(eq(memberships.userId, userId), eq(memberships.companyId, auth.company_id!)),
      );
    if (!member) throw new HTTPException(404, { message: "Karyawan tidak ditemukan" });

    // Guard hierarki: admin tidak boleh menyentuh akun owner ataupun
    // memberikan peran owner (mencegah eskalasi privilese).
    if (auth.role !== "owner") {
      if (member.role === "owner") {
        throw new HTTPException(403, { message: "Hanya owner yang boleh mengubah akun owner" });
      }
      if (body.role === "owner") {
        throw new HTTPException(403, { message: "Hanya owner yang boleh memberi peran owner" });
      }
    }

    // NONAKTIF = ARSIP (satu status): menonaktifkan berarti masuk arsip,
    // memulihkan dari arsip berarti aktif kembali.
    const arsipEfektif =
      body.arsip ?? (body.is_active !== undefined ? !body.is_active : undefined);
    const aktifEfektif =
      body.is_active ?? (body.arsip !== undefined ? !body.arsip : undefined);

    // Jangan mengunci diri sendiri: nonaktif/arsip akun sendiri ditolak.
    if (userId === auth.sub && arsipEfektif === true) {
      throw new HTTPException(400, {
        message: "Tidak bisa menonaktifkan/mengarsipkan akun sendiri",
      });
    }
    // Perusahaan tidak boleh kehilangan owner terakhir yang masih berjalan.
    if (arsipEfektif === true && member.role === "owner") {
      const ownerLain = await db
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            eq(memberships.companyId, auth.company_id!),
            eq(memberships.role, "owner"),
            isNull(memberships.archivedAt),
            ne(memberships.userId, userId),
          ),
        );
      if (ownerLain.length === 0) {
        throw new HTTPException(400, {
          message: "Tidak bisa mengarsipkan owner terakhir perusahaan",
        });
      }
    }

    const targetRole = body.role ?? member.role;
    const targetBranch =
      body.branch_id !== undefined ? body.branch_id : member.branchId;
    if (WAJIB_CABANG.has(targetRole) && !targetBranch) {
      throw new HTTPException(400, { message: "Kasir/Tim wajib punya cabang" });
    }
    if (targetBranch) {
      const cb = await pastikanCabangMilikPerusahaan(targetBranch, auth.company_id!);
      pastikanPeranCocokCabang(targetRole, cb.tipe);
    }

    // Email = identitas login lintas perusahaan → wajib unik global.
    if (body.email !== undefined) {
      const [bentrok] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, body.email));
      if (bentrok && bentrok.id !== userId) {
        throw new HTTPException(409, { message: `Email ${body.email} sudah terdaftar` });
      }
    }

    await db.transaction(async (tx) => {
      if (body.role !== undefined || body.branch_id !== undefined || arsipEfektif !== undefined) {
        await tx
          .update(memberships)
          .set({
            role: targetRole,
            branchId: targetBranch ?? null,
            ...(arsipEfektif !== undefined && {
              archivedAt: arsipEfektif ? new Date() : null,
            }),
          })
          .where(eq(memberships.id, member.id));
      }
      if (
        body.nama !== undefined ||
        body.email !== undefined ||
        aktifEfektif !== undefined ||
        body.password
      ) {
        await tx
          .update(users)
          .set({
            ...(body.nama !== undefined && { nama: body.nama }),
            ...(body.email !== undefined && { email: body.email }),
            ...(aktifEfektif !== undefined && { isActive: aktifEfektif }),
            ...(body.password && { passwordHash: bcrypt.hashSync(body.password, 10) }),
          })
          .where(eq(users.id, userId));
      }
    });
    return c.json({ ok: true });
  });

import { zValidator } from "@hono/zod-validator";
import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { db } from "../../db/client";
import { branches, memberships, users } from "../../db/schema";
import { type AppEnv } from "../../middleware/auth";
import { isKodeKaryawanConflict, resolveKodeKaryawan } from "./service";

const KaryawanBody = z.object({
  nama: z.string().trim().min(1),
  email: z.string().trim().toLowerCase(),
  password: z.string().min(8, "password minimal 8 karakter"),
  role: z.enum(["owner", "admin", "cashier"]),
  branch_id: z.string().uuid().nullish(),
});

const PatchKaryawanBody = z.object({
  nama: z.string().trim().min(1).optional(),
  role: z.enum(["owner", "admin", "cashier"]).optional(),
  branch_id: z.string().uuid().nullish().optional(),
  is_active: z.boolean().optional(),
  password: z.string().min(8).optional(),
});

async function pastikanCabangMilikPerusahaan(branchId: string, companyId: string) {
  const [b] = await db
    .select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.id, branchId), eq(branches.companyId, companyId)));
  if (!b) throw new HTTPException(400, { message: "Cabang tidak valid" });
}

export const karyawanRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const auth = c.get("auth");
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
      })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .leftJoin(branches, eq(memberships.branchId, branches.id))
      .where(eq(memberships.companyId, auth.company_id!));
    return c.json(rows);
  })
  .post("/", zValidator("json", KaryawanBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    if (body.role === "owner" && auth.role !== "owner") {
      throw new HTTPException(403, { message: "Hanya owner yang boleh menambah owner" });
    }
    if (body.role === "cashier") {
      if (!body.branch_id) {
        throw new HTTPException(400, { message: "Kasir wajib punya cabang" });
      }
      await pastikanCabangMilikPerusahaan(body.branch_id, auth.company_id!);
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
            branchId: body.role === "cashier" ? body.branch_id : (body.branch_id ?? null),
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

    const targetRole = body.role ?? member.role;
    const targetBranch =
      body.branch_id !== undefined ? body.branch_id : member.branchId;
    if (targetRole === "cashier" && !targetBranch) {
      throw new HTTPException(400, { message: "Kasir wajib punya cabang" });
    }
    if (targetBranch) await pastikanCabangMilikPerusahaan(targetBranch, auth.company_id!);

    await db.transaction(async (tx) => {
      if (body.role !== undefined || body.branch_id !== undefined) {
        await tx
          .update(memberships)
          .set({ role: targetRole, branchId: targetBranch ?? null })
          .where(eq(memberships.id, member.id));
      }
      if (body.nama !== undefined || body.is_active !== undefined || body.password) {
        await tx
          .update(users)
          .set({
            ...(body.nama !== undefined && { nama: body.nama }),
            ...(body.is_active !== undefined && { isActive: body.is_active }),
            ...(body.password && { passwordHash: bcrypt.hashSync(body.password, 10) }),
          })
          .where(eq(users.id, userId));
      }
    });
    return c.json({ ok: true });
  });

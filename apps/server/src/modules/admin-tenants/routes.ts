import { zValidator } from "@hono/zod-validator";
import bcrypt from "bcryptjs";
import { desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { db } from "../../db/client";
import { branches, companies, memberships, users } from "../../db/schema";
import type { AppEnv } from "../../middleware/auth";
import { seedMejaDefault } from "../meja/defaults";
import { seedUnitsPerusahaan } from "../satuan/service";
import { seedKategoriBahanPerusahaan } from "../kategori-bahan/service";
import { resolveKodeKaryawan } from "../users/service";

const CreateTenantBody = z.object({
  nama: z.string().trim().min(1),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]+$/, "slug hanya huruf kecil, angka, tanda hubung")
    .optional(),
  cabang_nama: z.string().trim().min(1).default("Pusat"),
  owner_nama: z.string().trim().min(1),
  owner_email: z.string().trim().toLowerCase(),
  owner_password: z.string().min(8, "password minimal 8 karakter"),
  plan: z.string().default("lite"),
});

const PatchTenantBody = z.object({
  nama: z.string().trim().min(1).optional(),
  plan: z.string().optional(),
  plan_expires_at: z.string().datetime().nullish(),
  is_active: z.boolean().optional(),
});

export const adminTenantsRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const rows = await db
      .select({
        id: companies.id,
        nama: companies.nama,
        slug: companies.slug,
        plan: companies.plan,
        plan_expires_at: companies.planExpiresAt,
        is_active: companies.isActive,
        created_at: companies.createdAt,
        jumlah_cabang: sql<number>`(SELECT count(*)::int FROM branches b WHERE b.company_id = ${companies.id})`,
        jumlah_user: sql<number>`(SELECT count(*)::int FROM memberships m WHERE m.company_id = ${companies.id})`,
      })
      .from(companies)
      .orderBy(desc(companies.createdAt));
    return c.json(rows);
  })
  .post("/", zValidator("json", CreateTenantBody), async (c) => {
    const body = c.req.valid("json");
    const slug =
      body.slug ?? body.nama.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

    const result = await db.transaction(async (tx) => {
      const [existingCompany] = await tx
        .select({ id: companies.id })
        .from(companies)
        .where(eq(companies.slug, slug));
      if (existingCompany) {
        throw new HTTPException(409, { message: `Slug "${slug}" sudah dipakai` });
      }
      const [existingUser] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, body.owner_email));
      if (existingUser) {
        throw new HTTPException(409, {
          message: `Email ${body.owner_email} sudah terdaftar`,
        });
      }

      const [company] = await tx
        .insert(companies)
        .values({ nama: body.nama, slug, plan: body.plan })
        .returning();
      const [branch] = await tx
        .insert(branches)
        .values({ companyId: company.id, nama: body.cabang_nama })
        .returning();
      // Meja bawaan (Ruang Tunggu + Meja 1) supaya usaha take away langsung bisa jualan.
      await seedMejaDefault(tx, company.id, branch.id);
      // Master satuan + kategori bahan bawaan untuk dropdown Bahan Baku.
      await seedUnitsPerusahaan(tx, company.id);
      await seedKategoriBahanPerusahaan(tx, company.id);
      const [owner] = await tx
        .insert(users)
        .values({
          email: body.owner_email,
          passwordHash: bcrypt.hashSync(body.owner_password, 10),
          nama: body.owner_nama,
          // Dibuat oleh super admin → langsung terverifikasi (boleh login).
          emailVerifiedAt: new Date(),
        })
        .returning();
      // Owner langsung dapat kode karyawan (barcode/QR absen)
      const employeeCode = await resolveKodeKaryawan(tx, company.id);
      await tx
        .insert(memberships)
        .values({ userId: owner.id, companyId: company.id, role: "owner", employeeCode });

      return { company, branch, owner: { id: owner.id, email: owner.email } };
    });
    return c.json(result, 201);
  })
  .get("/:id", async (c) => {
    const [company] = await db
      .select()
      .from(companies)
      .where(eq(companies.id, c.req.param("id")));
    if (!company) throw new HTTPException(404, { message: "Tenant tidak ditemukan" });
    const cabang = await db
      .select()
      .from(branches)
      .where(eq(branches.companyId, company.id));
    const anggota = await db
      .select({
        user_id: users.id,
        nama: users.nama,
        email: users.email,
        role: memberships.role,
      })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .where(eq(memberships.companyId, company.id));
    return c.json({ company, cabang, anggota });
  })
  .patch("/:id", zValidator("json", PatchTenantBody), async (c) => {
    const body = c.req.valid("json");
    const [row] = await db
      .update(companies)
      .set({
        ...(body.nama !== undefined && { nama: body.nama }),
        ...(body.plan !== undefined && { plan: body.plan }),
        ...(body.plan_expires_at !== undefined && {
          planExpiresAt: body.plan_expires_at ? new Date(body.plan_expires_at) : null,
        }),
        ...(body.is_active !== undefined && { isActive: body.is_active }),
        updatedAt: new Date(),
      })
      .where(eq(companies.id, c.req.param("id")))
      .returning();
    if (!row) throw new HTTPException(404, { message: "Tenant tidak ditemukan" });
    return c.json(row);
  });

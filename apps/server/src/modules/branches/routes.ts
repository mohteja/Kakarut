import { zValidator } from "@hono/zod-validator";
import { and, asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { db } from "../../db/client";
import { branches } from "../../db/schema";
import { requireRole, type AppEnv } from "../../middleware/auth";
import { seedMejaDefault } from "../meja/defaults";

const CabangBody = z.object({
  nama: z.string().trim().min(1),
  alamat: z.string().nullish(),
  telepon: z.string().nullish(),
  is_active: z.boolean().optional(),
});

export const cabangRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const auth = c.get("auth");
    const rows = await db
      .select()
      .from(branches)
      .where(eq(branches.companyId, auth.company_id!))
      .orderBy(asc(branches.createdAt));
    return c.json(
      rows.map((r) => ({
        id: r.id,
        nama: r.nama,
        alamat: r.alamat,
        telepon: r.telepon,
        is_active: r.isActive,
      })),
    );
  })
  .post("/", requireRole("owner", "admin"), zValidator("json", CabangBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    // Cabang + meja bawaan dibuat atomik: bila seed gagal, pembuatan cabang ikut rollback.
    const row = await db.transaction(async (tx) => {
      const [b] = await tx
        .insert(branches)
        .values({
          companyId: auth.company_id!,
          nama: body.nama,
          alamat: body.alamat ?? null,
          telepon: body.telepon ?? null,
        })
        .onConflictDoNothing()
        .returning();
      if (!b) throw new HTTPException(409, { message: `Cabang "${body.nama}" sudah ada` });
      // Meja bawaan (Ruang Tunggu + Meja 1) supaya usaha take away langsung bisa jualan.
      await seedMejaDefault(tx, auth.company_id!, b.id);
      return b;
    });
    return c.json({ id: row.id, nama: row.nama }, 201);
  })
  .patch(
    "/:id",
    requireRole("owner", "admin"),
    zValidator("json", CabangBody.partial()),
    async (c) => {
      const auth = c.get("auth");
      const body = c.req.valid("json");
      const [row] = await db
        .update(branches)
        .set({
          ...(body.nama !== undefined && { nama: body.nama }),
          ...(body.alamat !== undefined && { alamat: body.alamat }),
          ...(body.telepon !== undefined && { telepon: body.telepon }),
          ...(body.is_active !== undefined && { isActive: body.is_active }),
        })
        .where(
          and(eq(branches.id, c.req.param("id")), eq(branches.companyId, auth.company_id!)),
        )
        .returning();
      if (!row) throw new HTTPException(404, { message: "Cabang tidak ditemukan" });
      return c.json({ ok: true });
    },
  );

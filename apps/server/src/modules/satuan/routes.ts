import { zValidator } from "@hono/zod-validator";
import { and, asc, count, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { db } from "../../db/client";
import { ingredients, units } from "../../db/schema";
import { requireRole, type AppEnv } from "../../middleware/auth";

const SatuanBody = z.object({
  nama: z.string().trim().min(1).max(20),
  sort_order: z.number().int().default(0),
});

// PATCH parsial tanpa .default() — lihat catatan BahanPatchBody (zod v4).
const SatuanPatchBody = z.object({
  nama: z.string().trim().min(1).max(20).optional(),
  sort_order: z.number().int().optional(),
});

/**
 * Master Satuan (units) per company: sumber pilihan dropdown satuan bahan.
 * Owner/admin. Satuan yang masih dipakai bahan (match nama) tak bisa dihapus.
 */
export const satuanRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const auth = c.get("auth");
    const rows = await db
      .select()
      .from(units)
      .where(eq(units.companyId, auth.company_id!))
      .orderBy(asc(units.sortOrder), asc(units.nama));
    return c.json(rows.map((r) => ({ id: r.id, nama: r.nama, sort_order: r.sortOrder })));
  })
  .post("/", requireRole("owner", "admin"), zValidator("json", SatuanBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const [row] = await db
      .insert(units)
      .values({ companyId: auth.company_id!, nama: body.nama, sortOrder: body.sort_order })
      .onConflictDoNothing()
      .returning();
    if (!row) throw new HTTPException(409, { message: "Satuan sudah ada" });
    return c.json({ id: row.id, nama: row.nama, sort_order: row.sortOrder }, 201);
  })
  .patch(
    "/:id",
    requireRole("owner", "admin"),
    zValidator("json", SatuanPatchBody),
    async (c) => {
      const auth = c.get("auth");
      const body = c.req.valid("json");
      const [row] = await db
        .update(units)
        .set({
          ...(body.nama !== undefined && { nama: body.nama }),
          ...(body.sort_order !== undefined && { sortOrder: body.sort_order }),
        })
        .where(and(eq(units.id, c.req.param("id")), eq(units.companyId, auth.company_id!)))
        .returning();
      if (!row) throw new HTTPException(404, { message: "Satuan tidak ditemukan" });
      return c.json({ id: row.id, nama: row.nama, sort_order: row.sortOrder });
    },
  )
  .delete("/:id", requireRole("owner", "admin"), async (c) => {
    const auth = c.get("auth");
    const id = c.req.param("id");
    // Ambil dulu (kepemilikan + nama utk cek pemakaian)
    const [milik] = await db
      .select({ nama: units.nama })
      .from(units)
      .where(and(eq(units.id, id), eq(units.companyId, auth.company_id!)));
    if (!milik) throw new HTTPException(404, { message: "Satuan tidak ditemukan" });
    // Satuan yang masih dipakai bahan tak boleh dihapus (satuan = teks di bahan).
    const [{ n }] = await db
      .select({ n: count() })
      .from(ingredients)
      .where(and(eq(ingredients.companyId, auth.company_id!), eq(ingredients.satuan, milik.nama)));
    if (n > 0) {
      throw new HTTPException(409, { message: `Satuan masih dipakai ${n} bahan` });
    }
    await db.delete(units).where(and(eq(units.id, id), eq(units.companyId, auth.company_id!)));
    return c.json({ ok: true });
  });

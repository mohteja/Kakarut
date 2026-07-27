import { zValidator } from "@hono/zod-validator";
import { and, asc, count, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { db } from "../../db/client";
import { menuCategories, menus } from "../../db/schema";
import { requireRole, type AppEnv } from "../../middleware/auth";

const KategoriBody = z.object({
  nama: z.string().trim().min(1),
  sort_order: z.number().int().default(0),
});

// PATCH parsial tanpa .default() — lihat catatan BahanPatchBody (zod v4).
const KategoriPatchBody = z.object({
  nama: z.string().trim().min(1).optional(),
  sort_order: z.number().int().optional(),
});

export const kategoriRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const auth = c.get("auth");
    const rows = await db
      .select()
      .from(menuCategories)
      .where(eq(menuCategories.companyId, auth.company_id!))
      // `id` sebagai pemutus seri — urutan harus sama persis tiap query agar
      // ETag daftar tidak berubah walau datanya tidak berubah.
      .orderBy(asc(menuCategories.sortOrder), asc(menuCategories.nama), asc(menuCategories.id));
    return c.json(
      rows.map((r) => ({ id: r.id, nama: r.nama, sort_order: r.sortOrder })),
    );
  })
  .post("/", requireRole("owner", "admin"), zValidator("json", KategoriBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const [row] = await db
      .insert(menuCategories)
      .values({
        companyId: auth.company_id!,
        nama: body.nama,
        sortOrder: body.sort_order,
      })
      .onConflictDoNothing()
      .returning();
    if (!row) throw new HTTPException(409, { message: "Kategori sudah ada" });
    return c.json({ id: row.id, nama: row.nama, sort_order: row.sortOrder }, 201);
  })
  .patch(
    "/:id",
    requireRole("owner", "admin"),
    zValidator("json", KategoriPatchBody),
    async (c) => {
      const auth = c.get("auth");
      const body = c.req.valid("json");
      const [row] = await db
        .update(menuCategories)
        .set({
          ...(body.nama !== undefined && { nama: body.nama }),
          ...(body.sort_order !== undefined && { sortOrder: body.sort_order }),
        })
        .where(
          and(
            eq(menuCategories.id, c.req.param("id")),
            eq(menuCategories.companyId, auth.company_id!),
          ),
        )
        .returning();
      if (!row) throw new HTTPException(404, { message: "Kategori tidak ditemukan" });
      return c.json({ id: row.id, nama: row.nama, sort_order: row.sortOrder });
    },
  )
  .delete("/:id", requireRole("owner", "admin"), async (c) => {
    const auth = c.get("auth");
    const id = c.req.param("id");
    // Kategori yang masih dipakai menu tak boleh dihapus (FK NOT NULL) — cegah
    // lebih dulu dengan pesan jelas.
    const [{ n }] = await db
      .select({ n: count() })
      .from(menus)
      .where(and(eq(menus.categoryId, id), eq(menus.companyId, auth.company_id!)));
    if (n > 0) {
      throw new HTTPException(409, { message: `Kategori masih dipakai ${n} menu` });
    }
    const [row] = await db
      .delete(menuCategories)
      .where(and(eq(menuCategories.id, id), eq(menuCategories.companyId, auth.company_id!)))
      .returning({ id: menuCategories.id });
    if (!row) throw new HTTPException(404, { message: "Kategori tidak ditemukan" });
    return c.json({ ok: true });
  });

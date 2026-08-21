import { zValidator } from "../../lib/validator";
import { and, asc, count, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { db } from "../../db/client";
import { ingredientCategories, ingredients } from "../../db/schema";
import { requireRole, type AppEnv } from "../../middleware/auth";
import { tanpaBentrok } from "../../lib/pg-galat";

const KategoriBody = z.object({
  nama: z.string().trim().min(1).max(30),
  sort_order: z.number().int().default(0),
});

// PATCH parsial tanpa .default() — lihat catatan BahanPatchBody (zod v4).
const KategoriPatchBody = z.object({
  nama: z.string().trim().min(1).max(30).optional(),
  sort_order: z.number().int().optional(),
});

/**
 * Master Kategori Bahan (ingredient_categories) per company: sumber pilihan
 * dropdown kategori bahan. Owner/admin. Kategori yang masih dipakai bahan
 * (match nama) tak bisa dihapus.
 */
export const kategoriBahanRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const auth = c.get("auth");
    const rows = await db
      .select()
      .from(ingredientCategories)
      .where(eq(ingredientCategories.companyId, auth.company_id!))
      .orderBy(
        asc(ingredientCategories.sortOrder),
        asc(ingredientCategories.nama),
      );
    return c.json(
      rows.map((r) => ({ id: r.id, nama: r.nama, sort_order: r.sortOrder })),
    );
  })
  .post(
    "/",
    requireRole("owner", "admin"),
    zValidator("json", KategoriBody),
    async (c) => {
      const auth = c.get("auth");
      const body = c.req.valid("json");
      // Case-insensitive: "Buah segar" & "buah segar" dianggap kategori yang sama.
      // Bila sudah ada (beda huruf pun), kembalikan yang ada — hindari duplikat.
      const [ada] = await db
        .select()
        .from(ingredientCategories)
        .where(
          and(
            eq(ingredientCategories.companyId, auth.company_id!),
            sql`lower(${ingredientCategories.nama}) = lower(${body.nama})`,
          ),
        );
      if (ada)
        return c.json({
          id: ada.id,
          nama: ada.nama,
          sort_order: ada.sortOrder,
        });
      const [row] = await db
        .insert(ingredientCategories)
        .values({
          companyId: auth.company_id!,
          nama: body.nama,
          sortOrder: body.sort_order,
        })
        .onConflictDoNothing()
        .returning();
      if (!row) throw new HTTPException(409, { message: "Kategori sudah ada" });
      return c.json(
        { id: row.id, nama: row.nama, sort_order: row.sortOrder },
        201,
      );
    },
  )
  .patch(
    "/:id",
    requireRole("owner", "admin"),
    zValidator("json", KategoriPatchBody),
    async (c) => {
      const auth = c.get("auth");
      const body = c.req.valid("json");
      const [row] = await tanpaBentrok("Nama kategori itu sudah dipakai", () =>
        db
          .update(ingredientCategories)
          .set({
            ...(body.nama !== undefined && { nama: body.nama }),
            ...(body.sort_order !== undefined && {
              sortOrder: body.sort_order,
            }),
          })
          .where(
            and(
              eq(ingredientCategories.id, c.req.param("id")),
              eq(ingredientCategories.companyId, auth.company_id!),
            ),
          )
          .returning(),
      );
      if (!row)
        throw new HTTPException(404, { message: "Kategori tidak ditemukan" });
      return c.json({ id: row.id, nama: row.nama, sort_order: row.sortOrder });
    },
  )
  .delete("/:id", requireRole("owner", "admin"), async (c) => {
    const auth = c.get("auth");
    const id = c.req.param("id");
    const [milik] = await db
      .select({ nama: ingredientCategories.nama })
      .from(ingredientCategories)
      .where(
        and(
          eq(ingredientCategories.id, id),
          eq(ingredientCategories.companyId, auth.company_id!),
        ),
      );
    if (!milik)
      throw new HTTPException(404, { message: "Kategori tidak ditemukan" });
    // Kategori yang masih dipakai bahan tak boleh dihapus (kategori = teks di bahan;
    // dicek case-insensitive agar beda huruf tetap terhitung).
    const [{ n }] = await db
      .select({ n: count() })
      .from(ingredients)
      .where(
        and(
          eq(ingredients.companyId, auth.company_id!),
          sql`lower(${ingredients.kategori}) = lower(${milik.nama})`,
        ),
      );
    if (n > 0) {
      throw new HTTPException(409, {
        message: `Kategori masih dipakai ${n} bahan`,
      });
    }
    await db
      .delete(ingredientCategories)
      .where(
        and(
          eq(ingredientCategories.id, id),
          eq(ingredientCategories.companyId, auth.company_id!),
        ),
      );
    return c.json({ ok: true });
  });

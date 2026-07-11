import { zValidator } from "@hono/zod-validator";
import { and, asc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { hargaPerUnit, type BahanDto } from "@kakarut/shared";
import { db } from "../../db/client";
import { ingredients, menuComponents, menus } from "../../db/schema";
import { requireRole, type AppEnv } from "../../middleware/auth";

const BahanBody = z.object({
  slug: z.string().trim().min(1).optional(),
  nama: z.string().trim().min(1),
  harga_beli: z.number().nonnegative(),
  isi: z.number().positive(),
  satuan: z.string().trim().min(1).max(20).default("pcs"),
  /** lacak stok saat membeli & menjual */
  track_stok: z.boolean().default(true),
  /** ambang batas stok minimum: saldo ≤ nilai ini → "menipis" (0 = rasio default) */
  stok_minimum: z.number().nonnegative().default(0),
  kategori: z.enum(["baso", "minuman", "lain"]).default("lain"),
  /** jalur pengadaan: produksi sendiri atau beli jadi */
  pengadaan: z.enum(["produksi", "beli"]).default("beli"),
  catatan: z.string().nullish(),
  is_packaging: z.boolean().default(false),
  is_complement: z.boolean().default(false),
});

function toDto(row: typeof ingredients.$inferSelect): BahanDto {
  return {
    id: row.id,
    slug: row.slug,
    nama: row.nama,
    harga_beli: row.hargaBeli,
    isi: row.isi,
    satuan: row.satuan,
    track_stok: row.trackStok,
    stok_minimum: row.stokMinimum,
    harga_per_unit: hargaPerUnit(row.hargaBeli, row.isi),
    kategori: row.kategori,
    pengadaan: row.pengadaan,
    catatan: row.catatan,
    is_packaging: row.isPackaging,
    is_complement: row.isComplement,
    is_active: row.isActive,
  };
}

export const bahanRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const auth = c.get("auth");
    const rows = await db
      .select()
      .from(ingredients)
      .where(and(eq(ingredients.companyId, auth.company_id!), eq(ingredients.isActive, true)))
      .orderBy(asc(ingredients.nama));
    return c.json(rows.map(toDto));
  })
  .post("/", requireRole("owner", "admin"), zValidator("json", BahanBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const slug =
      body.slug ?? body.nama.toLowerCase().trim().replace(/\s+/g, " ");
    const [existing] = await db
      .select({ id: ingredients.id })
      .from(ingredients)
      .where(
        and(eq(ingredients.companyId, auth.company_id!), eq(ingredients.slug, slug)),
      );
    if (existing) {
      throw new HTTPException(409, { message: `Bahan dengan slug "${slug}" sudah ada` });
    }
    const [row] = await db
      .insert(ingredients)
      .values({
        companyId: auth.company_id!,
        slug,
        nama: body.nama,
        hargaBeli: body.harga_beli,
        isi: body.isi,
        satuan: body.satuan,
        trackStok: body.track_stok,
        stokMinimum: body.stok_minimum,
        kategori: body.kategori,
        pengadaan: body.pengadaan,
        catatan: body.catatan ?? null,
        isPackaging: body.is_packaging,
        isComplement: body.is_complement,
      })
      .returning();
    return c.json(toDto(row), 201);
  })
  .put(
    "/:id",
    requireRole("owner", "admin"),
    zValidator("json", BahanBody.partial()),
    async (c) => {
      const auth = c.get("auth");
      const body = c.req.valid("json");
      const [row] = await db
        .update(ingredients)
        .set({
          ...(body.nama !== undefined && { nama: body.nama }),
          ...(body.harga_beli !== undefined && { hargaBeli: body.harga_beli }),
          ...(body.isi !== undefined && { isi: body.isi }),
          ...(body.satuan !== undefined && { satuan: body.satuan }),
          ...(body.track_stok !== undefined && { trackStok: body.track_stok }),
          ...(body.stok_minimum !== undefined && { stokMinimum: body.stok_minimum }),
          ...(body.kategori !== undefined && { kategori: body.kategori }),
          ...(body.pengadaan !== undefined && { pengadaan: body.pengadaan }),
          ...(body.catatan !== undefined && { catatan: body.catatan }),
          ...(body.is_packaging !== undefined && { isPackaging: body.is_packaging }),
          ...(body.is_complement !== undefined && { isComplement: body.is_complement }),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(ingredients.id, c.req.param("id")),
            eq(ingredients.companyId, auth.company_id!),
          ),
        )
        .returning();
      if (!row) throw new HTTPException(404, { message: "Bahan tidak ditemukan" });
      return c.json(toDto(row));
    },
  )
  .delete("/:id", requireRole("owner", "admin"), async (c) => {
    const auth = c.get("auth");
    const id = c.req.param("id");
    // Blokir bila masih dipakai menu aktif
    const used = await db
      .select({ nama: menus.nama })
      .from(menuComponents)
      .innerJoin(menus, eq(menuComponents.menuId, menus.id))
      .where(and(eq(menuComponents.ingredientId, id), eq(menus.isActive, true)))
      .limit(5);
    if (used.length > 0) {
      throw new HTTPException(409, {
        message: `Bahan masih dipakai menu aktif: ${used.map((u) => u.nama).join(", ")}`,
      });
    }
    const [row] = await db
      .update(ingredients)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(ingredients.id, id), eq(ingredients.companyId, auth.company_id!)))
      .returning();
    if (!row) throw new HTTPException(404, { message: "Bahan tidak ditemukan" });
    return c.json({ ok: true });
  });

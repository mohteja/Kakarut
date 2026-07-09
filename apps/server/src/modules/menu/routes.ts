import { zValidator } from "@hono/zod-validator";
import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { PANDUAN_MARKUP } from "@kakarut/shared";
import { db, type Tx } from "../../db/client";
import { ingredients, menuComponents, menus } from "../../db/schema";
import { requireRole, type AppEnv } from "../../middleware/auth";
import { loadKatalog, toMenuDto } from "./service";

const KomponenBody = z.object({
  ingredient_id: z.string().uuid(),
  qty: z.number().positive(),
});

const MenuBody = z.object({
  nama: z.string().trim().min(1),
  category_id: z.string().uuid(),
  tipe: z.enum(["regular", "paket"]).default("regular"),
  mult: z.number().nonnegative().nullish(),
  base_menu_id: z.string().uuid().nullish(),
  base_mult: z.number().nonnegative().nullish(),
  harga_jual: z.number().nonnegative(),
  image_url: z.string().nullish(),
  komponen: z.array(KomponenBody).default([]),
  is_active: z.boolean().default(true),
});

function validatePaket(body: z.infer<typeof MenuBody>) {
  if (body.tipe === "paket" && (!body.base_menu_id || body.base_mult == null)) {
    throw new HTTPException(400, {
      message: "Menu paket wajib punya menu dasar (base_menu_id) dan base_mult",
    });
  }
  if (body.tipe === "regular" && body.mult == null) {
    throw new HTTPException(400, { message: "Menu reguler wajib punya mult (markup)" });
  }
}

/** Semua referensi (bahan komponen, menu dasar) harus milik perusahaan pemanggil. */
async function validateRefs(
  companyId: string,
  body: z.infer<typeof MenuBody>,
  selfId?: string,
) {
  const ids = [...new Set(body.komponen.map((k) => k.ingredient_id))];
  if (ids.length > 0) {
    const rows = await db
      .select({ id: ingredients.id })
      .from(ingredients)
      .where(and(eq(ingredients.companyId, companyId), inArray(ingredients.id, ids)));
    if (rows.length !== ids.length) {
      throw new HTTPException(400, { message: "Ada bahan yang tidak valid" });
    }
  }
  if (body.tipe === "paket" && body.base_menu_id) {
    if (selfId && body.base_menu_id === selfId) {
      throw new HTTPException(400, { message: "Menu dasar tidak boleh menu itu sendiri" });
    }
    const [base] = await db
      .select({ id: menus.id, tipe: menus.tipe })
      .from(menus)
      .where(and(eq(menus.id, body.base_menu_id), eq(menus.companyId, companyId)));
    if (!base || base.tipe !== "regular") {
      throw new HTTPException(400, {
        message: "Menu dasar harus menu reguler milik perusahaan Anda",
      });
    }
  }
}

async function replaceKomponen(
  tx: Tx,
  menuId: string,
  komponen: { ingredient_id: string; qty: number }[],
) {
  await tx.delete(menuComponents).where(eq(menuComponents.menuId, menuId));
  if (komponen.length > 0) {
    // gabungkan bahan duplikat dengan menjumlah qty
    const byIngredient = new Map<string, number>();
    for (const k of komponen) {
      byIngredient.set(k.ingredient_id, (byIngredient.get(k.ingredient_id) ?? 0) + k.qty);
    }
    await tx.insert(menuComponents).values(
      [...byIngredient].map(([ingredientId, qty]) => ({ menuId, ingredientId, qty })),
    );
  }
}

export const menuRoutes = new Hono<AppEnv>()
  .get("/panduan-markup", (c) => c.json(PANDUAN_MARKUP))
  .get("/", async (c) => {
    const auth = c.get("auth");
    const katalog = await loadKatalog(db, auth.company_id!);
    const kategoriFilter = c.req.query("kategori_id");
    const includeInactive = c.req.query("semua") === "true";
    const dtos = katalog.rows
      .filter((r) => (includeInactive ? true : r.isActive))
      .filter((r) => (kategoriFilter ? r.categoryId === kategoriFilter : true))
      .map((r) => toMenuDto(r, katalog));
    return c.json(dtos);
  })
  .get("/:id", async (c) => {
    const auth = c.get("auth");
    const katalog = await loadKatalog(db, auth.company_id!);
    const row = katalog.rows.find((r) => r.id === c.req.param("id"));
    if (!row) throw new HTTPException(404, { message: "Menu tidak ditemukan" });
    return c.json(toMenuDto(row, katalog));
  })
  .post("/", requireRole("owner", "admin"), zValidator("json", MenuBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    validatePaket(body);
    await validateRefs(auth.company_id!, body);
    const row = await db.transaction(async (tx) => {
      const [menu] = await tx
        .insert(menus)
        .values({
          companyId: auth.company_id!,
          categoryId: body.category_id,
          nama: body.nama,
          tipe: body.tipe,
          mult: body.tipe === "regular" ? body.mult : null,
          baseMenuId: body.tipe === "paket" ? body.base_menu_id : null,
          baseMult: body.tipe === "paket" ? body.base_mult : null,
          hargaJual: body.harga_jual,
          imageUrl: body.image_url ?? null,
          isActive: body.is_active,
        })
        .onConflictDoNothing()
        .returning();
      if (!menu) throw new HTTPException(409, { message: `Menu "${body.nama}" sudah ada` });
      await replaceKomponen(tx, menu.id, body.komponen);
      return menu;
    });
    const katalog = await loadKatalog(db, auth.company_id!);
    return c.json(toMenuDto(katalog.rows.find((r) => r.id === row.id)!, katalog), 201);
  })
  .put(
    "/:id",
    requireRole("owner", "admin"),
    zValidator("json", MenuBody),
    async (c) => {
      const auth = c.get("auth");
      const body = c.req.valid("json");
      validatePaket(body);
      await validateRefs(auth.company_id!, body, c.req.param("id"));
      const row = await db.transaction(async (tx) => {
        const [menu] = await tx
          .update(menus)
          .set({
            categoryId: body.category_id,
            nama: body.nama,
            tipe: body.tipe,
            mult: body.tipe === "regular" ? body.mult : null,
            baseMenuId: body.tipe === "paket" ? body.base_menu_id : null,
            baseMult: body.tipe === "paket" ? body.base_mult : null,
            hargaJual: body.harga_jual,
            imageUrl: body.image_url ?? null,
            isActive: body.is_active,
            updatedAt: new Date(),
          })
          .where(
            and(eq(menus.id, c.req.param("id")), eq(menus.companyId, auth.company_id!)),
          )
          .returning();
        if (!menu) throw new HTTPException(404, { message: "Menu tidak ditemukan" });
        await replaceKomponen(tx, menu.id, body.komponen);
        return menu;
      });
      const katalog = await loadKatalog(db, auth.company_id!);
      return c.json(toMenuDto(katalog.rows.find((r) => r.id === row.id)!, katalog));
    },
  )
  .delete("/:id", requireRole("owner", "admin"), async (c) => {
    const auth = c.get("auth");
    // Soft delete — histori penjualan tetap merujuk menu ini
    const [row] = await db
      .update(menus)
      .set({ isActive: false, updatedAt: new Date() })
      .where(
        and(eq(menus.id, c.req.param("id")), eq(menus.companyId, auth.company_id!)),
      )
      .returning();
    if (!row) throw new HTTPException(404, { message: "Menu tidak ditemukan" });
    return c.json({ ok: true });
  });

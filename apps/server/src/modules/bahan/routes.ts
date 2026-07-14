import { zValidator } from "@hono/zod-validator";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { hargaPerUnit, type BahanDto, type BahanResepRow } from "@kakarut/shared";
import { db } from "../../db/client";
import {
  ingredientComponents,
  ingredients,
  menuComponents,
  menus,
  productions,
} from "../../db/schema";
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
  /** boleh dibeli eceran per pcs; false = pembulatan per kemasan `isi` (jalur beli) */
  boleh_eceran: z.boolean().default(false),
  /** minimal belanja (MOQ) saat belanja otomatis; 0 = tanpa minimum */
  min_beli: z.number().nonnegative().default(0),
});

/**
 * Body PUT parsial TANPA .default(): di zod v4, .partial() atas field
 * ber-default MENGISI default untuk key yang absen — PUT parsial diam-diam
 * me-reset kolom (mis. satuan kembali "pcs"). Semua field opsional murni.
 */
const BahanPatchBody = z.object({
  slug: z.string().trim().min(1).optional(),
  nama: z.string().trim().min(1).optional(),
  harga_beli: z.number().nonnegative().optional(),
  isi: z.number().positive().optional(),
  satuan: z.string().trim().min(1).max(20).optional(),
  track_stok: z.boolean().optional(),
  stok_minimum: z.number().nonnegative().optional(),
  kategori: z.enum(["baso", "minuman", "lain"]).optional(),
  pengadaan: z.enum(["produksi", "beli"]).optional(),
  catatan: z.string().nullish(),
  is_packaging: z.boolean().optional(),
  is_complement: z.boolean().optional(),
  boleh_eceran: z.boolean().optional(),
  min_beli: z.number().nonnegative().optional(),
});

const ResepBody = z.object({
  komponen: z
    .array(z.object({ ingredient_id: z.string().uuid(), qty: z.number().positive() }))
    .default([]),
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
    boleh_eceran: row.bolehEceran,
    min_beli: row.minBeli,
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
        bolehEceran: body.boleh_eceran,
        minBeli: body.min_beli,
      })
      .returning();
    return c.json(toDto(row), 201);
  })
  .put(
    "/:id",
    requireRole("owner", "admin"),
    zValidator("json", BahanPatchBody),
    async (c) => {
      const auth = c.get("auth");
      const body = c.req.valid("json");
      const id = c.req.param("id");
      // Kepemilikan dicek DULU (404) agar guard di bawah tak jadi oracle
      // lintas-tenant; sekalian ambil nilai lama utk deteksi perubahan.
      const [lama] = await db
        .select({ isi: ingredients.isi, pengadaan: ingredients.pengadaan })
        .from(ingredients)
        .where(and(eq(ingredients.id, id), eq(ingredients.companyId, auth.company_id!)));
      if (!lama) throw new HTTPException(404, { message: "Bahan tidak ditemukan" });
      // Bahan yang masih jadi INPUT resep aktif tak boleh berubah jenis ke
      // "produksi": input resep tervalidasi 'beli' — flip membuat rencana
      // melewatkan kebutuhannya diam-diam padahal konsumsi tetap berjalan.
      if (body.pengadaan === "produksi" && lama.pengadaan !== "produksi") {
        const dipakai = await db
          .select({ nama: ingredients.nama })
          .from(ingredientComponents)
          .innerJoin(ingredients, eq(ingredientComponents.ingredientId, ingredients.id))
          .where(
            and(
              eq(ingredientComponents.inputIngredientId, id),
              eq(ingredients.isActive, true),
            ),
          )
          .limit(5);
        if (dipakai.length > 0) {
          throw new HTTPException(409, {
            message: `Bahan masih dipakai resep produksi: ${dipakai
              .map((d) => d.nama)
              .join(", ")} — keluarkan dari resep dulu`,
          });
        }
      }
      // Konsumsi bahan resep memakai `isi` LIVE saat produksi selesai —
      // mengubahnya di tengah produksi berjalan membuat konsumsi melenceng
      // dari RAB yang sudah dihitung. Selesaikan produksinya dulu.
      if (
        body.isi !== undefined &&
        Math.abs(body.isi - lama.isi) > 1e-9 &&
        (body.pengadaan ?? lama.pengadaan) === "produksi"
      ) {
        const [berjalan] = await db
          .select({ id: productions.id })
          .from(productions)
          .where(
            and(
              eq(productions.ingredientId, id),
              eq(productions.tipe, "produksi"),
              inArray(productions.status, ["rencana", "dikerjakan"]),
              isNull(productions.deletedAt),
            ),
          )
          .limit(1);
        if (berjalan) {
          throw new HTTPException(409, {
            message:
              "Isi per batch tidak bisa diubah saat masih ada produksi berjalan — selesaikan produksinya dulu",
          });
        }
      }
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
          ...(body.boleh_eceran !== undefined && { bolehEceran: body.boleh_eceran }),
          ...(body.min_beli !== undefined && { minBeli: body.min_beli }),
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
      // pindah jalur ke "beli" → resep produksinya tak relevan lagi, bersihkan
      if (body.pengadaan === "beli") {
        await db
          .delete(ingredientComponents)
          .where(eq(ingredientComponents.ingredientId, row.id));
      }
      return c.json(toDto(row));
    },
  )
  /**
   * RESEP PRODUKSI (BOM) bahan jadi: kebutuhan bahan mentah per 1 batch (isi).
   * GET terbuka utk semua peran (dipakai tampilan); PUT owner/admin.
   */
  .get("/:id/resep", async (c) => {
    const auth = c.get("auth");
    const id = c.req.param("id");
    const [induk] = await db
      .select({ id: ingredients.id })
      .from(ingredients)
      .where(and(eq(ingredients.id, id), eq(ingredients.companyId, auth.company_id!)));
    if (!induk) throw new HTTPException(404, { message: "Bahan tidak ditemukan" });
    const input = alias(ingredients, "input_bahan");
    const rows = await db
      .select({
        ingredientId: ingredientComponents.inputIngredientId,
        nama: input.nama,
        satuan: input.satuan,
        qty: ingredientComponents.qty,
        hargaBeli: input.hargaBeli,
        isi: input.isi,
        trackStok: input.trackStok,
      })
      .from(ingredientComponents)
      .innerJoin(input, eq(input.id, ingredientComponents.inputIngredientId))
      .where(eq(ingredientComponents.ingredientId, id))
      .orderBy(asc(input.nama));
    const resep: BahanResepRow[] = rows.map((r) => ({
      ingredient_id: r.ingredientId,
      nama: r.nama,
      satuan: r.satuan,
      qty: r.qty,
      harga_per_unit: hargaPerUnit(r.hargaBeli, r.isi),
      track_stok: r.trackStok,
    }));
    return c.json(resep);
  })
  .put(
    "/:id/resep",
    requireRole("owner", "admin"),
    zValidator("json", ResepBody),
    async (c) => {
      const auth = c.get("auth");
      const id = c.req.param("id");
      const body = c.req.valid("json");
      const [induk] = await db
        .select({ id: ingredients.id, pengadaan: ingredients.pengadaan })
        .from(ingredients)
        .where(and(eq(ingredients.id, id), eq(ingredients.companyId, auth.company_id!)));
      if (!induk) throw new HTTPException(404, { message: "Bahan tidak ditemukan" });
      if (induk.pengadaan !== "produksi") {
        throw new HTTPException(400, {
          message: "Resep hanya untuk bahan berjenis produksi",
        });
      }
      // gabungkan duplikat (qty dijumlah), tolak referensi diri sendiri
      const qtyByInput = new Map<string, number>();
      for (const k of body.komponen) {
        if (k.ingredient_id === id) {
          throw new HTTPException(400, { message: "Bahan tidak boleh memakai dirinya sendiri" });
        }
        qtyByInput.set(k.ingredient_id, (qtyByInput.get(k.ingredient_id) ?? 0) + k.qty);
      }
      const inputIds = [...qtyByInput.keys()];
      if (inputIds.length > 0) {
        // bahan mentah harus milik perusahaan, aktif, dan berjenis BELI —
        // resep berlapis (produksi dari produksi) belum didukung agar
        // ekspansi belanja & konsumsi tetap satu tingkat.
        const valid = await db
          .select({ id: ingredients.id, pengadaan: ingredients.pengadaan, nama: ingredients.nama })
          .from(ingredients)
          .where(
            and(
              eq(ingredients.companyId, auth.company_id!),
              eq(ingredients.isActive, true),
              inArray(ingredients.id, inputIds),
            ),
          );
        if (valid.length !== inputIds.length) {
          throw new HTTPException(400, { message: "Ada bahan mentah yang tidak valid" });
        }
        const bukanBeli = valid.filter((v) => v.pengadaan !== "beli");
        if (bukanBeli.length > 0) {
          throw new HTTPException(400, {
            message: `Bahan mentah resep harus berjenis beli: ${bukanBeli.map((v) => v.nama).join(", ")}`,
          });
        }
      }
      await db.transaction(async (tx) => {
        // Re-cek DI DALAM transaksi (kunci baris): PUT /bahan bisa flip
        // pengadaan ke "beli" di sela validasi di atas (TOCTOU) — tanpa ini
        // resep yatim tertulis utk bahan non-produksi. FOR UPDATE menahan
        // flip paralel sampai transaksi ini selesai.
        const [indukTx] = await tx
          .select({ pengadaan: ingredients.pengadaan })
          .from(ingredients)
          .where(and(eq(ingredients.id, id), eq(ingredients.companyId, auth.company_id!)))
          .for("update");
        if (indukTx?.pengadaan !== "produksi") {
          throw new HTTPException(409, {
            message: "Jenis pengadaan bahan berubah — muat ulang lalu coba lagi",
          });
        }
        await tx.delete(ingredientComponents).where(eq(ingredientComponents.ingredientId, id));
        if (inputIds.length > 0) {
          await tx.insert(ingredientComponents).values(
            [...qtyByInput].map(([inputIngredientId, qty]) => ({
              ingredientId: id,
              inputIngredientId,
              qty,
            })),
          );
        }
      });
      return c.json({ ok: true, jumlah: inputIds.length });
    },
  )
  .delete("/:id", requireRole("owner", "admin"), async (c) => {
    const auth = c.get("auth");
    const id = c.req.param("id");
    // Kepemilikan dicek DULU (404): guard "masih dipakai" di bawah tanpa cek
    // ini menjadi oracle lintas-tenant (bocor nama menu/bahan tenant lain).
    const [milik] = await db
      .select({ id: ingredients.id })
      .from(ingredients)
      .where(and(eq(ingredients.id, id), eq(ingredients.companyId, auth.company_id!)));
    if (!milik) throw new HTTPException(404, { message: "Bahan tidak ditemukan" });
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
    // Blokir bila masih dipakai resep produksi bahan lain yang aktif
    const dipakaiResep = await db
      .select({ nama: ingredients.nama })
      .from(ingredientComponents)
      .innerJoin(ingredients, eq(ingredientComponents.ingredientId, ingredients.id))
      .where(
        and(eq(ingredientComponents.inputIngredientId, id), eq(ingredients.isActive, true)),
      )
      .limit(5);
    if (dipakaiResep.length > 0) {
      throw new HTTPException(409, {
        message: `Bahan masih dipakai resep produksi: ${dipakaiResep.map((u) => u.nama).join(", ")}`,
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

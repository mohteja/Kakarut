import { zValidator } from "@hono/zod-validator";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { db } from "../../db/client";
import { companies, ingredients, productions } from "../../db/schema";
import { pastikanCabang, resolveBranchId, type AppEnv } from "../../middleware/auth";
import { tanggalDi } from "../../lib/time";

const ProduksiBody = z
  .object({
    branch_id: z.string().uuid().optional(),
    ingredient_id: z.string().uuid(),
    qty: z.number().positive().optional(),
    /** true = "produksi 1 batch" → qty otomatis = isi bahan saat ini */
    batch: z.boolean().default(false),
    catatan: z.string().nullish(),
  })
  .refine((v) => v.batch || v.qty != null, {
    message: "Isi qty, atau set batch=true",
  });

export const produksiRoutes = new Hono<AppEnv>()
  .post("/", zValidator("json", ProduksiBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const branchId = body.branch_id
      ? await pastikanCabang(body.branch_id, auth.company_id!)
      : await resolveBranchId(c);
    if (auth.role === "cashier" && branchId !== auth.branch_id) {
      throw new HTTPException(403, { message: "Kasir hanya boleh input produksi cabangnya" });
    }

    const [ing] = await db
      .select()
      .from(ingredients)
      .where(
        and(
          eq(ingredients.id, body.ingredient_id),
          eq(ingredients.companyId, auth.company_id!),
        ),
      );
    if (!ing) throw new HTTPException(404, { message: "Bahan tidak ditemukan" });

    const [company] = await db
      .select({ timezone: companies.timezone })
      .from(companies)
      .where(eq(companies.id, auth.company_id!));

    const qty = body.batch ? ing.isi : body.qty!;
    const [row] = await db
      .insert(productions)
      .values({
        companyId: auth.company_id!,
        branchId,
        ingredientId: ing.id,
        qty,
        isBatch: body.batch,
        catatan: body.catatan ?? null,
        userId: auth.sub,
        prodDate: tanggalDi(company?.timezone ?? "Asia/Jakarta"),
      })
      .returning();
    return c.json({ ...row, bahan: ing.nama }, 201);
  })
  .get("/", async (c) => {
    const auth = c.get("auth");
    const branchId = await resolveBranchId(c);
    const tanggal = c.req.query("tanggal");
    const conds = [
      eq(productions.companyId, auth.company_id!),
      eq(productions.branchId, branchId),
    ];
    if (tanggal) conds.push(eq(productions.prodDate, tanggal));
    const rows = await db
      .select({
        id: productions.id,
        ingredient_id: productions.ingredientId,
        bahan: ingredients.nama,
        qty: productions.qty,
        is_batch: productions.isBatch,
        catatan: productions.catatan,
        waktu: productions.waktu,
        prod_date: productions.prodDate,
      })
      .from(productions)
      .innerJoin(ingredients, eq(productions.ingredientId, ingredients.id))
      .where(and(...conds))
      .orderBy(desc(productions.waktu))
      .limit(200);
    return c.json(rows);
  });

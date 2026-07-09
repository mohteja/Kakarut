import { zValidator } from "@hono/zod-validator";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../../db/client";
import { companies, ingredients, stockOpnames } from "../../db/schema";
import { pastikanCabang, requireRole, resolveBranchId, type AppEnv } from "../../middleware/auth";
import { tanggalDi } from "../../lib/time";
import { hitungSaldoCabang } from "./service";

const OpnameBody = z.object({
  branch_id: z.string().uuid().optional(),
  catatan: z.string().nullish(),
  items: z
    .array(
      z.object({
        ingredient_id: z.string().uuid(),
        qty: z.number().min(0),
      }),
    )
    .min(1),
});

export const stokRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const auth = c.get("auth");
    const branchId = await resolveBranchId(c);
    return c.json(await hitungSaldoCabang(auth.company_id!, branchId));
  })
  .post(
    "/opname",
    requireRole("owner", "admin"),
    zValidator("json", OpnameBody),
    async (c) => {
      const auth = c.get("auth");
      const body = c.req.valid("json");
      const branchId = body.branch_id
        ? await pastikanCabang(body.branch_id, auth.company_id!)
        : await resolveBranchId(c);

      const [company] = await db
        .select({ timezone: companies.timezone })
        .from(companies)
        .where(eq(companies.id, auth.company_id!));
      const today = tanggalDi(company?.timezone ?? "Asia/Jakarta");

      const rows = await db
        .insert(stockOpnames)
        .values(
          body.items.map((item) => ({
            companyId: auth.company_id!,
            branchId,
            ingredientId: item.ingredient_id,
            qty: item.qty,
            opnameDate: today,
            catatan: body.catatan ?? null,
            userId: auth.sub,
          })),
        )
        .returning();
      return c.json({ ok: true, jumlah: rows.length }, 201);
    },
  )
  .get("/opname", async (c) => {
    const auth = c.get("auth");
    const branchId = await resolveBranchId(c);
    const rows = await db
      .select({
        id: stockOpnames.id,
        ingredient_id: stockOpnames.ingredientId,
        bahan: ingredients.nama,
        qty: stockOpnames.qty,
        opname_date: stockOpnames.opnameDate,
        catatan: stockOpnames.catatan,
        created_at: stockOpnames.createdAt,
      })
      .from(stockOpnames)
      .innerJoin(ingredients, eq(stockOpnames.ingredientId, ingredients.id))
      .where(
        and(eq(stockOpnames.companyId, auth.company_id!), eq(stockOpnames.branchId, branchId)),
      )
      .orderBy(desc(stockOpnames.createdAt))
      .limit(200);
    return c.json(rows);
  });

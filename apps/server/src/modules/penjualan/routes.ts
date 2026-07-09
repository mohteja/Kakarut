import { zValidator } from "@hono/zod-validator";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { db } from "../../db/client";
import { companies, saleItems, sales } from "../../db/schema";
import { requireRole, resolveBranchId, type AppEnv } from "../../middleware/auth";
import { tanggalDi } from "../../lib/time";
import { createSale } from "./service";

const SaleBody = z.object({
  branch_id: z.string().uuid().optional(),
  is_dine_in: z.boolean().default(false),
  catatan: z.string().nullish(),
  items: z
    .array(
      z.object({
        menu_id: z.string().uuid(),
        qty: z.number().positive(),
        is_dine_in: z.boolean().optional(),
      }),
    )
    .min(1),
});

export const penjualanRoutes = new Hono<AppEnv>()
  .post("/", zValidator("json", SaleBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const branchId = body.branch_id ?? (await resolveBranchId(c));
    if (auth.role === "cashier" && branchId !== auth.branch_id) {
      throw new HTTPException(403, { message: "Kasir hanya boleh transaksi di cabangnya" });
    }
    const result = await createSale({
      companyId: auth.company_id!,
      branchId,
      cashierUserId: auth.sub,
      isDineIn: body.is_dine_in,
      catatan: body.catatan,
      items: body.items,
    });
    return c.json(result, 201);
  })
  .get("/", async (c) => {
    const auth = c.get("auth");
    const branchId = await resolveBranchId(c);
    const [company] = await db
      .select({ timezone: companies.timezone })
      .from(companies)
      .where(eq(companies.id, auth.company_id!));
    const tanggal = c.req.query("tanggal") ?? tanggalDi(company?.timezone ?? "Asia/Jakarta");
    const rows = await db
      .select()
      .from(sales)
      .where(
        and(
          eq(sales.companyId, auth.company_id!),
          eq(sales.branchId, branchId),
          eq(sales.saleDate, tanggal),
        ),
      )
      .orderBy(desc(sales.waktu));
    return c.json(rows);
  })
  .get("/:id", async (c) => {
    const auth = c.get("auth");
    const [sale] = await db
      .select()
      .from(sales)
      .where(
        and(eq(sales.id, c.req.param("id")), eq(sales.companyId, auth.company_id!)),
      );
    if (!sale) throw new HTTPException(404, { message: "Transaksi tidak ditemukan" });
    const items = await db.select().from(saleItems).where(eq(saleItems.saleId, sale.id));
    return c.json({ sale, items });
  })
  .delete("/:id", requireRole("owner", "admin"), async (c) => {
    const auth = c.get("auth");
    // Void transaksi: cascade menghapus item + konsumsi → saldo stok pulih
    const [row] = await db
      .delete(sales)
      .where(
        and(eq(sales.id, c.req.param("id")), eq(sales.companyId, auth.company_id!)),
      )
      .returning();
    if (!row) throw new HTTPException(404, { message: "Transaksi tidak ditemukan" });
    return c.json({ ok: true, nomor: row.nomor });
  });

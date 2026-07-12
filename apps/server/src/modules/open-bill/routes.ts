import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { OpenBillDetail, OpenBillRow } from "@kakarut/shared";
import { db, type Tx } from "../../db/client";
import { meja, menuBranches, menus, openBillItems, openBills } from "../../db/schema";
import { resolveBranchId, type AppEnv } from "../../middleware/auth";

const BillBody = z.object({
  branch_id: z.string().uuid().optional(),
  meja_id: z.string().uuid().nullish(),
  customer_nama: z.string().nullish(),
  customer_wa: z.string().nullish(),
  catatan: z.string().nullish(),
  items: z
    .array(
      z.object({
        menu_id: z.string().uuid(),
        qty: z.number().positive(),
        dine_in_override: z.boolean().nullish(),
        catatan: z.string().nullish(),
      }),
    )
    .min(1),
});

/** Pastikan semua menu milik perusahaan pemanggil & tersedia di cabang bill. */
async function validateMenus(companyId: string, branchId: string, items: { menu_id: string }[]) {
  const ids = [...new Set(items.map((i) => i.menu_id))];
  const rows = await db
    .select({ id: menus.id, nama: menus.nama })
    .from(menus)
    .where(and(eq(menus.companyId, companyId), inArray(menus.id, ids)));
  if (rows.length !== ids.length) {
    throw new HTTPException(400, { message: "Ada menu yang tidak valid" });
  }
  // Pembatasan lokasi: tanpa baris = semua cabang; ada baris = whitelist.
  const batasan = await db
    .select({ menuId: menuBranches.menuId, branchId: menuBranches.branchId })
    .from(menuBranches)
    .where(inArray(menuBranches.menuId, ids));
  const cabangByMenu = new Map<string, string[]>();
  for (const b of batasan) {
    const list = cabangByMenu.get(b.menuId) ?? [];
    list.push(b.branchId);
    cabangByMenu.set(b.menuId, list);
  }
  for (const r of rows) {
    const cabang = cabangByMenu.get(r.id);
    if (cabang && !cabang.includes(branchId)) {
      throw new HTTPException(400, { message: `Menu "${r.nama}" tidak tersedia di cabang ini` });
    }
  }
}

/** Resolusi meja → label snapshot (validasi milik cabang). */
async function resolveMeja(companyId: string, branchId: string, mejaId?: string | null) {
  if (!mejaId) return { mejaId: null as string | null, mejaLabel: null as string | null };
  const [m] = await db
    .select({ id: meja.id, nama: meja.nama })
    .from(meja)
    .where(and(eq(meja.id, mejaId), eq(meja.companyId, companyId), eq(meja.branchId, branchId)));
  if (!m) throw new HTTPException(404, { message: "Meja tidak ditemukan" });
  return { mejaId: m.id, mejaLabel: m.nama };
}

async function loadDetail(companyId: string, id: string): Promise<OpenBillDetail | null> {
  const [bill] = await db.select().from(openBills).where(eq(openBills.id, id));
  if (!bill || bill.companyId !== companyId) return null;
  const items = await db.select().from(openBillItems).where(eq(openBillItems.billId, id));
  return {
    id: bill.id,
    meja_id: bill.mejaId,
    meja_label: bill.mejaLabel,
    customer_nama: bill.customerNama,
    customer_wa: bill.customerWa,
    catatan: bill.catatan,
    items: items.map((it) => ({
      menu_id: it.menuId,
      qty: it.qty,
      dine_in_override: it.dineInOverride,
      catatan: it.catatan,
    })),
  };
}

async function insertItems(tx: Tx, billId: string, items: z.infer<typeof BillBody>["items"]) {
  await tx.insert(openBillItems).values(
    items.map((it) => ({
      billId,
      menuId: it.menu_id,
      qty: it.qty,
      dineInOverride: it.dine_in_override ?? null,
      catatan: it.catatan?.trim() || null,
    })),
  );
}

export const openBillRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const auth = c.get("auth");
    const branchId = await resolveBranchId(c);
    const rows = await db
      .select({
        id: openBills.id,
        meja_label: openBills.mejaLabel,
        customer_nama: openBills.customerNama,
        waktu: openBills.updatedAt,
        jumlah_item: sql<number>`COUNT(${openBillItems.id})::int`,
      })
      .from(openBills)
      .leftJoin(openBillItems, eq(openBillItems.billId, openBills.id))
      .where(and(eq(openBills.companyId, auth.company_id!), eq(openBills.branchId, branchId)))
      .groupBy(openBills.id)
      .orderBy(desc(openBills.updatedAt));
    const dto: OpenBillRow[] = rows.map((r) => ({
      id: r.id,
      meja_label: r.meja_label,
      customer_nama: r.customer_nama,
      jumlah_item: r.jumlah_item,
      waktu: (r.waktu as Date).toISOString(),
    }));
    return c.json(dto);
  })
  .get("/:id", async (c) => {
    const auth = c.get("auth");
    const detail = await loadDetail(auth.company_id!, c.req.param("id"));
    if (!detail) throw new HTTPException(404, { message: "Bill tidak ditemukan" });
    return c.json(detail);
  })
  .post("/", zValidator("json", BillBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const branchId = body.branch_id ?? (await resolveBranchId(c));
    if (auth.role === "cashier" && branchId !== auth.branch_id) {
      throw new HTTPException(403, { message: "Kasir hanya boleh bill di cabangnya" });
    }
    await validateMenus(auth.company_id!, branchId, body.items);
    const { mejaId, mejaLabel } = await resolveMeja(auth.company_id!, branchId, body.meja_id);
    const id = await db.transaction(async (tx) => {
      const [bill] = await tx
        .insert(openBills)
        .values({
          companyId: auth.company_id!,
          branchId,
          mejaId,
          mejaLabel,
          customerNama: body.customer_nama?.trim() || null,
          customerWa: body.customer_wa?.trim() || null,
          catatan: body.catatan?.trim() || null,
          createdBy: auth.sub,
        })
        .returning({ id: openBills.id });
      await insertItems(tx, bill.id, body.items);
      return bill.id;
    });
    return c.json(await loadDetail(auth.company_id!, id), 201);
  })
  .put("/:id", zValidator("json", BillBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const id = c.req.param("id");
    const [existing] = await db.select().from(openBills).where(eq(openBills.id, id));
    if (!existing || existing.companyId !== auth.company_id!) {
      throw new HTTPException(404, { message: "Bill tidak ditemukan" });
    }
    await validateMenus(auth.company_id!, existing.branchId, body.items);
    const { mejaId, mejaLabel } = await resolveMeja(
      auth.company_id!,
      existing.branchId,
      body.meja_id,
    );
    await db.transaction(async (tx) => {
      await tx
        .update(openBills)
        .set({
          mejaId,
          mejaLabel,
          customerNama: body.customer_nama?.trim() || null,
          customerWa: body.customer_wa?.trim() || null,
          catatan: body.catatan?.trim() || null,
          updatedAt: new Date(),
        })
        .where(eq(openBills.id, id));
      await tx.delete(openBillItems).where(eq(openBillItems.billId, id));
      await insertItems(tx, id, body.items);
    });
    return c.json(await loadDetail(auth.company_id!, id));
  })
  .delete("/:id", async (c) => {
    const auth = c.get("auth");
    const [row] = await db
      .delete(openBills)
      .where(and(eq(openBills.id, c.req.param("id")), eq(openBills.companyId, auth.company_id!)))
      .returning({ id: openBills.id });
    if (!row) throw new HTTPException(404, { message: "Bill tidak ditemukan" });
    return c.json({ ok: true });
  });

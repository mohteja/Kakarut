import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { db } from "../../db/client";
import { branches, companies, saleItems, sales, users } from "../../db/schema";
import {
  requireRole,
  resolveBranchId,
  verifikasiPassword,
  type AppEnv,
} from "../../middleware/auth";
import { tanggalDi } from "../../lib/time";
import { createSale } from "./service";

const SaleBody = z.object({
  branch_id: z.string().uuid().optional(),
  is_dine_in: z.boolean().default(false),
  meja_id: z.string().uuid().optional(),
  catatan: z.string().nullish(),
  /** diskon per transaksi (opsional) */
  diskon_tipe: z.enum(["persen", "nominal"]).optional(),
  diskon_nilai: z.number().nonnegative().optional(),
  /** identitas konsumen/member (opsional) */
  customer_nama: z.string().nullish(),
  customer_wa: z.string().nullish(),
  /** pembayaran */
  metode_bayar: z.enum(["tunai", "qris", "transfer"]).optional(),
  uang_diterima: z.number().nonnegative().optional(),
  items: z
    .array(
      z.object({
        menu_id: z.string().uuid(),
        qty: z.number().positive(),
        is_dine_in: z.boolean().optional(),
        catatan: z.string().nullish(),
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
      mejaId: body.meja_id,
      catatan: body.catatan,
      diskonTipe: body.diskon_tipe,
      diskonNilai: body.diskon_nilai,
      bypassDiskonLimit: auth.role !== "cashier",
      customerNama: body.customer_nama,
      customerWa: body.customer_wa,
      metodeBayar: body.metode_bayar,
      uangDiterima: body.uang_diterima,
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
    // Riwayat transaksi untuk kasir: cek pesanan / cetak ulang struk.
    const rows = await db
      .select({
        id: sales.id,
        nomor: sales.nomor,
        waktu: sales.waktu,
        total: sales.total,
        is_dine_in: sales.isDineIn,
        meja: sales.mejaLabel,
        kasir: users.nama,
        konsumen: sales.customerNama,
        metode: sales.metodeBayar,
        jumlah_item: sql<number>`(SELECT COUNT(*)::int FROM sale_items si WHERE si.sale_id = ${sales.id})`,
      })
      .from(sales)
      .leftJoin(users, eq(sales.cashierUserId, users.id))
      .where(
        and(
          eq(sales.companyId, auth.company_id!),
          eq(sales.branchId, branchId),
          eq(sales.saleDate, tanggal),
          isNull(sales.deletedAt),
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
        and(
          eq(sales.id, c.req.param("id")),
          eq(sales.companyId, auth.company_id!),
          isNull(sales.deletedAt),
        ),
      );
    if (!sale) throw new HTTPException(404, { message: "Transaksi tidak ditemukan" });
    // Kasir hanya boleh melihat transaksi di cabangnya.
    if (auth.role === "cashier" && sale.branchId !== auth.branch_id) {
      throw new HTTPException(403, { message: "Kasir hanya boleh melihat transaksi cabangnya" });
    }
    const items = await db.select().from(saleItems).where(eq(saleItems.saleId, sale.id));
    const [branch] = await db
      .select({ nama: branches.nama })
      .from(branches)
      .where(eq(branches.id, sale.branchId));
    return c.json({ sale, items, branch_nama: branch?.nama ?? "" });
  })
  .delete(
    "/:id",
    requireRole("owner", "admin"),
    zValidator("json", z.object({ password: z.string() })),
    async (c) => {
      const auth = c.get("auth");
      await verifikasiPassword(auth.sub, c.req.valid("json").password);
      // Soft-delete → Tempat Sampah: baris & item/konsumsi tetap ada (audit),
      // saldo stok pulih karena semua agregasi memfilter deleted_at IS NULL.
      const [row] = await db
        .update(sales)
        .set({ deletedAt: new Date(), deletedBy: auth.sub })
        .where(
          and(
            eq(sales.id, c.req.param("id")),
            eq(sales.companyId, auth.company_id!),
            isNull(sales.deletedAt),
          ),
        )
        .returning();
      if (!row) throw new HTTPException(404, { message: "Transaksi tidak ditemukan" });
      return c.json({ ok: true, nomor: row.nomor });
  });

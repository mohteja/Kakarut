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
  terikatCabang,
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
  // Tim boleh melihat riwayat, tapi tidak boleh membuat transaksi
  .post("/", requireRole("owner", "admin", "cashier"), zValidator("json", SaleBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const branchId = body.branch_id ?? (await resolveBranchId(c));
    if (terikatCabang(auth.role) && branchId !== auth.branch_id) {
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
    return c.json({ ...result, kasir: auth.nama }, 201);
  })
  .get("/", async (c) => {
    const auth = c.get("auth");
    // Kantor = pusat data penjualan: owner/admin boleh "?branch_id=all" untuk
    // melihat transaksi SEMUA cabang sekaligus (kasir/tim tetap terkunci).
    const semuaCabang = !terikatCabang(auth.role) && c.req.query("branch_id") === "all";
    const branchId = semuaCabang ? null : await resolveBranchId(c);
    const [company] = await db
      .select({ timezone: companies.timezone })
      .from(companies)
      .where(eq(companies.id, auth.company_id!));
    const tanggalQ = c.req.query("tanggal");
    if (tanggalQ && !/^\d{4}-\d{2}-\d{2}$/.test(tanggalQ)) {
      throw new HTTPException(400, { message: "Format tanggal tidak valid (YYYY-MM-DD)" });
    }
    const tanggal = tanggalQ ?? tanggalDi(company?.timezone ?? "Asia/Jakarta");
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
        cabang: branches.nama,
        jumlah_item: sql<number>`(SELECT COUNT(*)::int FROM sale_items si WHERE si.sale_id = ${sales.id})`,
      })
      .from(sales)
      .leftJoin(users, eq(sales.cashierUserId, users.id))
      .leftJoin(branches, eq(sales.branchId, branches.id))
      .where(
        and(
          eq(sales.companyId, auth.company_id!),
          ...(branchId ? [eq(sales.branchId, branchId)] : []),
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
    if (terikatCabang(auth.role) && sale.branchId !== auth.branch_id) {
      throw new HTTPException(403, { message: "Kasir hanya boleh melihat transaksi cabangnya" });
    }
    const items = await db.select().from(saleItems).where(eq(saleItems.saleId, sale.id));
    const [branch] = await db
      .select({ nama: branches.nama })
      .from(branches)
      .where(eq(branches.id, sale.branchId));
    const [kasirUser] = await db
      .select({ nama: users.nama })
      .from(users)
      .where(eq(users.id, sale.cashierUserId));
    return c.json({ sale, items, branch_nama: branch?.nama ?? "", kasir: kasirUser?.nama ?? null });
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

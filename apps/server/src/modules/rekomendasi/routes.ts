import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { AcuanJenis } from "@kakarut/shared";
import { db } from "../../db/client";
import { companies } from "../../db/schema";
import { resolveBranchId, type AppEnv } from "../../middleware/auth";
import { buatFakturDariRencana, rencanaDariMenu } from "./rencana";
import { rekomendasiBeli } from "./service";

const RencanaBody = z.object({
  items: z
    .array(
      z.object({
        menu_id: z.string().uuid(),
        // batas atas wajar agar qty/harga faktur tak melampaui kapasitas kolom numeric
        porsi: z.number().int().positive().max(100_000),
      }),
    )
    .min(1),
});

const RencanaFakturBody = RencanaBody.extend({
  worker_id: z.string().uuid().nullish(),
  /** pelaksana produksi alternatif (bila bukan karyawan) */
  supplier_id: z.string().uuid().nullish(),
  /** pemasok barang faktur beli (terpisah dari pelaksana produksi) */
  supplier_beli_id: z.string().uuid().nullish(),
  /** work-order: cabang tujuan (store) yang butuh stok */
  tujuan_branch_id: z.string().uuid().nullish(),
  /** work-order: Central Kitchen pelaksana (auto dari pemasok store bila kosong) */
  ck_branch_id: z.string().uuid().nullish(),
  catatan: z.string().nullish(),
});

/**
 * Rekomendasi pembelian bahan baku dari target penjualan. Owner/admin (gerbang
 * peran dipasang di app.ts).
 */
export const rekomendasiRoutes = new Hono<AppEnv>().get("/beli", async (c) => {
  const auth = c.get("auth");
  const branchId = await resolveBranchId(c);

  const [company] = await db
    .select({ timezone: companies.timezone, target: companies.targetPenjualan })
    .from(companies)
    .where(eq(companies.id, auth.company_id!));
  const tz = company?.timezone ?? "Asia/Jakarta";

  const qTarget = c.req.query("target");
  const targetRaw = qTarget != null && qTarget !== "" ? Number(qTarget) : (company?.target ?? 0);
  const target = Number.isFinite(targetRaw) && targetRaw > 0 ? targetRaw : 0;

  const acuanQ = c.req.query("acuan");
  const acuan: AcuanJenis =
    acuanQ === "7hari" ? "7hari" : acuanQ === "rentang" ? "rentang" : "minggu_lalu";

  // terima hanya format tanggal YYYY-MM-DD; selain itu diabaikan (default hari ini)
  const tgl = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);

  const hasil = await rekomendasiBeli(auth.company_id!, branchId, tz, {
    target,
    acuan,
    dari: c.req.query("dari") ?? undefined,
    sampai: c.req.query("sampai") ?? undefined,
    pakaiDari: tgl(c.req.query("pakai_dari")),
    pakaiSampai: tgl(c.req.query("pakai_sampai")),
  });
  return c.json(hasil);
})
  // Preview rencana dari menu: target porsi per menu → kebutuhan/kurang bahan
  .post("/menu", zValidator("json", RencanaBody), async (c) => {
    const auth = c.get("auth");
    const branchId = await resolveBranchId(c);
    const preview = await rencanaDariMenu(auth.company_id!, branchId, c.req.valid("json").items);
    return c.json(preview);
  })
  // Permintaan tambah stok: terbitkan faktur produksi (work-order CK) + beli
  // otomatis untuk kekurangan rencana di cabang tujuan (store).
  .post("/menu/faktur", zValidator("json", RencanaFakturBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    // cabang tujuan = store yang butuh stok (default cabang aktif)
    const branchId = body.tujuan_branch_id ?? (await resolveBranchId(c));
    const hasil = await buatFakturDariRencana({
      companyId: auth.company_id!,
      branchId,
      ckBranchId: body.ck_branch_id,
      userId: auth.sub,
      items: body.items,
      workerId: body.worker_id,
      supplierId: body.supplier_id,
      supplierBeliId: body.supplier_beli_id,
      catatan: body.catatan,
    });
    return c.json(hasil, 201);
  });

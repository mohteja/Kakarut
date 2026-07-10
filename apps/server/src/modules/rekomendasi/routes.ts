import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { AcuanJenis } from "@kakarut/shared";
import { db } from "../../db/client";
import { companies } from "../../db/schema";
import { resolveBranchId, type AppEnv } from "../../middleware/auth";
import { rekomendasiBeli } from "./service";

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

  const hasil = await rekomendasiBeli(auth.company_id!, branchId, tz, {
    target,
    acuan,
    dari: c.req.query("dari") ?? undefined,
    sampai: c.req.query("sampai") ?? undefined,
  });
  return c.json(hasil);
});

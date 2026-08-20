import { zValidator } from "@hono/zod-validator";
import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { db } from "../../db/client";
import { branches, companies } from "../../db/schema";
import { requireRole, type AppEnv } from "../../middleware/auth";
import { seedMejaDefault } from "../meja/defaults";

/** Mode aplikasi diturunkan dari plan: 'pro' = multi-lokasi, selainnya Lite. */
export function modeDariPlan(plan: string): "lite" | "pro" {
  return plan === "pro" ? "pro" : "lite";
}

const PatchBody = z.object({
  nama: z.string().trim().min(1).optional(),
  alamat: z.string().nullish(),
  telepon: z.string().nullish(),
  logo_url: z.string().nullish(),
  pb1_enabled: z.boolean().optional(),
  pb1_rate: z.number().min(0).max(100).optional(),
  receipt_footer: z.string().trim().max(200).nullish(),
  receipt_show_alamat: z.boolean().optional(),
  target_penjualan: z.number().min(0).nullish(),
  /** batas maks diskon kasir (%) — 0..100 */
  diskon_maks_persen: z.number().min(0).max(100).optional(),
  /** tolak pesanan yang melebihi stok (bawaan mati) */
  blokir_jual_minus: z.boolean().optional(),
  /** metode HPP untuk laba-rugi */
  metode_hpp: z.enum(["average", "fifo"]).optional(),
  /** ambang food cost sehat (%) — menu di atasnya ditandai di daftar menu */
  food_cost_maks: z.number().min(0).max(100).optional(),
});

const ModeBody = z.object({ mode: z.enum(["lite", "pro"]) });

export const companyRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const auth = c.get("auth");
    const [row] = await db
      .select()
      .from(companies)
      .where(eq(companies.id, auth.company_id!));
    if (!row) throw new HTTPException(404, { message: "Perusahaan tidak ditemukan" });
    return c.json({ ...row, mode: modeDariPlan(row.plan) });
  })
  // Ganti mode Lite ↔ Pro. Upgrade ke Pro memprovisikan tata lokasi baku
  // (Central Kitchen + Cabang 2 + Kantor) SEKALI — idempoten via cek CK.
  .post("/mode", requireRole("owner"), zValidator("json", ModeBody), async (c) => {
    const auth = c.get("auth");
    const { mode } = c.req.valid("json");

    if (mode === "lite") {
      const aktif = await db
        .select({ id: branches.id })
        .from(branches)
        .where(and(eq(branches.companyId, auth.company_id!), eq(branches.isActive, true)));
      if (aktif.length > 1) {
        throw new HTTPException(400, {
          message: "Mode Lite hanya untuk 1 cabang aktif — nonaktifkan cabang lain dulu",
        });
      }
      await db
        .update(companies)
        .set({ plan: "lite", updatedAt: new Date() })
        .where(eq(companies.id, auth.company_id!));
      return c.json({ ok: true, mode: "lite", lokasi_baru: [] as string[] });
    }

    const lokasiBaru = await db.transaction(async (tx) => {
      await tx
        .update(companies)
        .set({ plan: "pro", updatedAt: new Date() })
        .where(eq(companies.id, auth.company_id!));
      const adaCk = await tx
        .select({ id: branches.id })
        .from(branches)
        .where(
          and(
            eq(branches.companyId, auth.company_id!),
            eq(branches.tipe, "central_kitchen"),
          ),
        );
      if (adaCk.length > 0) return [] as string[];
      // Tata lokasi baku Pro: cabang lama tetap jadi store pertama. CK dibuat
      // lebih dulu supaya setiap store terhubung ke SATU CK pemasoknya.
      const dibuat: string[] = [];
      const [ck] = await tx
        .insert(branches)
        .values({ companyId: auth.company_id!, nama: "Central Kitchen", tipe: "central_kitchen" })
        .onConflictDoNothing()
        .returning();
      if (ck) dibuat.push(ck.nama);
      const lokasi = [
        { nama: "Cabang 2", tipe: "store" as const, meja: true },
        { nama: "Kantor", tipe: "kantor" as const, meja: false },
      ];
      for (const l of lokasi) {
        const [b] = await tx
          .insert(branches)
          .values({
            companyId: auth.company_id!,
            nama: l.nama,
            tipe: l.tipe,
            centralKitchenId: l.tipe === "store" ? ck?.id ?? null : null,
          })
          .onConflictDoNothing()
          .returning();
        if (!b) continue; // nama sudah dipakai cabang lama — jangan duplikasi
        if (l.meja) await seedMejaDefault(tx, auth.company_id!, b.id);
        dibuat.push(b.nama);
      }
      // Store lama yang belum punya pemasok ikut terhubung ke CK baru.
      if (ck) {
        await tx
          .update(branches)
          .set({ centralKitchenId: ck.id })
          .where(
            and(
              eq(branches.companyId, auth.company_id!),
              eq(branches.tipe, "store"),
              isNull(branches.centralKitchenId),
            ),
          );
      }
      return dibuat;
    });
    return c.json({ ok: true, mode: "pro", lokasi_baru: lokasiBaru });
  })
  .patch("/", requireRole("owner", "admin"), zValidator("json", PatchBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const [row] = await db
      .update(companies)
      .set({
        ...(body.nama !== undefined && { nama: body.nama }),
        ...(body.alamat !== undefined && { alamat: body.alamat }),
        ...(body.telepon !== undefined && { telepon: body.telepon }),
        ...(body.logo_url !== undefined && { logoUrl: body.logo_url }),
        ...(body.pb1_enabled !== undefined && { pb1Enabled: body.pb1_enabled }),
        ...(body.pb1_rate !== undefined && { pb1Rate: body.pb1_rate }),
        ...(body.receipt_footer !== undefined && { receiptFooter: body.receipt_footer || null }),
        ...(body.receipt_show_alamat !== undefined && {
          receiptShowAlamat: body.receipt_show_alamat,
        }),
        ...(body.food_cost_maks !== undefined && { foodCostMaks: body.food_cost_maks }),
        ...(body.target_penjualan !== undefined && {
          targetPenjualan: body.target_penjualan,
        }),
        ...(body.blokir_jual_minus !== undefined && {
          blokirJualMinus: body.blokir_jual_minus,
        }),
        ...(body.diskon_maks_persen !== undefined && {
          diskonMaksPersen: body.diskon_maks_persen,
        }),
        ...(body.metode_hpp !== undefined && { metodeHpp: body.metode_hpp }),
        updatedAt: new Date(),
      })
      .where(eq(companies.id, auth.company_id!))
      .returning();
    return c.json(row);
  });

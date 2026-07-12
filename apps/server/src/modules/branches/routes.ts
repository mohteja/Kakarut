import { zValidator } from "@hono/zod-validator";
import { and, asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { db } from "../../db/client";
import { branches, companies } from "../../db/schema";
import { requireRole, type AppEnv } from "../../middleware/auth";
import { seedMejaDefault } from "../meja/defaults";

const CabangBody = z.object({
  nama: z.string().trim().min(1),
  alamat: z.string().nullish(),
  telepon: z.string().nullish(),
  /**
   * store = outlet penjualan; central_kitchen = dapur produksi yang mengirim
   * ke store; kantor = lokasi kerja admin/finance (bukan tujuan kirim barang)
   */
  tipe: z.enum(["store", "central_kitchen", "kantor"]).optional(),
  /** CK pemasok cabang store — wajib satu bila perusahaan punya beberapa CK */
  central_kitchen_id: z.string().uuid().nullish(),
  /** struk per cabang: footer + tampil/tidaknya alamat & telepon CABANG ini */
  receipt_footer: z.string().trim().max(200).nullish(),
  receipt_show_alamat: z.boolean().optional(),
  is_active: z.boolean().optional(),
});

/**
 * Tentukan CK pemasok sebuah cabang. Aturan: hanya store yang terhubung ke CK
 * (satu, bukan semua); diisi manual → wajib CK milik perusahaan; kosong →
 * otomatis bila CK aktif tepat satu, 400 bila lebih dari satu (harus memilih).
 */
async function resolveCentralKitchen(
  companyId: string,
  tipe: "store" | "central_kitchen" | "kantor",
  given: string | null | undefined,
  selfId?: string,
): Promise<string | null> {
  if (tipe !== "store") {
    if (given) {
      throw new HTTPException(400, {
        message: "Hanya cabang store yang terhubung ke Central Kitchen",
      });
    }
    return null;
  }
  if (given) {
    if (selfId && given === selfId) {
      throw new HTTPException(400, { message: "Cabang tidak bisa terhubung ke dirinya sendiri" });
    }
    const [ck] = await db
      .select({ id: branches.id, tipe: branches.tipe })
      .from(branches)
      .where(and(eq(branches.id, given), eq(branches.companyId, companyId)));
    if (!ck || ck.tipe !== "central_kitchen") {
      throw new HTTPException(400, { message: "Central Kitchen tujuan tidak valid" });
    }
    return ck.id;
  }
  const cks = await db
    .select({ id: branches.id })
    .from(branches)
    .where(
      and(
        eq(branches.companyId, companyId),
        eq(branches.tipe, "central_kitchen"),
        eq(branches.isActive, true),
      ),
    );
  const kandidat = cks.filter((c) => c.id !== selfId);
  if (kandidat.length === 0) return null;
  if (kandidat.length === 1) return kandidat[0].id;
  throw new HTTPException(400, {
    message:
      "Perusahaan punya beberapa Central Kitchen — pilih SATU sebagai pemasok cabang ini",
  });
}

export const cabangRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const auth = c.get("auth");
    const rows = await db
      .select()
      .from(branches)
      .where(eq(branches.companyId, auth.company_id!))
      .orderBy(asc(branches.createdAt));
    return c.json(
      rows.map((r) => ({
        id: r.id,
        nama: r.nama,
        alamat: r.alamat,
        telepon: r.telepon,
        tipe: r.tipe,
        central_kitchen_id: r.centralKitchenId,
        receipt_footer: r.receiptFooter,
        receipt_show_alamat: r.receiptShowAlamat,
        is_active: r.isActive,
      })),
    );
  })
  .post("/", requireRole("owner", "admin"), zValidator("json", CabangBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    // Mode Lite dibatasi 1 cabang — multi-lokasi butuh upgrade ke Pro.
    const [comp] = await db
      .select({ plan: companies.plan })
      .from(companies)
      .where(eq(companies.id, auth.company_id!));
    if (comp?.plan !== "pro") {
      const ada = await db
        .select({ id: branches.id })
        .from(branches)
        .where(eq(branches.companyId, auth.company_id!))
        .limit(1);
      if (ada.length > 0) {
        throw new HTTPException(400, {
          message: "Mode Lite hanya 1 cabang — upgrade ke Pro untuk multi-lokasi",
        });
      }
    }
    const tipe = body.tipe ?? "store";
    const ckId = await resolveCentralKitchen(auth.company_id!, tipe, body.central_kitchen_id);
    // Cabang + meja bawaan dibuat atomik: bila seed gagal, pembuatan cabang ikut rollback.
    const row = await db.transaction(async (tx) => {
      const [b] = await tx
        .insert(branches)
        .values({
          companyId: auth.company_id!,
          nama: body.nama,
          alamat: body.alamat ?? null,
          telepon: body.telepon ?? null,
          tipe,
          centralKitchenId: ckId,
          receiptFooter: body.receipt_footer ?? null,
          ...(body.receipt_show_alamat !== undefined && {
            receiptShowAlamat: body.receipt_show_alamat,
          }),
        })
        .onConflictDoNothing()
        .returning();
      if (!b) throw new HTTPException(409, { message: `Cabang "${body.nama}" sudah ada` });
      // Meja bawaan (Ruang Tunggu + Meja 1) supaya usaha take away langsung bisa jualan.
      await seedMejaDefault(tx, auth.company_id!, b.id);
      return b;
    });
    return c.json({ id: row.id, nama: row.nama }, 201);
  })
  .patch(
    "/:id",
    requireRole("owner", "admin"),
    zValidator("json", CabangBody.partial()),
    async (c) => {
      const auth = c.get("auth");
      const body = c.req.valid("json");
      const branchId = c.req.param("id");
      const [ada] = await db
        .select({ tipe: branches.tipe, centralKitchenId: branches.centralKitchenId })
        .from(branches)
        .where(and(eq(branches.id, branchId), eq(branches.companyId, auth.company_id!)));
      if (!ada) throw new HTTPException(404, { message: "Cabang tidak ditemukan" });

      // Koneksi CK dihitung ulang saat tipe/koneksi diubah: store wajib punya
      // SATU CK pemasok; ganti tipe ke CK/kantor memutus koneksinya.
      let ckPatch: { centralKitchenId: string | null } | Record<string, never> = {};
      if (body.tipe !== undefined || body.central_kitchen_id !== undefined) {
        const tipeBaru = body.tipe ?? ada.tipe;
        const diminta =
          body.central_kitchen_id !== undefined
            ? body.central_kitchen_id
            : tipeBaru === "store"
              ? ada.centralKitchenId
              : null;
        ckPatch = {
          centralKitchenId: await resolveCentralKitchen(
            auth.company_id!,
            tipeBaru,
            diminta,
            branchId,
          ),
        };
      }

      const [row] = await db
        .update(branches)
        .set({
          ...(body.nama !== undefined && { nama: body.nama }),
          ...(body.alamat !== undefined && { alamat: body.alamat }),
          ...(body.telepon !== undefined && { telepon: body.telepon }),
          ...(body.tipe !== undefined && { tipe: body.tipe }),
          ...(body.receipt_footer !== undefined && { receiptFooter: body.receipt_footer }),
          ...(body.receipt_show_alamat !== undefined && {
            receiptShowAlamat: body.receipt_show_alamat,
          }),
          ...(body.is_active !== undefined && { isActive: body.is_active }),
          ...ckPatch,
        })
        .where(
          and(eq(branches.id, branchId), eq(branches.companyId, auth.company_id!)),
        )
        .returning();
      if (!row) throw new HTTPException(404, { message: "Cabang tidak ditemukan" });
      return c.json({ ok: true });
    },
  );

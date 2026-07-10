import { randomUUID } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { JenisPengadaan } from "@kakarut/shared";
import { db } from "../../db/client";
import {
  companies,
  ingredients,
  productions,
  storageLocations,
  suppliers,
} from "../../db/schema";
import { pastikanCabang, resolveBranchId, type AppEnv } from "../../middleware/auth";
import { tanggalDi } from "../../lib/time";

const TambahStokBody = z
  .object({
    branch_id: z.string().uuid().optional(),
    ingredient_id: z.string().uuid(),
    qty: z.number().positive().optional(),
    /** true = 1 batch/1 pembelian → qty otomatis = isi bahan saat ini */
    batch: z.boolean().default(false),
    /** khusus jalur beli: total harga pembelian (catatan pengeluaran) */
    total_harga: z.number().nonnegative().nullish(),
    catatan: z.string().nullish(),
  })
  .refine((v) => v.batch || v.qty != null, {
    message: "Isi qty, atau set batch=true",
  });

const FakturBody = z.object({
  branch_id: z.string().uuid().optional(),
  supplier_id: z.string().uuid().nullish(),
  no_faktur: z.string().trim().max(60).nullish(),
  catatan: z.string().nullish(),
  items: z
    .array(
      z.object({
        ingredient_id: z.string().uuid(),
        /** jumlah dalam pcs, atau dalam batch (dikali isi bahan) */
        mode: z.enum(["pcs", "batch"]),
        jumlah: z.number().positive(),
        storage_location_id: z.string().uuid().nullish(),
        total_harga: z.number().nonnegative().nullish(),
      }),
    )
    .min(1),
});

const LABEL: Record<JenisPengadaan, { jalur: string }> = {
  produksi: { jalur: "Produksi Bahan Baku" },
  beli: { jalur: "Beli Bahan Baku" },
};

async function resolveBranchUntukTulis(
  c: Context<AppEnv>,
  bodyBranchId: string | undefined,
) {
  const auth = c.get("auth");
  const branchId = bodyBranchId
    ? await pastikanCabang(bodyBranchId, auth.company_id!)
    : await resolveBranchId(c);
  if (auth.role === "cashier" && branchId !== auth.branch_id) {
    throw new HTTPException(403, { message: "Kasir hanya boleh input di cabangnya" });
  }
  return branchId;
}

/** Bahan harus milik perusahaan DAN jenis pengadaannya sesuai jalur. */
function pastikanJalur(
  ing: typeof ingredients.$inferSelect | undefined,
  tipe: JenisPengadaan,
  id: string,
) {
  if (!ing) throw new HTTPException(404, { message: `Bahan tidak ditemukan (${id})` });
  if (!ing.trackStok) {
    throw new HTTPException(400, {
      message: `Stok "${ing.nama}" tidak dilacak — centang "Lacak stok" di halaman Bahan Baku dulu`,
    });
  }
  if (ing.pengadaan !== tipe) {
    throw new HTTPException(400, {
      message: `"${ing.nama}" berjenis ${ing.pengadaan === "beli" ? "beli jadi" : "produksi sendiri"} — tambah stok lewat menu ${LABEL[ing.pengadaan].jalur}`,
    });
  }
  return ing;
}

function hargaDefault(tipe: JenisPengadaan, qty: number, ing: { isi: number; hargaBeli: number }) {
  return tipe === "beli" ? Math.round((qty / ing.isi) * ing.hargaBeli) : null;
}

/**
 * Dua jalur penambahan stok dengan aturan yang sama, dibedakan `tipe`:
 * - /produksi  → hanya bahan berjenis pengadaan "produksi" (dibuat sendiri)
 * - /pembelian → hanya bahan berjenis pengadaan "beli" (dibeli jadi)
 *
 * Alur utama: POST /faktur (multi-item, status "menunggu") →
 * POST /konfirmasi/:fakturId ("ya, ada" — stok baru terhitung setelah ini).
 * POST / lama (satu item, langsung dikonfirmasi) dipertahankan untuk
 * kompatibilitas.
 */
function buatRuteTambahStok(tipe: JenisPengadaan) {
  return new Hono<AppEnv>()
    .post("/faktur", zValidator("json", FakturBody), async (c) => {
      const auth = c.get("auth");
      const body = c.req.valid("json");
      const branchId = await resolveBranchUntukTulis(c, body.branch_id);

      // Muat & validasi semua referensi milik perusahaan/cabang
      const ingIds = [...new Set(body.items.map((i) => i.ingredient_id))];
      const ingRows = await db
        .select()
        .from(ingredients)
        .where(
          and(eq(ingredients.companyId, auth.company_id!), inArray(ingredients.id, ingIds)),
        );
      const ingById = new Map(ingRows.map((r) => [r.id, r]));

      if (body.supplier_id) {
        const [s] = await db
          .select({ id: suppliers.id })
          .from(suppliers)
          .where(
            and(eq(suppliers.id, body.supplier_id), eq(suppliers.companyId, auth.company_id!)),
          );
        if (!s) throw new HTTPException(400, { message: "Supplier tidak valid" });
      }
      const lokasiIds = [
        ...new Set(body.items.map((i) => i.storage_location_id).filter(Boolean) as string[]),
      ];
      if (lokasiIds.length > 0) {
        const lokasi = await db
          .select({ id: storageLocations.id })
          .from(storageLocations)
          .where(
            and(
              eq(storageLocations.branchId, branchId),
              inArray(storageLocations.id, lokasiIds),
            ),
          );
        if (lokasi.length !== lokasiIds.length) {
          throw new HTTPException(400, {
            message: "Ada tempat penyimpanan yang tidak valid untuk cabang ini",
          });
        }
      }

      const [company] = await db
        .select({ timezone: companies.timezone })
        .from(companies)
        .where(eq(companies.id, auth.company_id!));
      const prodDate = tanggalDi(company?.timezone ?? "Asia/Jakarta");
      const fakturId = randomUUID();

      const rows = body.items.map((item) => {
        const ing = pastikanJalur(ingById.get(item.ingredient_id), tipe, item.ingredient_id);
        const qty = item.mode === "batch" ? item.jumlah * ing.isi : item.jumlah;
        return {
          companyId: auth.company_id!,
          branchId,
          ingredientId: ing.id,
          qty,
          tipe,
          totalHarga:
            tipe === "beli" ? (item.total_harga ?? hargaDefault(tipe, qty, ing)) : null,
          fakturId,
          noFaktur: body.no_faktur ?? null,
          supplierId: body.supplier_id ?? null,
          storageLocationId: item.storage_location_id ?? null,
          status: "menunggu" as const,
          isBatch: item.mode === "batch",
          catatan: body.catatan ?? null,
          userId: auth.sub,
          prodDate,
        };
      });

      const inserted = await db.transaction(async (tx) =>
        tx.insert(productions).values(rows).returning(),
      );
      return c.json(
        { faktur_id: fakturId, status: "menunggu", jumlah_baris: inserted.length },
        201,
      );
    })
    /** Konfirmasi "ya, ada": barang benar-benar diterima → stok terhitung. */
    .post("/konfirmasi/:fakturId", async (c) => {
      const auth = c.get("auth");
      const conds = [
        eq(productions.companyId, auth.company_id!),
        eq(productions.fakturId, c.req.param("fakturId")),
        eq(productions.tipe, tipe),
        eq(productions.status, "menunggu"),
      ];
      if (auth.role === "cashier" && auth.branch_id) {
        conds.push(eq(productions.branchId, auth.branch_id));
      }
      const rows = await db
        .update(productions)
        .set({ status: "dikonfirmasi", confirmedBy: auth.sub, confirmedAt: new Date() })
        .where(and(...conds))
        .returning();
      if (rows.length === 0) {
        throw new HTTPException(404, {
          message: "Faktur tidak ditemukan atau sudah dikonfirmasi",
        });
      }
      return c.json({ ok: true, jumlah_baris: rows.length });
    })
    .post("/", zValidator("json", TambahStokBody), async (c) => {
      const auth = c.get("auth");
      const body = c.req.valid("json");
      const branchId = await resolveBranchUntukTulis(c, body.branch_id);

      const [ingRow] = await db
        .select()
        .from(ingredients)
        .where(
          and(
            eq(ingredients.id, body.ingredient_id),
            eq(ingredients.companyId, auth.company_id!),
          ),
        );
      const ing = pastikanJalur(ingRow, tipe, body.ingredient_id);

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
          tipe,
          totalHarga:
            tipe === "beli" ? (body.total_harga ?? hargaDefault(tipe, qty, ing)) : null,
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
        eq(productions.tipe, tipe),
      ];
      if (tanggal) conds.push(eq(productions.prodDate, tanggal));
      const rows = await db
        .select({
          id: productions.id,
          ingredient_id: productions.ingredientId,
          bahan: ingredients.nama,
          isi: ingredients.isi,
          satuan: ingredients.satuan,
          qty: productions.qty,
          total_harga: productions.totalHarga,
          is_batch: productions.isBatch,
          catatan: productions.catatan,
          waktu: productions.waktu,
          prod_date: productions.prodDate,
          faktur_id: productions.fakturId,
          no_faktur: productions.noFaktur,
          status: productions.status,
          supplier: suppliers.nama,
          tempat: storageLocations.nama,
        })
        .from(productions)
        .innerJoin(ingredients, eq(productions.ingredientId, ingredients.id))
        .leftJoin(suppliers, eq(productions.supplierId, suppliers.id))
        .leftJoin(storageLocations, eq(productions.storageLocationId, storageLocations.id))
        .where(and(...conds))
        .orderBy(desc(productions.waktu), asc(productions.id))
        .limit(300);
      return c.json(rows);
    });
}

export const produksiRoutes = buatRuteTambahStok("produksi");
export const pembelianRoutes = buatRuteTambahStok("beli");

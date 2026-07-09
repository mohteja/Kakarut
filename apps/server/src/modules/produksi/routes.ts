import { zValidator } from "@hono/zod-validator";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { JenisPengadaan } from "@kakarut/shared";
import { db } from "../../db/client";
import { companies, ingredients, productions } from "../../db/schema";
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

const LABEL: Record<JenisPengadaan, { jalur: string; jalurLain: string }> = {
  produksi: { jalur: "Produksi Bahan Baku", jalurLain: "Beli Bahan Baku" },
  beli: { jalur: "Beli Bahan Baku", jalurLain: "Produksi Bahan Baku" },
};

/**
 * Dua jalur penambahan stok dengan aturan yang sama, dibedakan `tipe`:
 * - /produksi  → hanya bahan berjenis pengadaan "produksi" (dibuat sendiri)
 * - /pembelian → hanya bahan berjenis pengadaan "beli" (dibeli jadi)
 * Keduanya tercatat di tabel productions (kolom tipe) sehingga saldo stok
 * tetap satu rumus: opname + Σ masuk − Σ terpakai.
 */
function buatRuteTambahStok(tipe: JenisPengadaan) {
  return new Hono<AppEnv>()
    .post("/", zValidator("json", TambahStokBody), async (c) => {
      const auth = c.get("auth");
      const body = c.req.valid("json");
      const branchId = body.branch_id
        ? await pastikanCabang(body.branch_id, auth.company_id!)
        : await resolveBranchId(c);
      if (auth.role === "cashier" && branchId !== auth.branch_id) {
        throw new HTTPException(403, { message: "Kasir hanya boleh input di cabangnya" });
      }

      const [ing] = await db
        .select()
        .from(ingredients)
        .where(
          and(
            eq(ingredients.id, body.ingredient_id),
            eq(ingredients.companyId, auth.company_id!),
          ),
        );
      if (!ing) throw new HTTPException(404, { message: "Bahan tidak ditemukan" });

      // Jalur harus sesuai jenis pengadaan bahan
      if (ing.pengadaan !== tipe) {
        throw new HTTPException(400, {
          message: `"${ing.nama}" berjenis ${ing.pengadaan === "beli" ? "beli jadi" : "produksi sendiri"} — tambah stok lewat menu ${LABEL[ing.pengadaan].jalur}`,
        });
      }

      const [company] = await db
        .select({ timezone: companies.timezone })
        .from(companies)
        .where(eq(companies.id, auth.company_id!));

      const qty = body.batch ? ing.isi : body.qty!;
      // default catatan pengeluaran: proporsional harga_beli (1 pembelian penuh
      // = harga_beli); bisa dioverride lewat total_harga
      const totalHarga =
        tipe === "beli"
          ? (body.total_harga ?? Math.round((qty / ing.isi) * ing.hargaBeli))
          : null;
      const [row] = await db
        .insert(productions)
        .values({
          companyId: auth.company_id!,
          branchId,
          ingredientId: ing.id,
          qty,
          tipe,
          totalHarga,
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
          qty: productions.qty,
          total_harga: productions.totalHarga,
          is_batch: productions.isBatch,
          catatan: productions.catatan,
          waktu: productions.waktu,
          prod_date: productions.prodDate,
        })
        .from(productions)
        .innerJoin(ingredients, eq(productions.ingredientId, ingredients.id))
        .where(and(...conds))
        .orderBy(desc(productions.waktu))
        .limit(200);
      return c.json(rows);
    });
}

export const produksiRoutes = buatRuteTambahStok("produksi");
export const pembelianRoutes = buatRuteTambahStok("beli");

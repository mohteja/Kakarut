import { zValidator } from "@hono/zod-validator";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { db } from "../../db/client";
import { ingredients, productions, storageLocations, suppliers } from "../../db/schema";
import { resolveBranchId, terikatCabang, type AppEnv } from "../../middleware/auth";
import { catatLogFaktur } from "../produksi/log";

const TolakBody = z.object({ alasan: z.string().trim().max(300).nullish() });

const TerimaSebagianBody = z.object({
  /** qty yang benar-benar diterima per baris; 0 = baris itu ditolak */
  items: z
    .array(z.object({ id: z.string().uuid(), qty_diterima: z.number().nonnegative() }))
    .min(1),
  alasan: z.string().trim().max(300).nullish(),
});

/** Kondisi dasar satu faktur kiriman (jalur beli) milik perusahaan; kasir terkunci cabangnya. */
function kondisiFaktur(c: Context<AppEnv>, fakturId: string) {
  const auth = c.get("auth");
  const conds = [
    eq(productions.companyId, auth.company_id!),
    eq(productions.fakturId, fakturId),
    eq(productions.tipe, "beli" as const),
    isNull(productions.deletedAt),
  ];
  if (terikatCabang(auth.role) && auth.branch_id) {
    conds.push(eq(productions.branchId, auth.branch_id));
  }
  return conds;
}

/**
 * Penerimaan barang di toko/cabang (jalur beli) — dapat diakses SEMUA peran,
 * termasuk kasir (terkunci ke cabangnya): kiriman berstatus 'menunggu'
 * (dikirim) bisa DITERIMA semua, DITERIMA SEBAGIAN (barang kurang), atau
 * DITOLAK; penolakan bisa DIBATALKAN (kasir salah cek) → faktur selesai
 * (dikonfirmasi, stok masuk).
 */
export const penerimaanRoutes = new Hono<AppEnv>()
  /** Daftar kiriman yang menunggu penerimaan + yang ditolak, per cabang. */
  .get("/", async (c) => {
    const auth = c.get("auth");
    const branchId = await resolveBranchId(c);
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
        qty_dipesan: productions.qtyDipesan,
        alasan_tolak: productions.alasanTolak,
      })
      .from(productions)
      .innerJoin(ingredients, eq(productions.ingredientId, ingredients.id))
      .leftJoin(suppliers, eq(productions.supplierId, suppliers.id))
      .leftJoin(storageLocations, eq(productions.storageLocationId, storageLocations.id))
      .where(
        and(
          eq(productions.companyId, auth.company_id!),
          eq(productions.branchId, branchId),
          eq(productions.tipe, "beli"),
          inArray(productions.status, ["menunggu", "ditolak"]),
          isNull(productions.deletedAt),
        ),
      )
      .orderBy(asc(productions.waktu), asc(productions.id));
    return c.json({ rows });
  })
  /** Terima SEMUA barang kiriman → masuk stok. */
  .post("/:fakturId/terima", async (c) => {
    const auth = c.get("auth");
    // waktu = saat diterima (bukan saat RAB dibuat) agar stok masuk terhitung
    // relatif ke opname terakhir, bukan tanggal faktur dibuat.
    const now = new Date();
    const rows = await db
      .update(productions)
      .set({ status: "dikonfirmasi", confirmedBy: auth.sub, confirmedAt: now, waktu: now })
      .where(
        and(...kondisiFaktur(c, c.req.param("fakturId")), eq(productions.status, "menunggu")),
      )
      .returning({ id: productions.id, branchId: productions.branchId });
    if (rows.length === 0) {
      throw new HTTPException(404, { message: "Kiriman tidak ditemukan atau bukan status dikirim" });
    }
    await catatLogFaktur(db, {
      companyId: auth.company_id!,
      branchId: rows[0].branchId,
      fakturId: c.req.param("fakturId"),
      jalur: "beli",
      aksi: "Diterima semua (toko) — stok masuk",
      detail: `${rows.length} baris`,
      userId: auth.sub,
    });
    return c.json({ ok: true, jumlah_baris: rows.length });
  })
  /**
   * Terima SEBAGIAN: kasir mengisi qty yang benar-benar diterima per baris
   * (0 = baris ditolak). qty pesanan awal disimpan di qty_dipesan dan harga
   * diproratakan agar pengeluaran sesuai barang yang diterima.
   */
  .post("/:fakturId/terima-sebagian", zValidator("json", TerimaSebagianBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const fakturId = c.req.param("fakturId");

    const baris = await db
      .select({
        id: productions.id,
        qty: productions.qty,
        totalHarga: productions.totalHarga,
        branchId: productions.branchId,
      })
      .from(productions)
      .where(and(...kondisiFaktur(c, fakturId), eq(productions.status, "menunggu")));
    if (baris.length === 0) {
      throw new HTTPException(404, { message: "Kiriman tidak ditemukan atau bukan status dikirim" });
    }
    const terimaById = new Map(body.items.map((i) => [i.id, i.qty_diterima]));
    const belum = baris.filter((b) => !terimaById.has(b.id));
    if (belum.length > 0) {
      throw new HTTPException(400, {
        message: "Semua baris kiriman harus diisi qty diterimanya (0 bila tidak diterima)",
      });
    }
    // Qty diterima tak boleh melebihi qty yang dikirim — barang tidak mungkin
    // datang lebih dari yang dikirim; tanpa batas ini stok & pengeluaran bisa
    // digelembungkan sewenang-wenang.
    const kelebihan = baris.find((b) => terimaById.get(b.id)! > b.qty);
    if (kelebihan) {
      throw new HTTPException(400, {
        message: "Qty diterima tidak boleh melebihi qty yang dikirim",
      });
    }

    // waktu = saat diterima (bukan saat RAB), lihat catatan di endpoint /terima.
    const now = new Date();
    await db.transaction(async (tx) => {
      for (const b of baris) {
        const diterima = terimaById.get(b.id)!;
        // WHERE tetap menuntut status 'menunggu' + belum dihapus: bila baris
        // berubah oleh proses lain sejak dibaca, update 0 baris → rollback.
        const res =
          diterima > 0
            ? await tx
                .update(productions)
                .set({
                  qtyDipesan: b.qty,
                  qty: diterima,
                  // prorata harga sesuai porsi yang diterima
                  totalHarga:
                    b.totalHarga != null ? Math.round((b.totalHarga * diterima) / b.qty) : null,
                  status: "dikonfirmasi",
                  confirmedBy: auth.sub,
                  confirmedAt: now,
                  waktu: now,
                })
                .where(
                  and(
                    eq(productions.id, b.id),
                    eq(productions.status, "menunggu"),
                    isNull(productions.deletedAt),
                  ),
                )
                .returning({ id: productions.id })
            : await tx
                .update(productions)
                .set({
                  status: "ditolak",
                  alasanTolak: body.alasan ?? "Barang tidak diterima",
                  updatedBy: auth.sub,
                  updatedAt: now,
                })
                .where(
                  and(
                    eq(productions.id, b.id),
                    eq(productions.status, "menunggu"),
                    isNull(productions.deletedAt),
                  ),
                )
                .returning({ id: productions.id });
        if (res.length === 0) {
          throw new HTTPException(409, {
            message: "Status kiriman berubah — muat ulang halaman penerimaan lalu coba lagi",
          });
        }
      }
      const diterima = baris.filter((b) => terimaById.get(b.id)! > 0).length;
      await catatLogFaktur(tx, {
        companyId: auth.company_id!,
        branchId: baris[0].branchId,
        fakturId,
        jalur: "beli",
        aksi: "Diterima sebagian (toko)",
        detail:
          `${diterima} baris diterima, ${baris.length - diterima} ditolak` +
          (body.alasan ? ` · ${body.alasan}` : ""),
        userId: auth.sub,
      });
    });
    return c.json({ ok: true, jumlah_baris: baris.length });
  })
  /** Tolak seluruh kiriman (barang kurang/salah). */
  .post("/:fakturId/tolak", zValidator("json", TolakBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const rows = await db
      .update(productions)
      .set({
        status: "ditolak",
        alasanTolak: body.alasan ?? null,
        updatedBy: auth.sub,
        updatedAt: new Date(),
      })
      .where(
        and(...kondisiFaktur(c, c.req.param("fakturId")), eq(productions.status, "menunggu")),
      )
      .returning({ id: productions.id, branchId: productions.branchId });
    if (rows.length === 0) {
      throw new HTTPException(404, { message: "Kiriman tidak ditemukan atau bukan status dikirim" });
    }
    await catatLogFaktur(db, {
      companyId: auth.company_id!,
      branchId: rows[0].branchId,
      fakturId: c.req.param("fakturId"),
      jalur: "beli",
      aksi: "Kiriman ditolak",
      detail: body.alasan ?? null,
      userId: auth.sub,
    });
    return c.json({ ok: true, jumlah_baris: rows.length });
  })
  /**
   * Batalkan penolakan (kasir salah cek SATU faktur penuh): baris yang ditolak
   * dianggap diterima → faktur selesai (dikonfirmasi, stok masuk).
   */
  .post("/:fakturId/batal-tolak", async (c) => {
    const auth = c.get("auth");
    const fakturId = c.req.param("fakturId");
    // Bila faktur sudah diterima SEBAGIAN (ada baris dikonfirmasi), baris yang
    // ditolak tadi memang sengaja tak diterima (qty 0) — membatalkannya akan
    // memasukkan qty & harga PENUH yang salah. Batal-tolak hanya untuk
    // penolakan satu faktur penuh (semua baris ditolak).
    const [adaDiterima] = await db
      .select({ id: productions.id })
      .from(productions)
      .where(and(...kondisiFaktur(c, fakturId), eq(productions.status, "dikonfirmasi")))
      .limit(1);
    if (adaDiterima) {
      throw new HTTPException(400, {
        message:
          "Faktur ini sudah diterima sebagian — baris yang ditolak tidak bisa dibatalkan (barang memang tidak diterima)",
      });
    }
    const now = new Date();
    const rows = await db
      .update(productions)
      .set({
        status: "dikonfirmasi",
        alasanTolak: null,
        confirmedBy: auth.sub,
        confirmedAt: now,
        waktu: now,
      })
      .where(and(...kondisiFaktur(c, fakturId), eq(productions.status, "ditolak")))
      .returning({ id: productions.id, branchId: productions.branchId });
    if (rows.length === 0) {
      throw new HTTPException(404, { message: "Tidak ada baris ditolak pada kiriman ini" });
    }
    await catatLogFaktur(db, {
      companyId: auth.company_id!,
      branchId: rows[0].branchId,
      fakturId,
      jalur: "beli",
      aksi: "Penolakan dibatalkan — stok masuk",
      detail: `${rows.length} baris`,
      userId: auth.sub,
    });
    return c.json({ ok: true, jumlah_baris: rows.length });
  });

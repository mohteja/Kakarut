import { randomUUID } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { OpnameRingkasan } from "@kakarut/shared";
import { db } from "../../db/client";
import { companies, ingredients, stockOpnames, users } from "../../db/schema";
import { pastikanCabang, resolveBranchId, type AppEnv } from "../../middleware/auth";
import { tanggalDi } from "../../lib/time";
import { hitungSaldoCabang, kartuStok } from "./service";

const OpnameBody = z.object({
  branch_id: z.string().uuid().optional(),
  catatan: z.string().nullish(),
  items: z
    .array(
      z.object({
        ingredient_id: z.string().uuid(),
        qty: z.number().min(0),
      }),
    )
    .min(1),
});

export const stokRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const auth = c.get("auth");
    const branchId = await resolveBranchId(c);
    return c.json(await hitungSaldoCabang(auth.company_id!, branchId));
  })
  /** Kartu stok: buku besar mutasi satu bahan (halaman terpisah di web). */
  .get("/kartu/:ingredientId", async (c) => {
    const auth = c.get("auth");
    const branchId = await resolveBranchId(c);

    const [ing] = await db
      .select()
      .from(ingredients)
      .where(
        and(
          eq(ingredients.id, c.req.param("ingredientId")),
          eq(ingredients.companyId, auth.company_id!),
        ),
      );
    if (!ing) throw new HTTPException(404, { message: "Bahan tidak ditemukan" });
    if (!ing.trackStok) {
      throw new HTTPException(400, {
        message: `Stok "${ing.nama}" tidak dilacak — tidak ada kartu stok`,
      });
    }

    const [company] = await db
      .select({ timezone: companies.timezone })
      .from(companies)
      .where(eq(companies.id, auth.company_id!));
    const tz = company?.timezone ?? "Asia/Jakarta";
    const tanggalValid = /^\d{4}-\d{2}-\d{2}$/;
    const sampaiQ = c.req.query("sampai");
    const dariQ = c.req.query("dari");
    const sampai = sampaiQ && tanggalValid.test(sampaiQ) ? sampaiQ : tanggalDi(tz);
    const dari =
      dariQ && tanggalValid.test(dariQ)
        ? dariQ
        : tanggalDi(tz, new Date(Date.now() - 29 * 24 * 3600 * 1000));

    return c.json(
      await kartuStok({
        branchId,
        ingredientId: ing.id,
        dari,
        sampai,
        bahan: { id: ing.id, nama: ing.nama, slug: ing.slug, satuan: ing.satuan },
      }),
    );
  })
  /**
   * Stock opname: bandingkan fisik vs sistem. Semua peran (kasir terkunci
   * cabangnya). Menyimpan snapshot saldo sistem + selisih per sesi, dan
   * qty fisik jadi baseline saldo baru.
   */
  .post("/opname", zValidator("json", OpnameBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const branchId = body.branch_id
      ? await pastikanCabang(body.branch_id, auth.company_id!)
      : await resolveBranchId(c);
    if (auth.role === "cashier" && branchId !== auth.branch_id) {
      throw new HTTPException(403, { message: "Kasir hanya boleh opname di cabangnya" });
    }

    // Gabungkan duplikat (entri terakhir menang)
    const qtyByIngredient = new Map<string, number>();
    for (const item of body.items) qtyByIngredient.set(item.ingredient_id, item.qty);

    const ids = [...qtyByIngredient.keys()];
    const valid = await db
      .select({ id: ingredients.id })
      .from(ingredients)
      .where(
        and(
          eq(ingredients.companyId, auth.company_id!),
          eq(ingredients.trackStok, true),
          inArray(ingredients.id, ids),
        ),
      );
    if (valid.length !== ids.length) {
      throw new HTTPException(400, {
        message: "Ada bahan yang tidak valid atau stoknya tidak dilacak",
      });
    }

    const [company] = await db
      .select({ timezone: companies.timezone })
      .from(companies)
      .where(eq(companies.id, auth.company_id!));
    const today = tanggalDi(company?.timezone ?? "Asia/Jakarta");

    // Snapshot saldo sistem per bahan (sebelum opname mengubahnya)
    const saldoRows = await hitungSaldoCabang(auth.company_id!, branchId);
    const saldoById = new Map(saldoRows.map((r) => [r.ingredient_id, r.saldo]));

    const sessionId = randomUUID();
    const ringkasan: OpnameRingkasan = {
      dihitung: qtyByIngredient.size,
      cocok: 0,
      lebih: 0,
      kurang: 0,
      total_selisih: 0,
    };
    const values = [...qtyByIngredient].map(([ingredientId, fisik]) => {
      const sistem = saldoById.get(ingredientId) ?? 0;
      const selisih = fisik - sistem;
      if (Math.abs(selisih) < 1e-9) ringkasan.cocok++;
      else if (selisih > 0) ringkasan.lebih++;
      else ringkasan.kurang++;
      ringkasan.total_selisih += selisih;
      return {
        companyId: auth.company_id!,
        branchId,
        ingredientId,
        qty: fisik,
        opnameDate: today,
        catatan: body.catatan ?? null,
        sessionId,
        systemQty: sistem,
        selisih,
        userId: auth.sub,
      };
    });

    const rows = await db.insert(stockOpnames).values(values).returning();
    return c.json({ ok: true, jumlah: rows.length, session_id: sessionId, ringkasan }, 201);
  })
  /** Riwayat sesi opname (digroup per session_id). */
  .get("/opname/riwayat", async (c) => {
    const auth = c.get("auth");
    const branchId = await resolveBranchId(c);
    const rows = await db
      .select({
        session_id: stockOpnames.sessionId,
        waktu: sql<string>`max(${stockOpnames.createdAt})`,
        user_id: sql<string>`max(${stockOpnames.userId}::text)`,
        catatan: sql<string>`max(${stockOpnames.catatan})`,
        jumlah_item: sql<number>`count(*)::int`,
        jumlah_selisih: sql<number>`count(*) FILTER (WHERE abs(coalesce(${stockOpnames.selisih}, 0)) > 1e-9)::int`,
      })
      .from(stockOpnames)
      .where(
        and(
          eq(stockOpnames.companyId, auth.company_id!),
          eq(stockOpnames.branchId, branchId),
          isNotNull(stockOpnames.sessionId),
        ),
      )
      .groupBy(stockOpnames.sessionId)
      .orderBy(desc(sql`max(${stockOpnames.createdAt})`))
      .limit(200);

    // resolusi nama user (opsional)
    const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))] as string[];
    const namaById = new Map<string, string>();
    if (userIds.length > 0) {
      const us = await db
        .select({ id: users.id, nama: users.nama })
        .from(users)
        .where(inArray(users.id, userIds));
      for (const u of us) namaById.set(u.id, u.nama);
    }

    return c.json(
      rows.map((r) => ({
        session_id: r.session_id,
        waktu: r.waktu,
        oleh: r.user_id ? (namaById.get(r.user_id) ?? null) : null,
        jumlah_item: r.jumlah_item,
        jumlah_selisih: r.jumlah_selisih,
        catatan: r.catatan,
      })),
    );
  })
  /** Detail satu sesi opname (fisik vs sistem vs selisih per bahan). */
  .get("/opname/sesi/:sessionId", async (c) => {
    const auth = c.get("auth");
    const rows = await db
      .select({
        nama: ingredients.nama,
        satuan: ingredients.satuan,
        system_qty: stockOpnames.systemQty,
        qty_fisik: stockOpnames.qty,
        selisih: stockOpnames.selisih,
        waktu: stockOpnames.createdAt,
        catatan: stockOpnames.catatan,
        user_id: stockOpnames.userId,
      })
      .from(stockOpnames)
      .innerJoin(ingredients, eq(stockOpnames.ingredientId, ingredients.id))
      .where(
        and(
          eq(stockOpnames.companyId, auth.company_id!),
          eq(stockOpnames.sessionId, c.req.param("sessionId")),
        ),
      )
      .orderBy(desc(sql`abs(coalesce(${stockOpnames.selisih}, 0))`), ingredients.nama);
    if (rows.length === 0) throw new HTTPException(404, { message: "Sesi opname tidak ditemukan" });

    let oleh: string | null = null;
    if (rows[0].user_id) {
      const [u] = await db
        .select({ nama: users.nama })
        .from(users)
        .where(eq(users.id, rows[0].user_id));
      oleh = u?.nama ?? null;
    }

    return c.json({
      session_id: c.req.param("sessionId"),
      waktu: rows[0].waktu,
      oleh,
      catatan: rows[0].catatan,
      items: rows.map((r) => ({
        nama: r.nama,
        satuan: r.satuan,
        system_qty: r.system_qty,
        qty_fisik: r.qty_fisik,
        selisih: r.selisih,
      })),
    });
  })
  .get("/opname", async (c) => {
    const auth = c.get("auth");
    const branchId = await resolveBranchId(c);
    const rows = await db
      .select({
        id: stockOpnames.id,
        ingredient_id: stockOpnames.ingredientId,
        bahan: ingredients.nama,
        qty: stockOpnames.qty,
        opname_date: stockOpnames.opnameDate,
        catatan: stockOpnames.catatan,
        created_at: stockOpnames.createdAt,
      })
      .from(stockOpnames)
      .innerJoin(ingredients, eq(stockOpnames.ingredientId, ingredients.id))
      .where(
        and(eq(stockOpnames.companyId, auth.company_id!), eq(stockOpnames.branchId, branchId)),
      )
      .orderBy(desc(stockOpnames.createdAt))
      .limit(200);
    return c.json(rows);
  });

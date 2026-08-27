import { zValidator } from "../../lib/validator";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { SupplierDto, SupplierKartu } from "@kakarut/shared";
import { db } from "../../db/client";
import {
  branches,
  ingredientSuppliers,
  ingredients,
  productions,
  suppliers,
} from "../../db/schema";
import { requireRole, type AppEnv } from "../../middleware/auth";
import { tanpaBentrok } from "../../lib/pg-galat";

const SupplierBody = z.object({
  nama: z.string().trim().min(1),
  telepon: z.string().nullish(),
  alamat: z.string().nullish(),
  catatan: z.string().nullish(),
  kategori: z.string().trim().max(30).nullish(),
  is_active: z.boolean().optional(),
}).strict();

function toDto(row: typeof suppliers.$inferSelect): SupplierDto {
  return {
    id: row.id,
    nama: row.nama,
    telepon: row.telepon,
    alamat: row.alamat,
    catatan: row.catatan,
    kategori: row.kategori,
    is_active: row.isActive,
  };
}

export const supplierRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const auth = c.get("auth");
    const rows = await db
      .select()
      .from(suppliers)
      .where(eq(suppliers.companyId, auth.company_id!))
      .orderBy(asc(suppliers.nama));
    return c.json(rows.map(toDto));
  })
  // POST boleh semua peran — dipakai quick-add saat mengisi faktur
  /*
   * Sama seperti tempat penyimpanan: `PATCH /:id` sudah ber-`requireRole
   * ("owner", "admin")`, pintu BUAT-nya tidak. Terukur dengan token peran
   * `bar`: `POST /supplier` → **201**, barisnya ada di `suppliers`.
   */
  .post("/", requireRole("owner", "admin"), zValidator("json", SupplierBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const [row] = await db
      .insert(suppliers)
      .values({
        companyId: auth.company_id!,
        nama: body.nama,
        telepon: body.telepon ?? null,
        alamat: body.alamat ?? null,
        catatan: body.catatan ?? null,
        kategori: body.kategori || null,
      })
      .onConflictDoNothing()
      .returning();
    if (!row) {
      throw new HTTPException(409, {
        message: `Supplier "${body.nama}" sudah ada`,
      });
    }
    return c.json(toDto(row), 201);
  })
  /**
   * KARTU SUPPLIER: riwayat transaksi pembelian yang tercatat ke supplier ini
   * (baris faktur beli ber-supplier_id — diisi manual di faktur atau otomatis
   * dari supplier utama bahan saat belanja Diproses) + ringkasan belanja +
   * bahan yang terhubung.
   *
   * DULU terbuka semua peran ("info belanja"). Terukur 2026-08-26 dengan token
   * peran `bar`: 200 berikut `total_belanja` — seluruh riwayat belanja ke
   * supplier ini. Pintu sebelahnya di berkas yang SAMA (`PATCH /:id`) sudah
   * `requireRole("owner","admin")` sejak lama; yang membaca angkanya tidak.
   *
   * Pasangannya diperiksa sebelum ditutup: satu-satunya pembaca kartu ini
   * adalah `KartuSupplierPage` web, yang rutenya (`/pengaturan/supplier/:id`)
   * memang cuma dipasang untuk `isManajemen`. Ponsel tak memanggilnya sama
   * sekali. Menutupnya tak memutus layar mana pun.
   */
  .get("/:id/kartu", requireRole("owner", "admin"), async (c) => {
    const auth = c.get("auth");
    const id = c.req.param("id");
    const [sup] = await db
      .select()
      .from(suppliers)
      .where(
        and(eq(suppliers.id, id), eq(suppliers.companyId, auth.company_id!)),
      );
    if (!sup)
      throw new HTTPException(404, { message: "Supplier tidak ditemukan" });

    const condsTransaksi = and(
      eq(productions.companyId, auth.company_id!),
      eq(productions.supplierId, id),
      eq(productions.tipe, "beli"),
      isNull(productions.deletedAt),
    );
    const rows = await db
      .select({
        id: productions.id,
        waktu: productions.waktu,
        prod_date: productions.prodDate,
        no_faktur: productions.noFaktur,
        faktur_id: productions.fakturId,
        bahan: ingredients.nama,
        satuan: ingredients.satuan,
        qty: productions.qty,
        total_harga: productions.totalHarga,
        status: productions.status,
        cabang: branches.nama,
      })
      .from(productions)
      .innerJoin(ingredients, eq(productions.ingredientId, ingredients.id))
      .leftJoin(branches, eq(productions.branchId, branches.id))
      .where(condsTransaksi)
      .orderBy(desc(productions.waktu), desc(productions.id))
      .limit(500);
    const [ringkas] = await db
      .select({
        total_belanja: sql<number>`COALESCE(SUM(${productions.totalHarga}) FILTER (WHERE ${productions.status} = 'dikonfirmasi'), 0)::float8`,
        jumlah_transaksi: sql<number>`COUNT(DISTINCT COALESCE(${productions.fakturId}::text, ${productions.id}::text))::int`,
      })
      .from(productions)
      .where(condsTransaksi);
    // bahan yang menautkan supplier ini (info "dipakai untuk beli apa")
    const bahan = await db
      .select({
        ingredient_id: ingredients.id,
        nama: ingredients.nama,
        is_utama: ingredientSuppliers.isUtama,
      })
      .from(ingredientSuppliers)
      .innerJoin(
        ingredients,
        eq(ingredientSuppliers.ingredientId, ingredients.id),
      )
      .where(
        and(
          eq(ingredientSuppliers.companyId, auth.company_id!),
          eq(ingredientSuppliers.supplierId, id),
          eq(ingredients.isActive, true),
        ),
      )
      .orderBy(desc(ingredientSuppliers.isUtama), asc(ingredients.nama));
    const kartu: SupplierKartu = {
      supplier: toDto(sup),
      total_belanja: Number(ringkas?.total_belanja ?? 0),
      jumlah_transaksi: ringkas?.jumlah_transaksi ?? 0,
      rows: rows.map((r) => ({ ...r, waktu: r.waktu.toISOString() })),
      bahan,
    };
    return c.json(kartu);
  })
  .patch(
    "/:id",
    requireRole("owner", "admin"),
    zValidator("json", SupplierBody.partial()),
    async (c) => {
      const auth = c.get("auth");
      const body = c.req.valid("json");
      const [row] = await tanpaBentrok("Nama supplier itu sudah dipakai", () =>
        db
          .update(suppliers)
          .set({
            ...(body.nama !== undefined && { nama: body.nama }),
            ...(body.telepon !== undefined && { telepon: body.telepon }),
            ...(body.alamat !== undefined && { alamat: body.alamat }),
            ...(body.catatan !== undefined && { catatan: body.catatan }),
            ...(body.kategori !== undefined && {
              kategori: body.kategori || null,
            }),
            ...(body.is_active !== undefined && { isActive: body.is_active }),
          })
          .where(
            and(
              eq(suppliers.id, c.req.param("id")),
              eq(suppliers.companyId, auth.company_id!),
            ),
          )
          .returning(),
      );
      if (!row)
        throw new HTTPException(404, { message: "Supplier tidak ditemukan" });
      return c.json(toDto(row));
    },
  );

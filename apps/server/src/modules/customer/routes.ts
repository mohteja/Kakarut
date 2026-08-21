import { zValidator } from "../../lib/validator";
import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { CustomerDetail, CustomerDto, MemberCariRow } from "@kakarut/shared";
import { db } from "../../db/client";
import { branches, customers, sales } from "../../db/schema";
import type { AppEnv } from "../../middleware/auth";
import { cariCustomerSetara, normalizeWa } from "./service";

/**
 * Pencarian member ringan untuk autocomplete di keranjang kasir — SEMUA peran
 * (tidak digerbang owner/admin seperti /customer). Hanya id/nama/wa (tanpa
 * agregasi belanja). Cocokkan nama ATAU nomor WA; tanpa q → member terbaru.
 */
export const memberCariRoutes = new Hono<AppEnv>().get("/", async (c) => {
  const auth = c.get("auth");
  const q = (c.req.query("q") ?? "").trim();
  const filter = q
    ? and(
        eq(customers.companyId, auth.company_id!),
        or(ilike(customers.nama, `%${q}%`), ilike(customers.wa, `%${q}%`)),
      )
    : eq(customers.companyId, auth.company_id!);
  const rows = await db
    .select({ id: customers.id, nama: customers.nama, wa: customers.wa })
    .from(customers)
    .where(filter)
    .orderBy(desc(customers.updatedAt))
    .limit(8);
  return c.json(rows satisfies MemberCariRow[]);
});

const CustomerBody = z.object({
  nama: z.string().trim().min(1),
  wa: z.string().trim().min(1),
  catatan: z.string().nullish(),
});

export const customerRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const auth = c.get("auth");
    const rows = await db
      .select({
        id: customers.id,
        nama: customers.nama,
        wa: customers.wa,
        catatan: customers.catatan,
        jumlah_transaksi: sql<number>`COUNT(${sales.id})::int`,
        total_belanja: sql<number>`COALESCE(SUM(${sales.total}), 0)::float8`,
        terakhir: sql<string | null>`MAX(${sales.waktu})`,
      })
      .from(customers)
      .leftJoin(sales, and(eq(sales.customerId, customers.id), isNull(sales.deletedAt)))
      .where(eq(customers.companyId, auth.company_id!))
      .groupBy(customers.id)
      .orderBy(sql`MAX(${sales.waktu}) DESC NULLS LAST`);
    return c.json(rows satisfies CustomerDto[]);
  })
  .get("/:id", async (c) => {
    const auth = c.get("auth");
    const [cust] = await db
      .select()
      .from(customers)
      .where(and(eq(customers.id, c.req.param("id")), eq(customers.companyId, auth.company_id!)));
    if (!cust) throw new HTTPException(404, { message: "Member tidak ditemukan" });
    const transaksi = await db
      .select({
        id: sales.id,
        nomor: sales.nomor,
        waktu: sales.waktu,
        total: sales.total,
        cabang: branches.nama,
      })
      .from(sales)
      .leftJoin(branches, eq(sales.branchId, branches.id))
      .where(
        and(
          eq(sales.customerId, cust.id),
          eq(sales.companyId, auth.company_id!),
          isNull(sales.deletedAt),
        ),
      )
      .orderBy(desc(sales.waktu));
    const iso = (d: Date | string) => (d instanceof Date ? d.toISOString() : String(d));
    const total_belanja = transaksi.reduce((a, t) => a + Number(t.total), 0);
    const detail: CustomerDetail = {
      id: cust.id,
      nama: cust.nama,
      wa: cust.wa,
      catatan: cust.catatan,
      jumlah_transaksi: transaksi.length,
      total_belanja,
      terakhir: transaksi[0] ? iso(transaksi[0].waktu) : null,
      transaksi: transaksi.map((t) => ({
        id: t.id,
        nomor: t.nomor,
        waktu: iso(t.waktu),
        total: t.total,
        cabang: t.cabang ?? "",
      })),
    };
    return c.json(detail);
  })
  .post("/", zValidator("json", CustomerBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const wa = normalizeWa(body.wa);
    if (!wa) throw new HTTPException(400, { message: "Nomor WhatsApp tidak valid" });
    // Bentrok diperiksa lintas VARIAN, bukan cuma teks persis. Tanpa ini,
    // member yang tersimpan `0812…` tak terlihat saat orang mengetik
    // `+62812…`, dan halaman ini dengan tenang membuat orang kedua.
    const setara = await cariCustomerSetara(db, auth.company_id!, wa);
    if (setara) {
      throw new HTTPException(409, {
        message: `Nomor ini sudah terdaftar atas nama ${setara.nama} (tersimpan sebagai ${setara.wa})`,
      });
    }
    const [row] = await db
      .insert(customers)
      .values({
        companyId: auth.company_id!,
        nama: body.nama,
        wa,
        catatan: body.catatan ?? null,
      })
      .onConflictDoNothing()
      .returning();
    if (!row) throw new HTTPException(409, { message: `Member dengan WA ${wa} sudah terdaftar` });
    return c.json(row, 201);
  })
  .put("/:id", zValidator("json", CustomerBody.partial()), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const id = c.req.param("id");
    let waBaru: string | undefined;
    if (body.wa !== undefined) {
      const wa = normalizeWa(body.wa);
      if (!wa) throw new HTTPException(400, { message: "Nomor WhatsApp tidak valid" });
      // Pastikan WA tak dipakai member lain — lintas VARIAN, sama seperti POST.
      const bentrok = await cariCustomerSetara(db, auth.company_id!, wa, id);
      if (bentrok) {
        throw new HTTPException(409, {
          message: `Nomor ini sudah dipakai member lain: ${bentrok.nama} (tersimpan sebagai ${bentrok.wa})`,
        });
      }
      waBaru = wa;
    }
    const [row] = await db
      .update(customers)
      .set({
        ...(body.nama !== undefined && { nama: body.nama }),
        ...(waBaru !== undefined && { wa: waBaru }),
        ...(body.catatan !== undefined && { catatan: body.catatan ?? null }),
        updatedAt: new Date(),
      })
      .where(and(eq(customers.id, id), eq(customers.companyId, auth.company_id!)))
      .returning();
    if (!row) throw new HTTPException(404, { message: "Member tidak ditemukan" });
    return c.json(row);
  })
  .delete("/:id", async (c) => {
    const auth = c.get("auth");
    const [row] = await db
      .delete(customers)
      .where(and(eq(customers.id, c.req.param("id")), eq(customers.companyId, auth.company_id!)))
      .returning();
    if (!row) throw new HTTPException(404, { message: "Member tidak ditemukan" });
    return c.json({ ok: true });
  });

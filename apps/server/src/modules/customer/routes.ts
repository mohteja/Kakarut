import { zValidator } from "../../lib/validator";
import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type {
  CustomerDetail,
  CustomerDto,
  CustomerListDto,
  MemberCariRow,
} from "@kakarut/shared";
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

/**
 * BALASAN YANG TUMBUH SEUMUR WARUNG.
 *
 * Kedua pintu di bawah dulu mengirim SEMUANYA. Terukur pada basis data
 * sungguhan: `GET /customer` dengan 10.002 member → **1,61 MB**; satu
 * `GET /customer/:id` atas member dengan 20.001 transaksi → **2,97 MB**.
 * Tak ada galat, tak ada peringatan — hanya balasan yang membesar setiap
 * bulan sampai halaman Member berhenti bisa dibuka.
 *
 * Yang membuat pemotongan tidak sesederhana menempelkan `.limit()`: kedua
 * pintu itu MENGHITUNG dari larik yang sama yang dikirimnya. `total_belanja`
 * dan `jumlah_transaksi` dulu dijumlahkan di JavaScript dari seluruh baris,
 * jadi `.limit(300)` yang polos akan menjawab "Total belanja Rp 3.000.000"
 * untuk member yang sebenarnya sudah belanja Rp 40.000.000 — angka salah yang
 * kelihatan wajar. Karena itu agregatnya dipindah ke SQL (tanpa batas) LEBIH
 * DULU, baru daftarnya dipotong.
 *
 * Sisi yang sama pentingnya: memotong daftar TANPA menyediakan pencarian di
 * server membuat member ke-301 tak bisa ditemukan sama sekali — halaman Member
 * menyaring di browser, jadi yang tak terkirim tak pernah ada baginya. Pintu
 * saudaranya di berkas ini, `memberCariRoutes`, sudah mencari di server sejak
 * awal; `GET /customer` sekarang memakai penyaring yang sama.
 */
const BATAS_MEMBER = 300;
const BATAS_TRANSAKSI_MEMBER = 300;

const CustomerBody = z.object({
  nama: z.string().trim().min(1),
  wa: z.string().trim().min(1),
  catatan: z.string().nullish(),
});

export const customerRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const auth = c.get("auth");
    const q = (c.req.query("q") ?? "").trim();
    // Penyaring yang SAMA dengan `memberCariRoutes` di atas — nama ATAU nomor
    // WA. Disamakan dengan sengaja: dua kotak pencarian member yang menjawab
    // beda untuk ketikan yang sama adalah cacat tersendiri.
    const filter = q
      ? and(
          eq(customers.companyId, auth.company_id!),
          or(ilike(customers.nama, `%${q}%`), ilike(customers.wa, `%${q}%`)),
        )
      : eq(customers.companyId, auth.company_id!);
    const [rows, [hitung]] = await Promise.all([
      db
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
        .where(filter)
        .groupBy(customers.id)
        .orderBy(sql`MAX(${sales.waktu}) DESC NULLS LAST`)
        .limit(BATAS_MEMBER + 1),
      // Hitungan sebenarnya, TANPA batas — judul halaman menyebut "Member (N)"
      // dan N itu harus jumlah member yang cocok, bukan jumlah yang terkirim.
      db
        .select({ n: sql<number>`COUNT(*)::int` })
        .from(customers)
        .where(filter),
    ]);
    const terpotong = rows.length > BATAS_MEMBER;
    return c.json({
      items: (terpotong ? rows.slice(0, BATAS_MEMBER) : rows) satisfies CustomerDto[],
      terpotong,
      total: hitung?.n ?? 0,
    } satisfies CustomerListDto);
  })
  .get("/:id", async (c) => {
    const auth = c.get("auth");
    const [cust] = await db
      .select()
      .from(customers)
      .where(and(eq(customers.id, c.req.param("id")), eq(customers.companyId, auth.company_id!)));
    if (!cust) throw new HTTPException(404, { message: "Member tidak ditemukan" });
    const milikMember = and(
      eq(sales.customerId, cust.id),
      eq(sales.companyId, auth.company_id!),
      isNull(sales.deletedAt),
    );
    // Agregat DULU, tanpa batas, dari basis data — bukan dari larik di bawah.
    // Ini yang membuat pemotongan daftar aman: seberapa pun daftarnya dipotong,
    // ketiga angka ini tetap menghitung seluruh transaksi member.
    const [ringkas, transaksi] = await Promise.all([
      db
        .select({
          jumlah_transaksi: sql<number>`COUNT(*)::int`,
          total_belanja: sql<number>`COALESCE(SUM(${sales.total}), 0)::float8`,
          terakhir: sql<string | null>`MAX(${sales.waktu})`,
        })
        .from(sales)
        .where(milikMember),
      db
        .select({
          id: sales.id,
          nomor: sales.nomor,
          waktu: sales.waktu,
          total: sales.total,
          cabang: branches.nama,
        })
        .from(sales)
        .leftJoin(branches, eq(sales.branchId, branches.id))
        .where(milikMember)
        .orderBy(desc(sales.waktu))
        .limit(BATAS_TRANSAKSI_MEMBER + 1),
    ]);
    const iso = (d: Date | string) => (d instanceof Date ? d.toISOString() : String(d));
    const terpotong = transaksi.length > BATAS_TRANSAKSI_MEMBER;
    const tampil = terpotong ? transaksi.slice(0, BATAS_TRANSAKSI_MEMBER) : transaksi;
    const detail: CustomerDetail = {
      id: cust.id,
      nama: cust.nama,
      wa: cust.wa,
      catatan: cust.catatan,
      jumlah_transaksi: ringkas[0]?.jumlah_transaksi ?? 0,
      total_belanja: ringkas[0]?.total_belanja ?? 0,
      terakhir: ringkas[0]?.terakhir ? iso(ringkas[0].terakhir) : null,
      transaksi: tampil.map((t) => ({
        id: t.id,
        nomor: t.nomor,
        waktu: iso(t.waktu),
        total: t.total,
        cabang: t.cabang ?? "",
      })),
      transaksi_terpotong: terpotong,
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

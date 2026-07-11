import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, gte, isNotNull, isNull, lte, sql, sum } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Shift } from "@kakarut/shared";
import { db } from "../../db/client";
import { branches, sales, shifts, users } from "../../db/schema";
import { resolveBranchId, type AppEnv } from "../../middleware/auth";

const opener = alias(users, "shift_opener");
const closer = alias(users, "shift_closer");

/** Rekap penjualan pada jendela waktu shift (tunai vs non-tunai). */
async function rekapWindow(
  companyId: string,
  branchId: string,
  openedAt: Date,
  closedAt: Date | null,
) {
  const rows = await db
    .select({
      metode: sales.metodeBayar,
      total: sum(sales.total),
      jumlah: sql<number>`count(*)::int`,
    })
    .from(sales)
    .where(
      and(
        eq(sales.companyId, companyId),
        eq(sales.branchId, branchId),
        isNull(sales.deletedAt),
        gte(sales.waktu, openedAt),
        closedAt ? lte(sales.waktu, closedAt) : undefined,
      ),
    )
    .groupBy(sales.metodeBayar);
  let tunai = 0;
  let nontunai = 0;
  let jumlah = 0;
  for (const r of rows) {
    const t = Number(r.total ?? 0);
    if (r.metode === "tunai") tunai += t;
    else nontunai += t;
    jumlah += r.jumlah;
  }
  return { penjualan_tunai: tunai, penjualan_nontunai: nontunai, jumlah_transaksi: jumlah };
}

type ShiftJoinRow = {
  id: string;
  companyId: string;
  branchId: string;
  openedAt: Date;
  modalAwal: number;
  closedAt: Date | null;
  uangFisik: number | null;
  catatan: string | null;
  branch_nama: string | null;
  opener: string | null;
  closer: string | null;
};

function baseSelect() {
  return db
    .select({
      id: shifts.id,
      companyId: shifts.companyId,
      branchId: shifts.branchId,
      openedAt: shifts.openedAt,
      modalAwal: shifts.modalAwal,
      closedAt: shifts.closedAt,
      uangFisik: shifts.uangFisik,
      catatan: shifts.catatan,
      branch_nama: branches.nama,
      opener: opener.nama,
      closer: closer.nama,
    })
    .from(shifts)
    .leftJoin(branches, eq(shifts.branchId, branches.id))
    .leftJoin(opener, eq(shifts.openedBy, opener.id))
    .leftJoin(closer, eq(shifts.closedBy, closer.id));
}

async function toDto(r: ShiftJoinRow): Promise<Shift> {
  const rekap = await rekapWindow(r.companyId, r.branchId, r.openedAt, r.closedAt);
  const kas_sistem = r.modalAwal + rekap.penjualan_tunai;
  return {
    id: r.id,
    branch_nama: r.branch_nama ?? "",
    dibuka_oleh: r.opener ?? "",
    dibuka_pada: r.openedAt.toISOString(),
    ditutup_oleh: r.closer,
    ditutup_pada: r.closedAt ? r.closedAt.toISOString() : null,
    modal_awal: r.modalAwal,
    uang_fisik: r.uangFisik,
    catatan: r.catatan,
    ...rekap,
    kas_sistem,
    selisih: r.uangFisik != null ? r.uangFisik - kas_sistem : null,
  };
}

export const shiftRoutes = new Hono<AppEnv>()
  // shift terbuka saat ini di cabang (null bila tak ada) + rekap live
  .get("/aktif", async (c) => {
    const auth = c.get("auth");
    const branchId = await resolveBranchId(c);
    const [row] = await baseSelect().where(
      and(
        eq(shifts.companyId, auth.company_id!),
        eq(shifts.branchId, branchId),
        isNull(shifts.closedAt),
      ),
    );
    if (!row) return c.json(null);
    return c.json(await toDto(row));
  })
  // riwayat shift (yang sudah ditutup) di cabang
  .get("/", async (c) => {
    const auth = c.get("auth");
    const branchId = await resolveBranchId(c);
    const rows = await baseSelect()
      .where(
        and(
          eq(shifts.companyId, auth.company_id!),
          eq(shifts.branchId, branchId),
          isNotNull(shifts.closedAt),
        ),
      )
      .orderBy(desc(shifts.openedAt))
      .limit(50);
    return c.json(await Promise.all(rows.map(toDto)));
  })
  .post("/buka", zValidator("json", z.object({ modal_awal: z.number().nonnegative().default(0) })), async (c) => {
    const auth = c.get("auth");
    const branchId = await resolveBranchId(c);
    if (auth.role === "cashier" && branchId !== auth.branch_id) {
      throw new HTTPException(403, { message: "Kasir hanya boleh membuka shift di cabangnya" });
    }
    const [open] = await db
      .select({ id: shifts.id })
      .from(shifts)
      .where(and(eq(shifts.branchId, branchId), isNull(shifts.closedAt)));
    if (open) {
      throw new HTTPException(400, { message: "Masih ada shift kasir yang terbuka di cabang ini" });
    }
    const [ins] = await db
      .insert(shifts)
      .values({
        companyId: auth.company_id!,
        branchId,
        openedBy: auth.sub,
        modalAwal: c.req.valid("json").modal_awal,
      })
      .returning({ id: shifts.id });
    const [row] = await baseSelect().where(eq(shifts.id, ins.id));
    return c.json(await toDto(row), 201);
  })
  .post(
    "/tutup",
    zValidator("json", z.object({ uang_fisik: z.number().nonnegative(), catatan: z.string().nullish() })),
    async (c) => {
      const auth = c.get("auth");
      const branchId = await resolveBranchId(c);
      const body = c.req.valid("json");
      const [open] = await db
        .select({ id: shifts.id })
        .from(shifts)
        .where(
          and(
            eq(shifts.companyId, auth.company_id!),
            eq(shifts.branchId, branchId),
            isNull(shifts.closedAt),
          ),
        );
      if (!open) throw new HTTPException(400, { message: "Tidak ada shift kasir yang terbuka" });
      await db
        .update(shifts)
        .set({
          closedBy: auth.sub,
          closedAt: new Date(),
          uangFisik: body.uang_fisik,
          catatan: body.catatan ?? null,
        })
        .where(eq(shifts.id, open.id));
      const [row] = await baseSelect().where(eq(shifts.id, open.id));
      return c.json(await toDto(row));
    },
  );

import { zValidator } from "@hono/zod-validator";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, sql, sum } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Shift, ShiftDetail, ShiftPantauRow, ShiftTransaksiRow } from "@kakarut/shared";
import { db } from "../../db/client";
import { branches, companies, sales, shifts, users } from "../../db/schema";
import { requireRole, resolveBranchId, terikatCabang, type AppEnv } from "../../middleware/auth";
import { tanggalDi, waktuDi } from "../../lib/time";
import { sedangHadir } from "../absensi/routes";

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

/** Daftar transaksi individual pada jendela waktu shift (untuk detail). */
async function transaksiWindow(
  companyId: string,
  branchId: string,
  openedAt: Date,
  closedAt: Date | null,
): Promise<ShiftTransaksiRow[]> {
  const rows = await db
    .select({
      id: sales.id,
      nomor: sales.nomor,
      waktu: sales.waktu,
      total: sales.total,
      metode: sales.metodeBayar,
      kasir: users.nama,
    })
    .from(sales)
    .leftJoin(users, eq(sales.cashierUserId, users.id))
    .where(
      and(
        eq(sales.companyId, companyId),
        eq(sales.branchId, branchId),
        isNull(sales.deletedAt),
        gte(sales.waktu, openedAt),
        closedAt ? lte(sales.waktu, closedAt) : undefined,
      ),
    )
    .orderBy(desc(sales.waktu))
    .limit(300);
  return rows.map((r) => ({
    id: r.id,
    nomor: r.nomor,
    waktu: r.waktu.toISOString(),
    total: Number(r.total),
    metode: r.metode,
    kasir: r.kasir ?? null,
  }));
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
  // Pantau operasional semua cabang store (owner/admin): status kasir + rekap
  // hari ini + jam operasional + tanda telat buka / lupa tutup.
  .get("/pantau", requireRole("owner", "admin"), async (c) => {
    const auth = c.get("auth");
    const [comp] = await db
      .select({ tz: companies.timezone })
      .from(companies)
      .where(eq(companies.id, auth.company_id!));
    const tz = comp?.tz ?? "Asia/Jakarta";
    const today = tanggalDi(tz);
    const now = waktuDi(tz);
    const storeBranches = await db
      .select({
        id: branches.id,
        nama: branches.nama,
        jamBuka: branches.jamBuka,
        jamTutup: branches.jamTutup,
      })
      .from(branches)
      .where(
        and(
          eq(branches.companyId, auth.company_id!),
          eq(branches.tipe, "store"),
          eq(branches.isActive, true),
        ),
      )
      .orderBy(asc(branches.createdAt));
    if (storeBranches.length === 0) return c.json([] as ShiftPantauRow[]);
    const ids = storeBranches.map((b) => b.id);
    // Penjualan HARI INI (tanggal bisnis tz) per cabang & metode.
    const salesRows = await db
      .select({
        branchId: sales.branchId,
        metode: sales.metodeBayar,
        total: sum(sales.total),
        jumlah: sql<number>`count(*)::int`,
      })
      .from(sales)
      .where(
        and(
          eq(sales.companyId, auth.company_id!),
          inArray(sales.branchId, ids),
          eq(sales.saleDate, today),
          isNull(sales.deletedAt),
        ),
      )
      .groupBy(sales.branchId, sales.metodeBayar);
    // Shift yang sedang TERBUKA per cabang.
    const openRows = await baseSelect().where(
      and(
        eq(shifts.companyId, auth.company_id!),
        inArray(shifts.branchId, ids),
        isNull(shifts.closedAt),
      ),
    );
    // Cabang yang sudah membuka shift HARI INI (opened_at pada tz = hari ini).
    const openedTodayRows = await db
      .select({ branchId: shifts.branchId })
      .from(shifts)
      .where(
        and(
          eq(shifts.companyId, auth.company_id!),
          inArray(shifts.branchId, ids),
          sql`(${shifts.openedAt} AT TIME ZONE ${tz})::date = ${today}::date`,
        ),
      )
      .groupBy(shifts.branchId);

    const salesByBranch = new Map<string, { tunai: number; nontunai: number; jumlah: number }>();
    for (const r of salesRows) {
      const cur = salesByBranch.get(r.branchId) ?? { tunai: 0, nontunai: 0, jumlah: 0 };
      const t = Number(r.total ?? 0);
      if (r.metode === "tunai") cur.tunai += t;
      else cur.nontunai += t;
      cur.jumlah += Number(r.jumlah ?? 0);
      salesByBranch.set(r.branchId, cur);
    }
    const openByBranch = new Map(openRows.map((r) => [r.branchId, r]));
    const openedToday = new Set(openedTodayRows.map((r) => r.branchId));

    const hasil: ShiftPantauRow[] = storeBranches.map((b) => {
      const s = salesByBranch.get(b.id) ?? { tunai: 0, nontunai: 0, jumlah: 0 };
      const open = openByBranch.get(b.id) ?? null;
      const bukaHariIni = openedToday.has(b.id);
      return {
        branch_id: b.id,
        branch_nama: b.nama,
        jam_buka: b.jamBuka,
        jam_tutup: b.jamTutup,
        shift_id: open?.id ?? null,
        dibuka_oleh: open?.opener ?? null,
        dibuka_pada: open ? open.openedAt.toISOString() : null,
        modal_awal: open ? open.modalAwal : null,
        penjualan_tunai: s.tunai,
        penjualan_nontunai: s.nontunai,
        jumlah_transaksi: s.jumlah,
        kas_sistem: open ? open.modalAwal + s.tunai : 0,
        buka_hari_ini: bukaHariIni,
        telat_buka: Boolean(b.jamBuka) && !open && !bukaHariIni && now > b.jamBuka!,
        lupa_tutup: Boolean(open) && Boolean(b.jamTutup) && now > b.jamTutup!,
      };
    });
    return c.json(hasil);
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
  // detail satu shift = ringkasan + daftar transaksinya (kasir terkunci cabang)
  .get("/:id", async (c) => {
    const auth = c.get("auth");
    const [row] = await baseSelect().where(
      and(eq(shifts.id, c.req.param("id")), eq(shifts.companyId, auth.company_id!)),
    );
    if (!row) throw new HTTPException(404, { message: "Shift tidak ditemukan" });
    if (terikatCabang(auth.role) && row.branchId !== auth.branch_id) {
      throw new HTTPException(403, { message: "Shift bukan dari cabang Anda" });
    }
    const dto = await toDto(row);
    const transaksi = await transaksiWindow(row.companyId, row.branchId, row.openedAt, row.closedAt);
    return c.json({ ...dto, transaksi } satisfies ShiftDetail);
  })
  .post(
    "/buka",
    requireRole("cashier"),
    zValidator("json", z.object({ modal_awal: z.number().nonnegative().default(0) })),
    async (c) => {
      const auth = c.get("auth");
      const branchId = await resolveBranchId(c);
      if (terikatCabang(auth.role) && branchId !== auth.branch_id) {
        throw new HTTPException(403, { message: "Kasir hanya boleh membuka shift di cabangnya" });
      }
      // Wajib ABSEN dulu: kasir harus sudah absen masuk (dan belum keluar) hari ini
      // di cabangnya sebelum boleh buka kasir.
      if (!(await sedangHadir(auth.company_id!, branchId, auth.sub))) {
        throw new HTTPException(400, {
          message: "Absen masuk dulu sebelum buka kasir",
        });
      }
      const [open] = await db
        .select({ id: shifts.id })
        .from(shifts)
        .where(and(eq(shifts.branchId, branchId), isNull(shifts.closedAt)));
      if (open) {
        throw new HTTPException(400, {
          message: "Masih ada shift kasir yang terbuka di cabang ini",
        });
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
    },
  )
  .post(
    "/tutup",
    requireRole("cashier"),
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

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
const penyetuju = alias(users, "shift_penyetuju");

/** Selisih kas dianggap NOL di bawah ini (pembulatan numeric(…,2)). */
const EPS_KAS = 0.005;

/**
 * Sale yang masuk hitungan sebuah shift.
 *
 * Dua jalur yang SALING EKSKLUSIF, jadi tidak ada risiko hitung ganda:
 * 1. `shift_id` = shift ini — penautan eksplisit. Dipakai transaksi susulan
 *    dari sinkron offline, yang `waktu`-nya bisa jatuh SETELAH `closed_at`
 *    (kasir masih melayani saat perangkat offline, shift ditutup dari tempat
 *    lain). Tanpa jalur ini uangnya tidak muncul di rekap mana pun.
 * 2. `shift_id IS NULL` + `waktu` di dalam jendela — perilaku lama, dipakai
 *    seluruh transaksi online biasa dan semua baris sebelum kolom `shift_id`
 *    ada. Karena itu kolom baru tidak perlu di-backfill.
 */
function milikShift(shiftId: string, openedAt: Date, closedAt: Date | null) {
  return sql`(${sales.shiftId} = ${shiftId} OR (${sales.shiftId} IS NULL AND ${sales.waktu} >= ${openedAt}${
    closedAt ? sql` AND ${sales.waktu} <= ${closedAt}` : sql``
  }))`;
}

/** Rekap penjualan sebuah shift (tunai vs non-tunai). */
async function rekapWindow(
  companyId: string,
  branchId: string,
  shiftId: string,
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
        milikShift(shiftId, openedAt, closedAt),
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

/** Daftar transaksi individual sebuah shift (untuk detail). */
async function transaksiWindow(
  companyId: string,
  branchId: string,
  shiftId: string,
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
        milikShift(shiftId, openedAt, closedAt),
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
    // transaksi yang tiba lewat sinkron setelah shift ditutup: waktunya di luar
    // jendela, jadi kasir perlu tahu baris ini yang menggeser rekap penutupan
    susulan: closedAt != null && r.waktu > closedAt,
  }));
}

/**
 * Buka shift kasir. SATU sumber untuk jalur online (`POST /shift/buka`) dan
 * jalur sinkron offline (`tipe:"shift_buka"`) supaya guard-nya tak bisa
 * menyimpang di antara keduanya.
 *
 * `waktu` = kapan shift BENAR-BENAR dibuka. Jalur online membiarkannya kosong
 * (pakai jam server); jalur sinkron mengisinya dengan waktu kejadian, sehingga
 * penjualan offline sepanjang hari itu jatuh di dalam jendela shift secara
 * wajar — tanpa perlu bersandar pada toleransi transaksi susulan.
 *
 * Sudah ada shift terbuka di cabang ini → BUKAN error. Ada indeks unik
 * `shifts_open_per_branch_uq` (satu shift terbuka per cabang), dan menggagalkan
 * perintah sinkron berarti seluruh penjualan yang bersandar padanya kehilangan
 * tempat berpijak — persis kelas bug yang baru saja ditutup. Kembalikan shift
 * yang sudah ada dan tandai `sudah_terbuka`, biar pemanggil yang memberi tahu.
 */
export async function bukaShift(params: {
  companyId: string;
  branchId: string;
  userId: string;
  modalAwal: number;
  waktu?: Date;
}): Promise<{ shift: Shift; sudahTerbuka: boolean }> {
  if (!(await sedangHadir(params.companyId, params.branchId, params.userId, params.waktu))) {
    throw new HTTPException(400, { message: "Absen masuk dulu sebelum buka kasir" });
  }
  const [open] = await db
    .select({ id: shifts.id })
    .from(shifts)
    .where(and(eq(shifts.branchId, params.branchId), isNull(shifts.closedAt)));
  if (open) {
    const [row] = await baseSelect().where(eq(shifts.id, open.id));
    return { shift: await toDto(row), sudahTerbuka: true };
  }
  const [ins] = await db
    .insert(shifts)
    .values({
      companyId: params.companyId,
      branchId: params.branchId,
      openedBy: params.userId,
      modalAwal: params.modalAwal,
      ...(params.waktu ? { openedAt: params.waktu } : {}),
    })
    .returning({ id: shifts.id });
  const [row] = await baseSelect().where(eq(shifts.id, ins.id));
  return { shift: await toDto(row), sudahTerbuka: false };
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
  adaTransaksiSusulan: boolean;
  branch_nama: string | null;
  opener: string | null;
  closer: string | null;
  selisihStatus: "menunggu" | "disetujui" | "ditolak" | null;
  selisihAlasan: string | null;
  disetujuiAt: Date | null;
  tolakAlasan: string | null;
  penyetuju: string | null;
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
      adaTransaksiSusulan: shifts.adaTransaksiSusulan,
      branch_nama: branches.nama,
      opener: opener.nama,
      closer: closer.nama,
      selisihStatus: shifts.selisihStatus,
      selisihAlasan: shifts.selisihAlasan,
      disetujuiAt: shifts.disetujuiAt,
      tolakAlasan: shifts.tolakAlasan,
      penyetuju: penyetuju.nama,
    })
    .from(shifts)
    .leftJoin(branches, eq(shifts.branchId, branches.id))
    .leftJoin(opener, eq(shifts.openedBy, opener.id))
    .leftJoin(closer, eq(shifts.closedBy, closer.id))
    .leftJoin(penyetuju, eq(shifts.disetujuiOleh, penyetuju.id));
}

/**
 * HITUNG BUTA: selagi shift masih TERBUKA, peran terkunci cabang (kasir/tim)
 * tidak boleh melihat kas yang seharusnya ada di laci.
 *
 * Kalau angka itu terlihat lebih dulu, penghitungan uang berhenti menjadi
 * pemeriksaan — tinggal disalin, dan selisih apa pun takkan pernah muncul.
 * Owner/admin tak pernah dibutakan: merekalah yang menyetujui selisih, dan
 * mereka memang perlu memantau kas berjalan.
 *
 * Angka aslinya dibuka pada respons `POST /shift/tutup`, yakni SETELAH uang
 * fisik dikirim — itu momen "reveal"-nya.
 */
function butaUntuk(role: string | null, closedAt: Date | null): boolean {
  return closedAt == null && terikatCabang(role);
}

async function toDto(r: ShiftJoinRow, role?: string | null): Promise<Shift> {
  const rekap = await rekapWindow(r.companyId, r.branchId, r.id, r.openedAt, r.closedAt);
  const kasAsli = r.modalAwal + rekap.penjualan_tunai;
  const buta = role != null && butaUntuk(role, r.closedAt);
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
    // yang dibutakan HANYA jejak tunai — jumlah transaksi & non-tunai tetap
    // tampil supaya kasir masih bisa memantau shiftnya berjalan.
    penjualan_tunai: buta ? 0 : rekap.penjualan_tunai,
    kas_sistem: buta ? null : kasAsli,
    selisih: buta || r.uangFisik == null ? null : r.uangFisik - kasAsli,
    ada_transaksi_susulan: r.adaTransaksiSusulan,
    buta,
    selisih_status: r.selisihStatus,
    selisih_alasan: r.selisihAlasan,
    disetujui_oleh: r.penyetuju,
    disetujui_pada: r.disetujuiAt ? r.disetujuiAt.toISOString() : null,
    tolak_alasan: r.tolakAlasan,
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
    return c.json(await toDto(row, auth.role));
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
    // Riwayat = shift yang SUDAH ditutup, jadi tak ada yang dibutakan di sini.
    return c.json(await Promise.all(rows.map((r) => toDto(r, auth.role))));
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
    const dto = await toDto(row, auth.role);
    const transaksi = await transaksiWindow(row.companyId, row.branchId, row.id, row.openedAt, row.closedAt);
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
      const { shift, sudahTerbuka } = await bukaShift({
        companyId: auth.company_id!,
        branchId,
        userId: auth.sub,
        modalAwal: c.req.valid("json").modal_awal,
      });
      // Jalur online tetap MENOLAK bila sudah ada shift terbuka: kasir ada di
      // depan layar dan harus tahu shift-nya bukan yang baru saja ia buka.
      // (Jalur sinkron memilih sikap berbeda — lihat komentar di bukaShift.)
      if (sudahTerbuka) {
        throw new HTTPException(400, {
          message: "Masih ada shift kasir yang terbuka di cabang ini",
        });
      }
      return c.json(shift, 201);
    },
  )
  /**
   * TUTUP KASIR — momen "reveal" dari hitung buta.
   *
   * Kasir mengirim uang fisik hasil hitungan laci TANPA pernah melihat kas
   * sistem (lihat `butaUntuk`). Respons endpoint inilah yang pertama kali
   * membuka `kas_sistem` dan `selisih` — jadi angka yang dikirim benar-benar
   * hasil menghitung, bukan hasil menyalin.
   *
   * Selisih apa pun (lebih maupun kurang) langsung berstatus "menunggu"
   * persetujuan owner/admin; kasir tak bisa meng-ACC selisihnya sendiri.
   * Uang fisik yang PAS tak butuh persetujuan (`selisih_status` tetap null).
   */
  .post(
    "/tutup",
    requireRole("cashier"),
    zValidator(
      "json",
      z.object({
        uang_fisik: z.number().nonnegative(),
        catatan: z.string().nullish(),
        /** keterangan kasir bila hitungannya tak pas (mis. "kembalian kurang") */
        selisih_alasan: z.string().trim().max(300).nullish(),
      }),
    ),
    async (c) => {
      const auth = c.get("auth");
      const branchId = await resolveBranchId(c);
      const body = c.req.valid("json");
      const [open] = await db
        .select({ id: shifts.id, modalAwal: shifts.modalAwal, openedAt: shifts.openedAt })
        .from(shifts)
        .where(
          and(
            eq(shifts.companyId, auth.company_id!),
            eq(shifts.branchId, branchId),
            isNull(shifts.closedAt),
          ),
        );
      if (!open) throw new HTTPException(400, { message: "Tidak ada shift kasir yang terbuka" });
      // Kas sistem dihitung DI SINI (server), bukan dikirim klien — klien tak
      // pernah memegang angka ini sebelum penutupan.
      const rekap = await rekapWindow(auth.company_id!, branchId, open.id, open.openedAt, null);
      const selisih = body.uang_fisik - (open.modalAwal + rekap.penjualan_tunai);
      const perluAcc = Math.abs(selisih) > EPS_KAS;
      await db
        .update(shifts)
        .set({
          closedBy: auth.sub,
          closedAt: new Date(),
          uangFisik: body.uang_fisik,
          catatan: body.catatan ?? null,
          selisihStatus: perluAcc ? "menunggu" : null,
          // `catatan` jadi cadangan: klien lama (dan mobile) hanya punya satu
          // kolom catatan, dan di praktiknya itulah keterangan selisihnya.
          // Tanpa cadangan ini penjelasan kasir hilang dalam perjalanan ke owner.
          selisihAlasan: perluAcc
            ? (body.selisih_alasan?.trim() || body.catatan?.trim() || null)
            : null,
        })
        .where(eq(shifts.id, open.id));
      const [row] = await baseSelect().where(eq(shifts.id, open.id));
      return c.json(await toDto(row, auth.role));
    },
  )
  /**
   * Owner/admin memutuskan selisih kas: terima apa adanya (disetujui) atau
   * tolak dengan alasan. Sengaja TIDAK mengubah angka apa pun — uang fisik &
   * kas sistem adalah fakta yang sudah terjadi; yang dicatat di sini adalah
   * KEPUTUSANNYA, lengkap dengan siapa dan kapan.
   */
  .post(
    "/:id/selisih",
    requireRole("owner", "admin"),
    zValidator(
      "json",
      z.object({
        keputusan: z.enum(["disetujui", "ditolak"]),
        alasan: z.string().trim().max(300).nullish(),
      }),
    ),
    async (c) => {
      const auth = c.get("auth");
      const body = c.req.valid("json");
      const [row] = await db
        .select({ id: shifts.id, selisihStatus: shifts.selisihStatus })
        .from(shifts)
        .where(
          and(eq(shifts.id, c.req.param("id")), eq(shifts.companyId, auth.company_id!)),
        );
      if (!row) throw new HTTPException(404, { message: "Shift tidak ditemukan" });
      if (row.selisihStatus == null) {
        throw new HTTPException(400, {
          message: "Shift ini tak punya selisih kas yang perlu diputuskan",
        });
      }
      if (body.keputusan === "ditolak" && !body.alasan?.trim()) {
        throw new HTTPException(400, { message: "Alasan wajib diisi saat menolak selisih" });
      }
      await db
        .update(shifts)
        .set({
          selisihStatus: body.keputusan,
          disetujuiOleh: auth.sub,
          disetujuiAt: new Date(),
          tolakAlasan: body.keputusan === "ditolak" ? body.alasan!.trim() : null,
        })
        .where(eq(shifts.id, row.id));
      const [after] = await baseSelect().where(eq(shifts.id, row.id));
      return c.json(await toDto(after, auth.role));
    },
  );

import { zValidator } from "@hono/zod-validator";
import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql, sum } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  formatRupiahAscii as rupiah,
  type SelisihKasRow,
  type Shift,
  type ShiftDetail,
  type ShiftPantauRow,
  type ShiftTransaksiRow,
} from "@kakarut/shared";
import { db } from "../../db/client";
import { branches, companies, saleRefunds, sales, shifts, users } from "../../db/schema";
import {
  branchUntukTulis,
  requireRole,
  resolveBranchId,
  terikatCabang,
  type AppEnv,
} from "../../middleware/auth";
import { bentrokUnik } from "../../lib/pg-galat";
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

/**
 * Refund yang DITANGGUNG sebuah shift — laci tempat uangnya keluar.
 *
 * Dua jalur, saling eksklusif seperti `milikShift`:
 * 1. `shift_id` = shift ini — penautan eksplisit, diisi saat refund dibuat
 *    selagi shift ini terbuka.
 * 2. `shift_id IS NULL` = TAK ADA shift terbuka saat refund dibuat (owner/admin
 *    meninjau di luar jam buka — jalur yang memang disengaja). Baris itu disapu
 *    oleh shift PERTAMA yang dibuka sesudahnya di cabang ini: laci itulah yang
 *    uangnya benar-benar keluar. Tanpa penyapuan ini uangnya tidak muncul di
 *    rekap mana pun — persis kegagalan yang dulu ditutup untuk `sales`.
 *
 * Tidak ada risiko hitung ganda: sesudah migrasi 0094 (yang mem-backfill baris
 * lama memakai aturan jendela), `shift_id IS NULL` HANYA terjadi bila memang
 * tak ada shift terbuka — jadi baris itu mustahil sekaligus jatuh di dalam
 * jendela shift lain.
 */
function refundShift(shiftId: string, companyId: string, branchId: string, openedAt: Date) {
  return sql`(${saleRefunds.shiftId} = ${shiftId} OR (${saleRefunds.shiftId} IS NULL AND ${saleRefunds.createdAt} < ${openedAt} AND NOT EXISTS (
    SELECT 1 FROM ${shifts} s2
    WHERE s2.company_id = ${companyId} AND s2.branch_id = ${branchId}
      AND s2.opened_at > ${saleRefunds.createdAt} AND s2.opened_at < ${openedAt})))`;
}

/** Shift yang sedang terbuka di cabang — 400 bila tak ada. */
async function shiftTerbuka(companyId: string, branchId: string) {
  const [open] = await db
    .select({
      id: shifts.id,
      modalAwal: shifts.modalAwal,
      openedAt: shifts.openedAt,
      uangFisik: shifts.uangFisik,
    })
    .from(shifts)
    .where(
      and(eq(shifts.companyId, companyId), eq(shifts.branchId, branchId), isNull(shifts.closedAt)),
    );
  if (!open) throw new HTTPException(400, { message: "Tidak ada shift kasir yang terbuka" });
  return open;
}

/**
 * Rekap penjualan sebuah shift (tunai vs non-tunai).
 *
 * REFUND DIHITUNG PADA SHIFT TEMPAT UANGNYA KELUAR LACI, bukan pada shift
 * transaksi aslinya. Refund menyusutkan `sales.total`, jadi menjumlah kolom itu
 * apa adanya akan menggeser rekap shift yang SUDAH DITUTUP: uangnya dulu benar
 * masuk dan sudah dihitung cocok saat tutup kasir, lalu berkurang sendiri
 * berhari-hari kemudian — sementara shift yang benar-benar mengeluarkan uangnya
 * tidak mencatat apa pun dan malah terlihat kelebihan kas.
 *
 * Maka: kotor dari `total + refund_total` (nilai yang benar-benar ditagih saat
 * itu), lalu dikurangi refund yang WAKTUNYA jatuh di jendela shift ini. Untuk
 * refund pada shift yang sama hasilnya persis sama dengan sebelumnya.
 */
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
      total: sql<number>`COALESCE(SUM(${sales.total} + ${sales.refundTotal}), 0)`,
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
  // Metode diambil dari penjualannya: uang kembali lewat jalan yang sama dengan
  // uang masuk — refund transaksi QRIS tidak mengurangi uang tunai di laci.
  const refundRows = await db
    .select({ metode: sales.metodeBayar, nominal: sum(saleRefunds.nominal) })
    .from(saleRefunds)
    .innerJoin(sales, eq(saleRefunds.saleId, sales.id))
    .where(
      and(
        eq(saleRefunds.companyId, companyId),
        eq(saleRefunds.branchId, branchId),
        isNull(sales.deletedAt),
        refundShift(shiftId, companyId, branchId, openedAt),
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
  for (const r of refundRows) {
    const t = Number(r.nominal ?? 0);
    if (r.metode === "tunai") tunai -= t;
    else nontunai -= t;
  }
  return { penjualan_tunai: tunai, penjualan_nontunai: nontunai, jumlah_transaksi: jumlah };
}

/**
 * Berapa transaksi shift yang dimuat ke daftar detail. Dibatasi supaya satu
 * shift ramai tak menarik ribuan baris ke layar, TAPI batasnya harus terlihat:
 * modal detail menampilkan `jumlah_transaksi` (hitungan sebenarnya, dari
 * agregat tak terbatas) TEPAT DI ATAS daftar ini. Tanpa penanda, shift
 * berisi 420 transaksi memperlihatkan "Transaksi 420x" lalu "Transaksi (300)"
 * berdampingan — dua angka berbeda untuk hal yang sama, di layar tempat kasir
 * sedang diminta mempertanggungjawabkan uang.
 */
const BATAS_TRANSAKSI_SHIFT = 300;

/**
 * Daftar transaksi individual sebuah shift (untuk detail).
 *
 * Mengambil satu baris LEBIH dari batas — itulah cara tahu masih ada sisa,
 * idiom yang sama dengan kartu stok & kartu perlengkapan (`terpotong`).
 * Uangnya sendiri TIDAK datang dari daftar ini: `penjualan_tunai`,
 * `penjualan_nontunai`, dan `jumlah_transaksi` dihitung agregat terpisah
 * tanpa batas, jadi pemotongan di sini tak pernah menggeser rekap kas.
 */
async function transaksiWindow(
  companyId: string,
  branchId: string,
  shiftId: string,
  openedAt: Date,
  closedAt: Date | null,
): Promise<{ rows: ShiftTransaksiRow[]; terpotong: boolean }> {
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
    .limit(BATAS_TRANSAKSI_SHIFT + 1);
  const terpotong = rows.length > BATAS_TRANSAKSI_SHIFT;
  const dipakai = terpotong ? rows.slice(0, BATAS_TRANSAKSI_SHIFT) : rows;
  const daftar = dipakai.map((r) => ({
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
  return { rows: daftar, terpotong };
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
  /** peran pemanggil — dipakai membutakan responsnya, sama seperti endpoint lain */
  role?: string | null;
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
    return { shift: await toDto(row, params.role), sudahTerbuka: true };
  }
  /*
   * SELECT lalu INSERT tak pernah cukup: selalu ada jeda di antara keduanya.
   * Yang benar-benar menjaga "satu shift terbuka per cabang" adalah indeks
   * parsial `shifts_open_per_branch_uq` (migrasi 0023) — dan tanpa penangkap
   * ini, permintaan yang KALAH balapan menerima 23505 mentah alias 500.
   *
   * Dua akibat nyatanya, dan keduanya bertentangan dengan janji di komentar
   * fungsi ini bahwa kasus "sudah terbuka" BUKAN error:
   *   - Kasir web: 500 yang bukan galat aplikasi memicu overlay global
   *     "server sedang diperbarui" — aplikasinya terlihat tumbang, padahal
   *     kasir cuma membuka laci.
   *   - Jalur sinkron (`tipe:"shift_buka"`): perintahnya gagal, dan seluruh
   *     penjualan offline yang bersandar padanya kehilangan tempat berpijak.
   *
   * Balapannya kini mendarat di hasil yang SAMA dengan jalur berurutan:
   * kembalikan shift yang sudah ada, tandai `sudah_terbuka`.
   */
  let insId: string;
  try {
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
    insId = ins.id;
  } catch (err) {
    if (!bentrokUnik(err)) throw err;
    const [lawan] = await db
      .select({ id: shifts.id })
      .from(shifts)
      .where(and(eq(shifts.branchId, params.branchId), isNull(shifts.closedAt)));
    // Pemenangnya sempat menutup shiftnya lagi di sela ini → tak ada yang bisa
    // dikembalikan, dan berpura-pura sukses justru menyesatkan. Lempar apa
    // adanya; kejadian ini jauh lebih jarang daripada balapan membuka.
    if (!lawan) throw err;
    const [row] = await baseSelect().where(eq(shifts.id, lawan.id));
    return { shift: await toDto(row, params.role), sudahTerbuka: true };
  }
  const [row] = await baseSelect().where(eq(shifts.id, insId));
  return { shift: await toDto(row, params.role), sudahTerbuka: false };
}

type ShiftJoinRow = {
  id: string;
  companyId: string;
  branchId: string;
  openedAt: Date;
  modalAwal: number;
  closedAt: Date | null;
  uangFisik: number | null;
  hitunganDikunciAt: Date | null;
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
      hitunganDikunciAt: shifts.hitunganDikunciAt,
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
 * HITUNG BUTA: selagi shift masih TERBUKA dan hitungan laci BELUM dikunci,
 * peran terkunci cabang (kasir/tim) tidak boleh melihat kas yang seharusnya ada
 * di laci.
 *
 * Kalau angka itu terlihat lebih dulu, penghitungan uang berhenti menjadi
 * pemeriksaan — tinggal disalin, dan selisih apa pun takkan pernah muncul.
 * Owner/admin tak pernah dibutakan: merekalah yang menyetujui selisih, dan
 * mereka memang perlu memantau kas berjalan.
 *
 * `uangFisik` terisi = kasir sudah mengunci hitungannya lewat
 * `POST /shift/kunci-hitungan`, jadi angka boleh dibuka: nominalnya sudah tak
 * bisa diubah lagi (panggilan kedua dengan nominal berbeda → 409), sehingga
 * melihat kas sistem tak lagi bisa memengaruhi apa yang dilaporkan.
 */
function butaUntuk(role: string | null, closedAt: Date | null, uangFisik: number | null): boolean {
  return closedAt == null && uangFisik == null && terikatCabang(role);
}

/**
 * STATUS SELISIH KAS — diturunkan dari selisih yang HIDUP, bukan dari ada
 * tidaknya keputusan tersimpan.
 *
 * Kolom DB hanya menyimpan KEPUTUSAN (menunggu/disetujui/ditolak). Dulu "pas"
 * diturunkan dari ketiadaan keputusan itu: `selisihStatus ?? "pas"`. Itu benar
 * selama angka shift berhenti bergerak saat ditutup — dan angka shift TIDAK
 * berhenti bergerak.
 *
 * `kas_sistem` dihitung ulang tiap kali shift dibaca (`rekapWindow`), dan
 * penjualan bertanggal mundur dari sinkron offline bisa mendarat di jendela
 * shift yang sudah lama ditutup. Kasir memang diperingatkan saat itu terjadi
 * ("masuk ke shift yang sudah ditutup — periksa selisih kas shift itu"), tapi
 * sisi server tak pernah ikut berubah pikiran.
 *
 * Terukur: shift ditutup pas (uang fisik 230.000 = kas sistem 230.000, status
 * "pas", tak butuh persetujuan). Satu penjualan tunai 40.000 tersinkron
 * belakangan ke jendelanya → kas sistem jadi 270.000 dan selisih jadi −40.000,
 * TAPI statusnya tetap "pas". Baris itu lalu berbunyi "selisih −40.000, status
 * pas" sekaligus, dan yang lebih mahal: `GET /shift/selisih?status=menunggu`
 * — antrean persetujuan owner — memfilter kolom beku itu, jadi kekurangan
 * 40.000 tak pernah muncul untuk ditinjau siapa pun.
 *
 * Maka: keputusan yang SUDAH diambil tetap menang (owner sudah menilai), dan
 * bila belum ada keputusan, statusnya mengikuti angka hari ini.
 */
export function statusSelisih(
  closedAt: Date | null,
  tersimpan: "menunggu" | "disetujui" | "ditolak" | null,
  selisih: number,
): "pas" | "menunggu" | "disetujui" | "ditolak" | null {
  // `null` (masih terbuka) sengaja dipisah dari `"pas"` (sudah ditutup, tak
  // ada selisih) — lihat catatan tipe `StatusSelisih`.
  if (closedAt == null) return null;
  if (tersimpan) return tersimpan;
  return Math.abs(selisih) < EPS_KAS ? "pas" : "menunggu";
}

async function toDto(r: ShiftJoinRow, role?: string | null): Promise<Shift> {
  const rekap = await rekapWindow(r.companyId, r.branchId, r.id, r.openedAt, r.closedAt);
  const kasAsli = r.modalAwal + rekap.penjualan_tunai;
  const buta = role != null && butaUntuk(role, r.closedAt, r.uangFisik);
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
    // Yang dibutakan HANYA jejak tunai — jumlah transaksi & non-tunai tetap
    // tampil supaya kasir masih bisa memantau shiftnya berjalan.
    //
    // `null`, BUKAN 0: nol adalah angka yang sah ("belum ada penjualan tunai
    // hari ini") dan klien tak punya cara membedakannya dari penyembunyian.
    penjualan_tunai: buta ? null : rekap.penjualan_tunai,
    kas_sistem: buta ? null : kasAsli,
    selisih: buta || r.uangFisik == null ? null : r.uangFisik - kasAsli,
    ada_transaksi_susulan: r.adaTransaksiSusulan,
    hitung_buta: buta,
    hitungan_dikunci_pada: r.hitunganDikunciAt ? r.hitunganDikunciAt.toISOString() : null,
    // `null` (masih terbuka) sengaja dipisah dari `"pas"` (sudah ditutup, tak
    // ada selisih). Kolom DB hanya menyimpan KEPUTUSAN, jadi "pas" diturunkan
    // di sini — tak ada status kelima yang perlu disimpan.
    status_selisih: statusSelisih(r.closedAt, r.selisihStatus, (r.uangFisik ?? 0) - kasAsli),
    selisih_alasan: r.selisihAlasan,
    selisih_disetujui_oleh: r.penyetuju,
    selisih_diputus_pada: r.disetujuiAt ? r.disetujuiAt.toISOString() : null,
    alasan_tolak: r.tolakAlasan,
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
    /**
     * KAS LACI MILIK SHIFT, BUKAN MILIK HARI INI.
     *
     * Angka di atas (`salesRows`) sengaja berjendela HARI INI — kartunya
     * berjudul "Rekap hari ini" dan memang itu yang dijanjikan. Tapi kas laci
     * bukan angka harian: `modal_awal` milik shift yang sedang terbuka, jadi
     * menjumlahkannya dengan tunai SEHARIAN mencampur dua jendela berbeda.
     *
     * Yang terjadi pada cabang bershift dua — pagi lalu sore, alur biasa dan
     * memang diizinkan (`shifts_open_per_branch_uq` hanya melarang dua shift
     * TERBUKA sekaligus): begitu kasir sore membuka laci, "Kas seharusnya" di
     * layar owner ikut memuat seluruh tunai shift pagi — uang yang sudah
     * dihitung, dicocokkan, dan diangkat dari laci saat tutup kasir. Owner
     * membaca kekurangan sebesar omzet tunai satu shift penuh, pada layar yang
     * justru dipakai memantau kejujuran kas.
     *
     * Dua selisih lain dari sumbu yang sama: refund atas penjualan HARI
     * SEBELUMNYA mengambil uang dari laci hari ini tanpa terlihat di jendela
     * `sale_date = hari ini`, dan shift yang melewati tengah malam kehilangan
     * seluruh penjualan sebelum pukul 00:00.
     *
     * Maka kas dihitung lewat `rekapWindow` — fungsi yang sama dengan
     * `/shift/aktif`, detail shift, `/shift/selisih`, dan yang dibandingkan
     * `POST /shift/tutup`. Empat layar yang menyebut "Kas seharusnya" kini tak
     * bisa lagi berselisih.
     */
    const tunaiShiftByBranch = new Map(
      await Promise.all(
        openRows.map(async (r) => {
          const rk = await rekapWindow(r.companyId, r.branchId, r.id, r.openedAt, r.closedAt);
          return [r.branchId, rk.penjualan_tunai] as const;
        }),
      ),
    );

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
      // `null` saat kasir tutup, BUKAN 0: tak ada shift berarti tak ada kas
      // laci untuk dilaporkan, sedangkan nol adalah angka yang sah ("shift ini
      // belum menerima tunai") yang klien tak punya cara membedakannya.
      const tunaiShift = open ? (tunaiShiftByBranch.get(b.id) ?? 0) : null;
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
        penjualan_tunai_shift: tunaiShift,
        kas_sistem: open ? open.modalAwal + tunaiShift! : 0,
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
  /**
   * Daftar selisih kas untuk owner/admin — sumber badge "perlu ACC".
   *
   * Sengaja TIDAK ditempel ke `/pantau`: `/pantau` bicara soal shift yang
   * sedang BERJALAN hari ini (satu baris per cabang), sedangkan selisih yang
   * menunggu bisa menumpuk dari shift kemarin di cabang yang hari ini belum
   * buka — baris itu takkan pernah punya tempat di `/pantau`.
   */
  .get(
    "/selisih",
    requireRole("owner", "admin"),
    zValidator(
      "query",
      z.object({
        status: z.enum(["pas", "menunggu", "disetujui", "ditolak"]).default("menunggu"),
        branch_id: z.string().uuid().optional(),
      }),
    ),
    async (c) => {
      const auth = c.get("auth");
      const q = c.req.valid("query");
      /*
       * "pas" dan "menunggu" TAK BISA dipisahkan di SQL.
       *
       * Keduanya sama-sama berkolom `selisih_status` NULL bila belum ada
       * keputusan; yang membedakan adalah SELISIHNYA — dan selisih itu
       * dihitung ulang dari penjualan shift tiap kali dibaca, bukan disimpan.
       * Dulu "pas" difilter sebagai `IS NULL`, jadi shift yang selisihnya
       * berubah SESUDAH ditutup (penjualan bertanggal mundur dari sinkron
       * offline) tetap duduk di keranjang "tak perlu ditinjau" — kekurangan
       * kasnya tak pernah sampai ke owner.
       *
       * Jadi kedua status itu diambil bersama dari SQL lalu dipisah di sini
       * memakai `statusSelisih`, aturan yang sama dengan yang dipakai layar
       * shift. `disetujui`/`ditolak` tetap difilter langsung — keputusan yang
       * sudah diambil memang tersimpan.
       */
      const perluHitung = q.status === "pas" || q.status === "menunggu";
      const rows = await baseSelect()
        .where(
          and(
            eq(shifts.companyId, auth.company_id!),
            isNotNull(shifts.closedAt),
            q.branch_id ? eq(shifts.branchId, q.branch_id) : undefined,
            q.status === "pas" || q.status === "menunggu"
              ? or(isNull(shifts.selisihStatus), eq(shifts.selisihStatus, "menunggu"))
              : eq(shifts.selisihStatus, q.status),
          ),
        )
        .orderBy(desc(shifts.closedAt))
        // Ambil lebih banyak saat statusnya harus dihitung: penyaringan terjadi
        // SESUDAH query, jadi memotong di 50 lebih dulu bisa membuang baris
        // yang justru diminta. Dipangkas kembali ke 50 di bawah.
        .limit(perluHitung ? 200 : 50);
      const semua: SelisihKasRow[] = await Promise.all(
        rows.map(async (r) => {
          const rekap = await rekapWindow(r.companyId, r.branchId, r.id, r.openedAt, r.closedAt);
          const kas = r.modalAwal + rekap.penjualan_tunai;
          return {
            id: r.id,
            branch_nama: r.branch_nama ?? "",
            ditutup_oleh: r.closer,
            ditutup_pada: r.closedAt ? r.closedAt.toISOString() : null,
            kas_sistem: kas,
            uang_fisik: r.uangFisik ?? 0,
            selisih: (r.uangFisik ?? 0) - kas,
            // keterangan selisih lebih berguna daripada catatan umum, tapi
            // klien lama hanya mengisi `catatan` — pakai yang ada.
            catatan: r.selisihAlasan ?? r.catatan,
            // Aturan yang SAMA dengan layar shift — dua tempat yang menurunkan
            // status ini dengan cara berbeda adalah dua tempat yang akan
            // berselisih pendapat soal shift yang sama.
            status_selisih: statusSelisih(
              r.closedAt,
              r.selisihStatus,
              (r.uangFisik ?? 0) - kas,
            )!,
          };
        }),
      );
      const hasil = perluHitung
        ? semua.filter((x) => x.status_selisih === q.status).slice(0, 50)
        : semua;
      return c.json(hasil);
    },
  )
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
    const tx = await transaksiWindow(row.companyId, row.branchId, row.id, row.openedAt, row.closedAt);
    return c.json({
      ...dto,
      transaksi: tx.rows,
      transaksi_terpotong: tx.terpotong,
    } satisfies ShiftDetail);
  })
  .post(
    "/buka",
    requireRole("cashier"),
    zValidator("json", z.object({ modal_awal: z.number().nonnegative().default(0) })),
    async (c) => {
      const auth = c.get("auth");
      const branchId = await branchUntukTulis(
        c,
        undefined,
        "Kasir hanya boleh membuka shift di cabangnya",
      );
      const { shift, sudahTerbuka } = await bukaShift({
        companyId: auth.company_id!,
        branchId,
        userId: auth.sub,
        modalAwal: c.req.valid("json").modal_awal,
        role: auth.role,
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
   * KUNCI HITUNGAN — momen "reveal" dari hitung buta.
   *
   * Kasir mengirim uang fisik hasil hitungan laci TANPA pernah melihat kas
   * sistem (lihat `butaUntuk`). Responsnya yang pertama kali membuka
   * `kas_sistem` dan `selisih`, jadi angka yang dikirim benar-benar hasil
   * menghitung, bukan hasil menyalin.
   *
   * Kenapa penguncian ini perlu, bukan sekadar menyembunyikan angka di layar:
   * tanpanya kasir bisa MEMANCING kas sistem — kirim `uang_fisik: 0`, baca
   * selisih yang muncul, lalu kirim ulang dengan angka yang pas. Sekali
   * terkunci, nominal tak bisa diubah lagi (409), sehingga melihat kas sistem
   * tak lagi bisa memengaruhi apa yang dilaporkan.
   *
   * Nominal yang SAMA dikirim ulang tetap 200 — jaringan putus lalu klien
   * mengulang permintaan yang sama bukan kecurangan, dan menolaknya akan
   * menyandera shift.
   */
  .post(
    "/kunci-hitungan",
    requireRole("cashier"),
    zValidator("json", z.object({ uang_fisik: z.number().nonnegative() })),
    async (c) => {
      const auth = c.get("auth");
      const branchId = await resolveBranchId(c);
      const body = c.req.valid("json");
      const open = await shiftTerbuka(auth.company_id!, branchId);
      const rekap = await rekapWindow(auth.company_id!, branchId, open.id, open.openedAt, null);
      const kas = open.modalAwal + rekap.penjualan_tunai;
      if (open.uangFisik != null) {
        const hasil = {
          uang_fisik: open.uangFisik,
          kas_sistem: kas,
          selisih: open.uangFisik - kas,
        };
        if (Math.abs(open.uangFisik - body.uang_fisik) <= EPS_KAS) return c.json(hasil);
        return c.json(
          { error: `Hitungan sudah dikunci ${rupiah(open.uangFisik)}`, ...hasil },
          409,
        );
      }
      await db
        .update(shifts)
        .set({ uangFisik: body.uang_fisik, hitunganDikunciAt: new Date() })
        .where(and(eq(shifts.id, open.id), isNull(shifts.uangFisik)));
      // Baca ulang: bila dua permintaan berbarengan, yang kalah balapan harus
      // melaporkan nominal yang BENAR-BENAR tersimpan, bukan yang ia kirim.
      const [after] = await db
        .select({ uangFisik: shifts.uangFisik })
        .from(shifts)
        .where(eq(shifts.id, open.id));
      const terkunci = after.uangFisik ?? body.uang_fisik;
      return c.json({ uang_fisik: terkunci, kas_sistem: kas, selisih: terkunci - kas });
    },
  )
  /**
   * TUTUP KASIR.
   *
   * Dua jalur yang sama-sama sah:
   * 1. Sudah `kunci-hitungan` → `uang_fisik` boleh dihilangkan (diambil dari
   *    yang terkunci). Bila tetap dikirim dan BERBEDA → 409; diam-diam memakai
   *    salah satunya berarti salah satu angka yang dilihat kasir bohong.
   * 2. Belum mengunci → `uang_fisik` wajib. Jalur satu langkah untuk klien yang
   *    membutakan di UI saja (mobile tablet toko), tanpa endpoint tambahan.
   *
   * Selisih apa pun (lebih maupun kurang) langsung berstatus "menunggu"
   * persetujuan owner/admin; kasir tak bisa meng-ACC selisihnya sendiri.
   * Uang fisik yang PAS tak butuh persetujuan (`status_selisih: "pas"`).
   */
  .post(
    "/tutup",
    requireRole("cashier"),
    zValidator(
      "json",
      z.object({
        /** boleh kosong bila hitungan sudah dikunci lebih dulu */
        uang_fisik: z.number().nonnegative().nullish(),
        catatan: z.string().nullish(),
        /** keterangan kasir bila hitungannya tak pas (mis. "kembalian kurang") */
        selisih_alasan: z.string().trim().max(300).nullish(),
      }),
    ),
    async (c) => {
      const auth = c.get("auth");
      const branchId = await resolveBranchId(c);
      const body = c.req.valid("json");
      const open = await shiftTerbuka(auth.company_id!, branchId);
      if (
        open.uangFisik != null &&
        body.uang_fisik != null &&
        Math.abs(open.uangFisik - body.uang_fisik) > EPS_KAS
      ) {
        return c.json(
          {
            error: `Hitungan sudah dikunci ${rupiah(open.uangFisik)} — tak bisa ditutup dengan nominal lain`,
            uang_fisik: open.uangFisik,
          },
          409,
        );
      }
      const uangFisik = open.uangFisik ?? body.uang_fisik;
      if (uangFisik == null) {
        throw new HTTPException(400, { message: "Uang fisik di laci wajib diisi" });
      }
      // Kas sistem dihitung DI SINI (server), bukan dikirim klien — klien tak
      // pernah memegang angka ini sebelum hitungannya dikunci.
      const rekap = await rekapWindow(auth.company_id!, branchId, open.id, open.openedAt, null);
      const selisih = uangFisik - (open.modalAwal + rekap.penjualan_tunai);
      const perluAcc = Math.abs(selisih) > EPS_KAS;
      /*
       * `isNull(closedAt)` WAJIB ada di WHERE — bukan sekadar kerapian.
       *
       * `shiftTerbuka()` di atas hanya MEMBACA. Dua penutupan yang berpapasan
       * sama-sama menemukan shift yang sama masih terbuka, sama-sama lolos
       * penjaga "hitungan sudah dikunci" (keduanya membaca `uangFisik = null`),
       * lalu sama-sama menulis. Tanpa syarat ini yang kedua MENIMPA yang
       * pertama, dan keduanya dibalas 200.
       *
       * Terukur: dua penutupan bersamaan dengan nominal 150.000 dan 999.000
       * sama-sama dibalas 200 berbunyi 999.000. Kasir yang menghitung 150.000
       * melihat layar sukses berisi angka orang lain, dan shift tercatat
       * berselisih 899.000 alih-alih 50.000 — di layar yang justru dipakai
       * mempertanggungjawabkan isi laci.
       *
       * Bentuknya sama persis dengan penjaga di `/selisih/putuskan`: yang kalah
       * balapan harus TAHU bahwa ia kalah, bukan dibalas keputusan lawan.
       */
      const ditutup = await db
        .update(shifts)
        .set({
          closedBy: auth.sub,
          closedAt: new Date(),
          uangFisik,
          catatan: body.catatan ?? null,
          selisihStatus: perluAcc ? "menunggu" : null,
          // `catatan` jadi cadangan: klien lama (dan mobile) hanya punya satu
          // kolom catatan, dan di praktiknya itulah keterangan selisihnya.
          // Tanpa cadangan ini penjelasan kasir hilang dalam perjalanan ke owner.
          selisihAlasan: perluAcc
            ? (body.selisih_alasan?.trim() || body.catatan?.trim() || null)
            : null,
        })
        .where(and(eq(shifts.id, open.id), isNull(shifts.closedAt)))
        .returning({ id: shifts.id });
      const [row] = await baseSelect().where(eq(shifts.id, open.id));
      if (ditutup.length === 0) {
        // Kalah balapan: perangkat lain menutup shift ini di sela baca-tulis.
        // Bentuk badan & kode SENGAJA sama dengan penjaga "hitungan sudah
        // dikunci" di atas — klien sudah menanganinya, dan sebab baru justru
        // terbaca asing olehnya.
        return c.json(
          {
            error: `Kasir sudah ditutup dengan hitungan ${rupiah(row.uangFisik ?? 0)} — hitungan Anda tidak dipakai`,
            uang_fisik: row.uangFisik,
          },
          409,
        );
      }
      return c.json(await toDto(row, auth.role));
    },
  )
  /**
   * Owner/admin memutuskan selisih kas: terima apa adanya (disetujui) atau
   * tolak dengan alasan. Sengaja TIDAK mengubah angka apa pun — uang fisik &
   * kas sistem adalah fakta yang sudah terjadi; yang dicatat di sini adalah
   * KEPUTUSANNYA, lengkap dengan siapa dan kapan. Menolak pun tidak membuka
   * kembali shift: penolakan adalah penanda untuk ditindaklanjuti di luar
   * aplikasi, bukan perintah menghitung ulang.
   */
  .post(
    "/:id/selisih/putuskan",
    requireRole("owner", "admin"),
    zValidator(
      "json",
      z.object({
        status: z.enum(["disetujui", "ditolak"]),
        alasan_tolak: z.string().trim().max(300).nullish(),
      }),
    ),
    async (c) => {
      const auth = c.get("auth");
      const body = c.req.valid("json");
      const [row] = await db
        .select({
          id: shifts.id,
          closedAt: shifts.closedAt,
          selisihStatus: shifts.selisihStatus,
        })
        .from(shifts)
        .where(and(eq(shifts.id, c.req.param("id")), eq(shifts.companyId, auth.company_id!)));
      if (!row) throw new HTTPException(404, { message: "Shift tidak ditemukan" });
      if (row.closedAt == null || row.selisihStatus == null) {
        throw new HTTPException(400, {
          message: "Shift ini tak punya selisih kas yang perlu diputuskan",
        });
      }
      if (row.selisihStatus !== "menunggu") {
        throw new HTTPException(409, {
          message: `Selisih shift ini sudah ${row.selisihStatus} — tidak bisa diputuskan lagi`,
        });
      }
      if (body.status === "ditolak" && !body.alasan_tolak?.trim()) {
        throw new HTTPException(400, { message: "Alasan wajib diisi saat menolak selisih" });
      }
      const diputus = await db
        .update(shifts)
        .set({
          selisihStatus: body.status,
          disetujuiOleh: auth.sub,
          disetujuiAt: new Date(),
          tolakAlasan: body.status === "ditolak" ? body.alasan_tolak!.trim() : null,
        })
        // Guard balapan: dua owner menekan tombol bersamaan → yang kedua
        // tidak menimpa keputusan pertama.
        .where(and(eq(shifts.id, row.id), eq(shifts.selisihStatus, "menunggu")))
        .returning({ id: shifts.id });
      /*
       * Hasilnya DIPERIKSA, bukan dibuang. Penjaga di atas sudah mencegah
       * keputusan kedua menimpa yang pertama, tapi tanpa pemeriksaan ini yang
       * kalah dibalas 200 berisi keputusan LAWAN — ia menekan "Setujui" lalu
       * menerima badan berbunyi "ditolak", tanpa satu pun tanda bahwa
       * tekanannya tak berlaku. Jalur berurutan sudah lama membalas 409
       * berpesan; yang serentak kini menjawab sama.
       */
      if (diputus.length === 0) {
        const [kini] = await db
          .select({ selisihStatus: shifts.selisihStatus })
          .from(shifts)
          .where(eq(shifts.id, row.id));
        throw new HTTPException(409, {
          message: `Selisih shift ini sudah ${kini?.selisihStatus ?? "diputuskan"} — tidak bisa diputuskan lagi`,
        });
      }
      const [after] = await baseSelect().where(eq(shifts.id, row.id));
      return c.json(await toDto(after, auth.role));
    },
  );

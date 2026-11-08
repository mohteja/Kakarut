import { zValidator } from "../../lib/validator";
import { and, desc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  BATAS_TANGGAL_MULAI_GAJI,
  KODE_KATEGORI_PENGAJUAN,
  akhirPeriode,
  awalPeriodeMemuat,
  type GajiKaryawanRow,
  type GajiPeriodeDetailDto,
  type GajiSetelanPerusahaanDto,
  type GajiSlipDetailDto,
  type KasbonRow,
} from "@kakarut/shared";
import { db } from "../../db/client";
import {
  companies,
  gajiPeriode,
  gajiSetelan,
  gajiSlip,
  gajiTunjangan,
  kasbon,
  kasbonPotongan,
  memberships,
  users,
} from "../../db/schema";
import { BATAS_UANG } from "../../lib/batas-angka";
import { kunciAntrean } from "../../lib/kunci";
import { SEPULUH_TAHUN, SETAHUN, zTanggalKejadian, zTanggalRencana } from "../../lib/waktu-kejadian";
import { tambahHari, tanggalDi } from "../../lib/time";
import { tanggalDalamRentang } from "../pengajuan/routes";
import type { AppEnv } from "../../middleware/auth";
import {
  aturanPerusahaan,
  daftarPeriode,
  daftarSlip,
  hitungUlangPeriode,
  karyawanPerusahaan,
  kasbonAktif,
  setelanDto,
} from "./service";

/**
 * PENGGAJIAN — owner & HRD saja (permintaan pemilik 2026-11-08), dijaga
 * `requireRole("owner","hrd")` pada awalan `/gaji/*` di app.ts. Admin tidak:
 * angka gaji orang lain bukan urusan pengelola operasional.
 */

const Uang = z.number().min(0).max(BATAS_UANG);
const Jam = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "jam harus HH:MM")
  .nullable();

const SetelanPerusahaanBody = z
  .object({
    tanggal_mulai: z.number().int().min(1).max(BATAS_TANGGAL_MULAI_GAJI),
    cuti_dibayar: z.array(z.enum(KODE_KATEGORI_PENGAJUAN)).max(20),
  })
  .strict();

const SetelanKaryawanBody = z
  .object({
    dasar: z.enum(["bulanan", "harian"]),
    nominal: Uang,
    jam_masuk: Jam,
    jam_pulang: Jam,
    toleransi_telat_menit: z.number().int().min(0).max(240),
    potongan_alpa_per_hari: Uang.nullable(),
    potongan_telat_per_kali: Uang,
    upah_lembur_per_jam: Uang,
    aktif: z.boolean(),
    tunjangan: z
      .array(z.object({ nama: z.string().trim().min(1).max(40), nominal: Uang }).strict())
      .max(20),
  })
  .strict();

const KasbonBody = z
  .object({
    user_id: z.string().uuid(),
    tanggal: zTanggalKejadian(SETAHUN),
    nominal: Uang.positive(),
    cicilan_per_periode: Uang.positive(),
    catatan: z.string().trim().max(200).nullish(),
  })
  .strict();

const KasbonPatchBody = z
  .object({
    cicilan_per_periode: Uang.positive().optional(),
    catatan: z.string().trim().max(200).nullish(),
  })
  .strict();

/**
 * `mulai` kosong = periode bulanan berikutnya (sesudah periode terakhir, atau
 * yang memuat hari ini). `selesai` kosong = mulai + 1 bulan − 1 hari; diisi =
 * PERIODE KHUSUS (mis. gaji pertama sesudah mulai memakai aplikasi di tengah
 * bulan), paling panjang 62 hari.
 */
const PeriodeBody = z
  .object({
    mulai: zTanggalKejadian(SEPULUH_TAHUN).optional(),
    selesai: zTanggalRencana(62, SEPULUH_TAHUN).optional(),
  })
  .strict();
const MAKS_HARI_PERIODE = 62;

const SlipPatchBody = z
  .object({
    bonus: z.number().min(0).max(BATAS_UANG).optional(),
    penyesuaian: z.number().min(-BATAS_UANG).max(BATAS_UANG).optional(),
    catatan: z.string().trim().max(300).nullish(),
  })
  .strict();

class PeriodeTerkunci extends HTTPException {
  readonly sebab = "periode_terkunci";
  constructor(status: string) {
    super(409, {
      message:
        status === "draft"
          ? "Periode masih draft"
          : `Periode sudah ${status === "final" ? "difinalkan" : "dibayar"} — angka terkunci`,
    });
  }
}

async function ambilPeriode(companyId: string, id: string) {
  const [p] = await db
    .select()
    .from(gajiPeriode)
    .where(and(eq(gajiPeriode.id, id), eq(gajiPeriode.companyId, companyId)));
  if (!p) throw new HTTPException(404, { message: "Periode tidak ditemukan" });
  return p;
}

async function detailPeriode(companyId: string, id: string): Promise<GajiPeriodeDetailDto> {
  const [periode] = await daftarPeriode(db, companyId, id);
  if (!periode) throw new HTTPException(404, { message: "Periode tidak ditemukan" });
  const slip = (await daftarSlip(db, companyId, { periodeId: id })).map(({ rincian: _r, ...s }) => s);
  // Yang belum punya setelan — dihitung dari daftar karyawan masa itu.
  const aturan = await aturanPerusahaan(db, companyId);
  const karyawan = await karyawanPerusahaan(db, companyId, aturan.tz, periode.mulai, periode.selesai);
  const ada = new Set(slip.map((s) => s.user_id));
  const setelan = await db
    .select({ userId: gajiSetelan.userId, aktif: gajiSetelan.aktif })
    .from(gajiSetelan)
    .where(eq(gajiSetelan.companyId, companyId));
  const bersetelan = new Set(setelan.filter((s) => s.aktif).map((s) => s.userId));
  const tanpa_setelan = karyawan
    .filter((k) => !ada.has(k.user_id) && !bersetelan.has(k.user_id) && k.arsip == null)
    .map((k) => ({ user_id: k.user_id, nama: k.nama }));
  return { periode, slip, tanpa_setelan };
}

export const gajiRoutes = new Hono<AppEnv>()
  // ── Pengaturan perusahaan ────────────────────────────────────────────────
  .get("/setelan", async (c) => {
    const a = await aturanPerusahaan(db, c.get("auth").company_id!);
    const dto: GajiSetelanPerusahaanDto = { tanggal_mulai: a.tanggal_mulai, cuti_dibayar: a.cuti_dibayar };
    return c.json(dto);
  })
  .put("/setelan", zValidator("json", SetelanPerusahaanBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const cuti = [...new Set(body.cuti_dibayar)];
    await db
      .update(companies)
      .set({ gajiTanggalMulai: body.tanggal_mulai, gajiCutiDibayar: cuti })
      .where(eq(companies.id, auth.company_id!));
    const dto: GajiSetelanPerusahaanDto = { tanggal_mulai: body.tanggal_mulai, cuti_dibayar: cuti };
    return c.json(dto);
  })

  // ── Setelan per karyawan ─────────────────────────────────────────────────
  .get("/karyawan", async (c) => {
    const auth = c.get("auth");
    const companyId = auth.company_id!;
    const aturan = await aturanPerusahaan(db, companyId);
    const hariIni = tanggalDi(aturan.tz);
    // Masa kerja yang bertindih "sejak dulu sampai hari ini" = semua yang
    // pernah bekerja; yang sudah diarsipkan ikut dengan `arsip_pada`.
    const karyawan = await karyawanPerusahaan(db, companyId, aturan.tz, "1900-01-01", hariIni);
    const setelan = await db.select().from(gajiSetelan).where(eq(gajiSetelan.companyId, companyId));
    const tunjangan = await db.select().from(gajiTunjangan).where(eq(gajiTunjangan.companyId, companyId));
    const pinjaman = await kasbonAktif(
      db,
      companyId,
      karyawan.map((k) => k.user_id),
    );
    const petaSetelan = new Map(setelan.map((s) => [s.userId, s]));
    const rows: GajiKaryawanRow[] = karyawan.map((k) => {
      const s = petaSetelan.get(k.user_id);
      return {
        user_id: k.user_id,
        nama: k.nama,
        employee_code: k.employee_code,
        role: k.role,
        cabang: k.cabang,
        arsip_pada: k.arsip ? k.arsip.toISOString() : null,
        setelan: s ? setelanDto(s) : null,
        tunjangan: tunjangan
          .filter((t) => t.userId === k.user_id)
          .map((t) => ({ nama: t.nama, nominal: t.nominal })),
        kasbon_sisa: (pinjaman.get(k.user_id) ?? []).reduce((a, x) => a + x.sisa, 0),
      };
    });
    return c.json(rows);
  })
  .put("/karyawan/:userId", zValidator("json", SetelanKaryawanBody), async (c) => {
    const auth = c.get("auth");
    const userId = c.req.param("userId");
    const body = c.req.valid("json");
    const [m] = await db
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.companyId, auth.company_id!), eq(memberships.userId, userId)));
    if (!m) throw new HTTPException(404, { message: "Karyawan tidak ditemukan" });
    if (m.role === "owner") throw new HTTPException(400, { message: "Owner tidak digaji lewat penggajian" });
    const nilai = {
      dasar: body.dasar,
      nominal: body.nominal,
      jamMasuk: body.jam_masuk,
      jamPulang: body.jam_pulang,
      toleransiTelatMenit: body.toleransi_telat_menit,
      potonganAlpaPerHari: body.potongan_alpa_per_hari,
      potonganTelatPerKali: body.potongan_telat_per_kali,
      upahLemburPerJam: body.upah_lembur_per_jam,
      aktif: body.aktif,
      updatedAt: new Date(),
    };
    await db.transaction(async (tx) => {
      await tx
        .insert(gajiSetelan)
        .values({ companyId: auth.company_id!, userId, ...nilai })
        .onConflictDoUpdate({ target: [gajiSetelan.companyId, gajiSetelan.userId], set: nilai });
      await tx
        .delete(gajiTunjangan)
        .where(and(eq(gajiTunjangan.companyId, auth.company_id!), eq(gajiTunjangan.userId, userId)));
      if (body.tunjangan.length > 0) {
        await tx
          .insert(gajiTunjangan)
          .values(body.tunjangan.map((t) => ({ companyId: auth.company_id!, userId, nama: t.nama, nominal: t.nominal })));
      }
    });
    return c.json({ ok: true });
  })

  // ── Kasbon ───────────────────────────────────────────────────────────────
  .get("/kasbon", async (c) => {
    const auth = c.get("auth");
    const companyId = auth.company_id!;
    const userId = c.req.query("user_id");
    const rows = await db
      .select({
        id: kasbon.id,
        user_id: kasbon.userId,
        nama: users.nama,
        tanggal: kasbon.tanggal,
        nominal: kasbon.nominal,
        cicilan: kasbon.cicilanPerPeriode,
        catatan: kasbon.catatan,
        createdAt: kasbon.createdAt,
        terpotong: sql<string>`coalesce((select sum(${kasbonPotongan.nominal}) from ${kasbonPotongan} where ${kasbonPotongan.kasbonId} = ${kasbon.id}), 0)`,
      })
      .from(kasbon)
      .innerJoin(users, eq(users.id, kasbon.userId))
      .where(and(eq(kasbon.companyId, companyId), ...(userId ? [eq(kasbon.userId, userId)] : [])))
      .orderBy(sql`${kasbon.tanggal} desc`, sql`${kasbon.createdAt} desc`);
    const out: KasbonRow[] = rows.map((r) => {
      const terpotong = Number(r.terpotong);
      const sisa = Math.max(0, r.nominal - terpotong);
      return {
        id: r.id,
        user_id: r.user_id,
        nama: r.nama,
        tanggal: r.tanggal,
        nominal: r.nominal,
        cicilan_per_periode: r.cicilan,
        catatan: r.catatan,
        terpotong,
        sisa,
        lunas: sisa <= 0,
        created_at: r.createdAt.toISOString(),
      };
    });
    return c.json(out);
  })
  .post("/kasbon", zValidator("json", KasbonBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const [m] = await db
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.companyId, auth.company_id!), eq(memberships.userId, body.user_id)));
    if (!m || m.role === "owner") throw new HTTPException(400, { message: "Karyawan tidak valid" });
    const [row] = await db
      .insert(kasbon)
      .values({
        companyId: auth.company_id!,
        userId: body.user_id,
        tanggal: body.tanggal,
        nominal: body.nominal,
        cicilanPerPeriode: body.cicilan_per_periode,
        catatan: body.catatan ?? null,
        dibuatOlehUserId: auth.sub,
      })
      .returning({ id: kasbon.id });
    return c.json({ id: row.id }, 201);
  })
  .patch("/kasbon/:id", zValidator("json", KasbonPatchBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const set: Partial<typeof kasbon.$inferInsert> = {};
    if (body.cicilan_per_periode !== undefined) set.cicilanPerPeriode = body.cicilan_per_periode;
    if (body.catatan !== undefined) set.catatan = body.catatan ?? null;
    if (Object.keys(set).length === 0) {
      // Badan kosong tetap harus menjawab "ada atau tidak", bukan 200 buta.
      const [ada] = await db
        .select({ id: kasbon.id })
        .from(kasbon)
        .where(and(eq(kasbon.id, c.req.param("id")), eq(kasbon.companyId, auth.company_id!)));
      if (!ada) throw new HTTPException(404, { message: "Kasbon tidak ditemukan" });
      return c.json({ ok: true });
    }
    const r = await db
      .update(kasbon)
      .set(set)
      .where(and(eq(kasbon.id, c.req.param("id")), eq(kasbon.companyId, auth.company_id!)))
      .returning({ id: kasbon.id });
    if (r.length === 0) throw new HTTPException(404, { message: "Kasbon tidak ditemukan" });
    return c.json({ ok: true });
  })
  .delete("/kasbon/:id", async (c) => {
    const auth = c.get("auth");
    const id = c.req.param("id");
    const [dipotong] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(kasbonPotongan)
      .where(and(eq(kasbonPotongan.companyId, auth.company_id!), eq(kasbonPotongan.kasbonId, id)));
    if (dipotong.n > 0) {
      throw new HTTPException(409, { message: "Kasbon sudah dipotong dari slip gaji — tidak bisa dihapus" });
    }
    const r = await db
      .delete(kasbon)
      .where(and(eq(kasbon.id, id), eq(kasbon.companyId, auth.company_id!)))
      .returning({ id: kasbon.id });
    if (r.length === 0) throw new HTTPException(404, { message: "Kasbon tidak ditemukan" });
    return c.json({ ok: true });
  })

  // ── Periode & slip ───────────────────────────────────────────────────────
  .get("/periode", async (c) => c.json(await daftarPeriode(db, c.get("auth").company_id!)))
  .post("/periode", zValidator("json", PeriodeBody), async (c) => {
    const auth = c.get("auth");
    const companyId = auth.company_id!;
    const body = c.req.valid("json");
    const aturan = await aturanPerusahaan(db, companyId);
    const hariIni = tanggalDi(aturan.tz);
    const id = await db.transaction(async (tx) => {
      await kunciAntrean(tx, "gaji", companyId);
      const [terakhir] = await tx
        .select({ selesai: gajiPeriode.selesai })
        .from(gajiPeriode)
        .where(eq(gajiPeriode.companyId, companyId))
        .orderBy(desc(gajiPeriode.selesai), desc(gajiPeriode.id))
        .limit(1);
      const mulai =
        body.mulai ?? (terakhir ? tambahHari(terakhir.selesai, 1) : awalPeriodeMemuat(hariIni, aturan.tanggal_mulai));
      if (mulai > hariIni) {
        throw new HTTPException(400, { message: "Periode yang belum dimulai belum bisa dihitung" });
      }
      const selesai = body.selesai ?? akhirPeriode(mulai);
      if (selesai < mulai) throw new HTTPException(400, { message: "Tanggal selesai sebelum tanggal mulai" });
      if (tanggalDalamRentang(mulai, selesai).length > MAKS_HARI_PERIODE) {
        throw new HTTPException(400, { message: `Periode paling panjang ${MAKS_HARI_PERIODE} hari` });
      }
      const [bentrok] = await tx
        .select({ id: gajiPeriode.id })
        .from(gajiPeriode)
        .where(
          and(eq(gajiPeriode.companyId, companyId), lte(gajiPeriode.mulai, selesai), gte(gajiPeriode.selesai, mulai)),
        );
      if (bentrok) throw new HTTPException(409, { message: "Periode bertindih dengan periode yang sudah ada" });
      const [p] = await tx
        .insert(gajiPeriode)
        .values({ companyId, mulai, selesai })
        .returning({ id: gajiPeriode.id, mulai: gajiPeriode.mulai, selesai: gajiPeriode.selesai });
      await hitungUlangPeriode(tx, companyId, p);
      return p.id;
    });
    return c.json(await detailPeriode(companyId, id), 201);
  })
  .get("/periode/:id", async (c) => c.json(await detailPeriode(c.get("auth").company_id!, c.req.param("id"))))
  .post("/periode/:id/hitung-ulang", async (c) => {
    const auth = c.get("auth");
    const companyId = auth.company_id!;
    const id = c.req.param("id");
    await db.transaction(async (tx) => {
      await kunciAntrean(tx, "gaji", companyId);
      const p = await ambilPeriode(companyId, id);
      if (p.status !== "draft") throw new PeriodeTerkunci(p.status);
      await hitungUlangPeriode(tx, companyId, p);
    });
    return c.json(await detailPeriode(companyId, id));
  })
  .delete("/periode/:id", async (c) => {
    const auth = c.get("auth");
    const companyId = auth.company_id!;
    const p = await ambilPeriode(companyId, c.req.param("id"));
    if (p.status !== "draft") throw new PeriodeTerkunci(p.status);
    await db.delete(gajiPeriode).where(and(eq(gajiPeriode.id, p.id), eq(gajiPeriode.companyId, companyId)));
    return c.json({ ok: true });
  })
  .post("/periode/:id/final", async (c) => {
    const auth = c.get("auth");
    const companyId = auth.company_id!;
    const id = c.req.param("id");
    const aturan = await aturanPerusahaan(db, companyId);
    await db.transaction(async (tx) => {
      await kunciAntrean(tx, "gaji", companyId);
      const p = await ambilPeriode(companyId, id);
      if (p.status !== "draft") throw new PeriodeTerkunci(p.status);
      if (p.selesai > tanggalDi(aturan.tz)) {
        throw new HTTPException(400, {
          message: `Periode baru berakhir ${p.selesai} — finalkan sesudah tanggal itu`,
        });
      }
      // Hitung segar sekali lagi supaya yang dikunci = data terakhir.
      await hitungUlangPeriode(tx, companyId, p);
      const slip = await tx
        .select({ id: gajiSlip.id, rincian: gajiSlip.rincian })
        .from(gajiSlip)
        .where(and(eq(gajiSlip.companyId, companyId), eq(gajiSlip.periodeId, id)));
      const potongan = slip.flatMap((s) =>
        ((s.rincian as { kasbon: { id: string; nominal: number }[] }).kasbon ?? []).map((k) => ({
          kasbonId: k.id,
          slipId: s.id,
          nominal: k.nominal,
        })),
      );
      if (potongan.length > 0) {
        await tx
          .insert(kasbonPotongan)
          .values(potongan.map((k) => ({ companyId: auth.company_id!, ...k })));
      }
      await tx
        .update(gajiPeriode)
        .set({ status: "final", difinalkanPada: new Date() })
        .where(and(eq(gajiPeriode.id, id), eq(gajiPeriode.companyId, companyId)));
    });
    return c.json(await detailPeriode(companyId, id));
  })
  .post("/periode/:id/dibayar", async (c) => {
    const auth = c.get("auth");
    const companyId = auth.company_id!;
    const id = c.req.param("id");
    const r = await db
      .update(gajiPeriode)
      .set({ status: "dibayar", dibayarPada: new Date() })
      .where(and(eq(gajiPeriode.id, id), eq(gajiPeriode.companyId, companyId), eq(gajiPeriode.status, "final")))
      .returning({ id: gajiPeriode.id });
    if (r.length === 0) {
      const p = await ambilPeriode(companyId, id);
      throw new PeriodeTerkunci(p.status);
    }
    return c.json(await detailPeriode(companyId, id));
  })
  .post("/periode/:id/buka", async (c) => {
    const auth = c.get("auth");
    const companyId = auth.company_id!;
    const id = c.req.param("id");
    if (auth.role !== "owner") {
      throw new HTTPException(403, { message: "Hanya owner yang boleh membuka kembali periode final" });
    }
    await db.transaction(async (tx) => {
      await kunciAntrean(tx, "gaji", companyId);
      const p = await ambilPeriode(companyId, id);
      if (p.status !== "final") throw new PeriodeTerkunci(p.status);
      const idSlip = (
        await tx
          .select({ id: gajiSlip.id })
          .from(gajiSlip)
          .where(and(eq(gajiSlip.companyId, companyId), eq(gajiSlip.periodeId, id)))
      ).map((s) => s.id);
      if (idSlip.length > 0) {
        await tx
          .delete(kasbonPotongan)
          .where(and(eq(kasbonPotongan.companyId, companyId), inArray(kasbonPotongan.slipId, idSlip)));
      }
      await tx
        .update(gajiPeriode)
        .set({ status: "draft", difinalkanPada: null })
        .where(and(eq(gajiPeriode.id, id), eq(gajiPeriode.companyId, companyId)));
    });
    return c.json(await detailPeriode(companyId, id));
  })
  .get("/slip/:id", async (c) => {
    const auth = c.get("auth");
    const companyId = auth.company_id!;
    const [s] = await daftarSlip(db, companyId, { slipId: c.req.param("id") });
    if (!s) throw new HTTPException(404, { message: "Slip tidak ditemukan" });
    return c.json(await slipDetail(companyId, s));
  })
  .patch("/slip/:id", zValidator("json", SlipPatchBody), async (c) => {
    const auth = c.get("auth");
    const companyId = auth.company_id!;
    const body = c.req.valid("json");
    const [s] = await db
      .select({ id: gajiSlip.id, periodeId: gajiSlip.periodeId, userId: gajiSlip.userId })
      .from(gajiSlip)
      .where(and(eq(gajiSlip.id, c.req.param("id")), eq(gajiSlip.companyId, companyId)));
    if (!s) throw new HTTPException(404, { message: "Slip tidak ditemukan" });
    await db.transaction(async (tx) => {
      await kunciAntrean(tx, "gaji", companyId);
      const p = await ambilPeriode(companyId, s.periodeId);
      if (p.status !== "draft") throw new PeriodeTerkunci(p.status);
      const set: Partial<typeof gajiSlip.$inferInsert> = {};
      if (body.bonus !== undefined) set.bonus = body.bonus;
      if (body.penyesuaian !== undefined) set.penyesuaian = body.penyesuaian;
      if (body.catatan !== undefined) set.catatan = body.catatan ?? null;
      if (Object.keys(set).length > 0) {
        await tx.update(gajiSlip).set(set).where(and(eq(gajiSlip.id, s.id), eq(gajiSlip.companyId, companyId)));
      }
      // Hitung ulang orang ini saja (bonus/penyesuaian ikut dibaca dari slipnya).
      await hitungUlangPeriode(tx, companyId, p, s.userId);
    });
    const [baru] = await daftarSlip(db, companyId, { periodeId: s.periodeId, userId: s.userId });
    if (!baru) throw new HTTPException(404, { message: "Slip tidak ditemukan" });
    return c.json(await slipDetail(companyId, baru));
  });

export async function slipDetail(
  companyId: string,
  s: Awaited<ReturnType<typeof daftarSlip>>[number],
): Promise<GajiSlipDetailDto> {
  const { rincian, ...slip } = s;
  const [periode] = await daftarPeriode(db, companyId, s.periode_id);
  const aturan = await aturanPerusahaan(db, companyId);
  return { slip, periode, perusahaan: aturan.nama, rincian };
}

/** Untuk `GET /profil/slip-gaji` — hanya periode final/dibayar. */
export async function slipMilikSendiri(companyId: string, userId: string) {
  return db
    .select({
      id: gajiSlip.id,
      mulai: gajiPeriode.mulai,
      selesai: gajiPeriode.selesai,
      status: gajiPeriode.status,
      total: gajiSlip.total,
    })
    .from(gajiSlip)
    .innerJoin(gajiPeriode, eq(gajiPeriode.id, gajiSlip.periodeId))
    .where(
      and(eq(gajiSlip.companyId, companyId), eq(gajiSlip.userId, userId), ne(gajiPeriode.status, "draft")),
    )
    .orderBy(sql`${gajiPeriode.mulai} desc`);
}

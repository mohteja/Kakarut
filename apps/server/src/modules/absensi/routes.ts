import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, gte, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  absenTipeBerikutnya,
  jarakMeter,
  type AbsenResult,
  type AbsensiRow,
  type PengajuanKategori,
  type RekapAbsenDto,
  type RekapAbsenHari,
  type RekapAbsenRow,
} from "@kakarut/shared";
import { db } from "../../db/client";
import { attendances, branches, companies, memberships, users } from "../../db/schema";
import { tanggalDi } from "../../lib/time";
import { requireRole, resolveBranchId, type AppEnv } from "../../middleware/auth";
import {
  jumlahHari,
  pengajuanDisetujuiPadaRentang,
  tanggalDalamRentang,
} from "../pengajuan/routes";
import {
  cariHasilIdempoten,
  catatHasilIdempoten,
  clientRefField,
  deviceIdField,
} from "../sync/idempoten";

/** Koordinat perangkat — divalidasi terhadap radius titik cabang bila diatur. */
const KoordinatBody = {
  /** foto swafoto bukti absen (URL upload) — WAJIB (anti-titip absen) */
  foto_url: z.string().trim().min(1, "Foto absen wajib dilampirkan"),
  lat: z.number().min(-90).max(90).nullish(),
  lng: z.number().min(-180).max(180).nullish(),
  /** idempotensi antarjalur (online ↔ /sync) — UUID v4 dari perangkat, opsional */
  client_ref: clientRefField,
  device_id: deviceIdField,
};
/** Absen operator (pindai QR / ketik kode karyawan). */
export const ClockBody = z.object({ kode: z.string().trim().min(1), ...KoordinatBody });
/** Absen SENDIRI (tombol absen di aplikasi) — tanpa kode, atas nama pemanggil. */
export const SelfBody = z.object(KoordinatBody);

/** Validasi tanggal YYYY-MM-DD yang benar (menolak bulan/hari di luar rentang). */
function tanggalValid(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

async function timezoneOf(companyId: string): Promise<string> {
  const [company] = await db
    .select({ timezone: companies.timezone })
    .from(companies)
    .where(eq(companies.id, companyId));
  return company?.timezone ?? "Asia/Jakarta";
}

/**
 * Radius absen: bila titik lokasi cabang diatur, absen HANYA diterima dalam
 * radius itu — perangkat wajib mengirim koordinat GPS. Mengembalikan nama
 * cabang + jarak (m) atau null bila cabang tanpa titik lokasi.
 */
export async function cekRadius(
  branchId: string,
  lat: number | null | undefined,
  lng: number | null | undefined,
): Promise<{ jarakM: number | null; namaCabang: string }> {
  const [lok] = await db
    .select({
      nama: branches.nama,
      latitude: branches.latitude,
      longitude: branches.longitude,
      radius: branches.radiusAbsenM,
    })
    .from(branches)
    .where(eq(branches.id, branchId));
  const namaCabang = lok?.nama ?? "";
  if (lok?.latitude != null && lok.longitude != null) {
    if (lat == null || lng == null) {
      throw new HTTPException(400, {
        message: `Absen di ${namaCabang} butuh lokasi — izinkan akses GPS lalu coba lagi`,
      });
    }
    const jarakM = Math.round(jarakMeter(lat, lng, lok.latitude, lok.longitude));
    if (jarakM > lok.radius) {
      throw new HTTPException(400, {
        message: `Di luar radius absen ${namaCabang}: jarak ${jarakM} m (maks ${lok.radius} m)`,
      });
    }
    return { jarakM, namaCabang };
  }
  return { jarakM: null, namaCabang };
}

/**
 * Catat cap masuk/keluar untuk seorang karyawan di cabang: tentukan tipe dari
 * cap terakhir HARI INI di cabang itu (branch-scoped, konsisten dgn ringkasan
 * GET), lalu sisipkan baris absensi. Mengembalikan AbsenResult.
 */
export async function catatAbsen(opts: {
  companyId: string;
  branchId: string;
  userId: string;
  employeeCode: string;
  nama: string;
  namaCabang: string;
  fotoUrl: string;
  jarakM: number | null;
  /** waktu kejadian (sinkron offline); bila kosong pakai waktu server */
  waktu?: Date;
}): Promise<AbsenResult> {
  const tanggal = tanggalDi(await timezoneOf(opts.companyId), opts.waktu);
  const [last] = await db
    .select({ tipe: attendances.tipe })
    .from(attendances)
    .where(
      and(
        eq(attendances.companyId, opts.companyId),
        eq(attendances.branchId, opts.branchId),
        eq(attendances.userId, opts.userId),
        eq(attendances.attendDate, tanggal),
        // untuk cap susulan (offline), alternasi masuk/keluar dihitung dari cap
        // yang waktunya SEBELUM cap ini (bukan cap terbaru absolut)
        ...(opts.waktu ? [lt(attendances.waktu, opts.waktu)] : []),
      ),
    )
    .orderBy(desc(attendances.waktu))
    .limit(1);
  const tipe = absenTipeBerikutnya(last?.tipe ?? null);
  const [ins] = await db
    .insert(attendances)
    .values({
      companyId: opts.companyId,
      branchId: opts.branchId,
      userId: opts.userId,
      tipe,
      attendDate: tanggal,
      fotoUrl: opts.fotoUrl,
      ...(opts.waktu ? { waktu: opts.waktu } : {}),
    })
    .returning({ waktu: attendances.waktu });
  return {
    user_id: opts.userId,
    nama: opts.nama,
    employee_code: opts.employeeCode,
    tipe,
    waktu: ins.waktu.toISOString(),
    branch_nama: opts.namaCabang,
    jarak_m: opts.jarakM,
    foto_url: opts.fotoUrl,
  };
}

/**
 * Apakah karyawan SEDANG HADIR (sudah absen masuk & belum absen keluar) hari
 * ini di cabang tsb — dipakai gerbang buka-shift kasir: kasir wajib absen dulu.
 * Cap absen terakhir hari ini = 'masuk' → hadir; 'keluar' atau belum ada → tidak.
 */
export async function sedangHadir(
  companyId: string,
  branchId: string,
  userId: string,
  /**
   * Waktu acuan — tanggal bisnisnya yang diperiksa. Default kini (jalur online).
   * Sinkron offline WAJIB mengisinya dengan `waktu` kejadian: shift yang dibuka
   * kemarin tapi baru disinkron hari ini harus dinilai dari absen KEMARIN.
   */
  pada: Date = new Date(),
): Promise<boolean> {
  const tanggal = tanggalDi(await timezoneOf(companyId), pada);
  const [last] = await db
    .select({ tipe: attendances.tipe })
    .from(attendances)
    .where(
      and(
        eq(attendances.companyId, companyId),
        eq(attendances.branchId, branchId),
        eq(attendances.userId, userId),
        eq(attendances.attendDate, tanggal),
      ),
    )
    .orderBy(desc(attendances.waktu))
    .limit(1);
  return last?.tipe === "masuk";
}

/**
 * Absensi karyawan. Dua jalur:
 *  - POST /       : STASIUN pindai — admin/kasir memindai QR / ketik kode
 *    karyawan; baris dicatat atas nama pemilik kode, bukan operator.
 *  - POST /saya   : ABSEN SENDIRI — semua peran (termasuk TIM) menekan tombol
 *    absen di aplikasi; dicatat atas nama pemanggil sendiri (tak bisa titip).
 * Keduanya tunduk pada radius titik cabang + wajib foto swafoto.
 */
export const absensiRoutes = new Hono<AppEnv>()
  .post("/", requireRole("owner", "admin", "cashier"), zValidator("json", ClockBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    if (body.client_ref) {
      const ada = await cariHasilIdempoten(auth.company_id!, body.client_ref);
      if (ada) return c.json(ada.hasilJson, 200);
    }
    const branchId = await resolveBranchId(c);
    const { lat, lng, foto_url } = body;
    const kode = body.kode.trim();
    const { jarakM, namaCabang } = await cekRadius(branchId, lat, lng);

    // Resolusi karyawan lewat kode (case-insensitive) dalam perusahaan pemanggil.
    // Karyawan terarsip diperlakukan seperti tidak ditemukan (sudah keluar).
    const [m] = await db
      .select({
        userId: memberships.userId,
        kode: memberships.employeeCode,
        nama: users.nama,
        isActive: users.isActive,
      })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .where(
        and(
          eq(memberships.companyId, auth.company_id!),
          sql`upper(${memberships.employeeCode}) = upper(${kode})`,
          isNull(memberships.archivedAt),
        ),
      );
    if (!m) throw new HTTPException(404, { message: `Kode karyawan "${kode}" tidak ditemukan` });
    if (!m.isActive) throw new HTTPException(400, { message: `${m.nama} berstatus nonaktif` });

    const result = await catatAbsen({
      companyId: auth.company_id!,
      branchId,
      userId: m.userId,
      employeeCode: m.kode ?? kode,
      nama: m.nama,
      namaCabang,
      fotoUrl: foto_url,
      jarakM,
    });
    if (body.client_ref) {
      await catatHasilIdempoten({
        companyId: auth.company_id!,
        clientRef: body.client_ref,
        userId: auth.sub,
        deviceId: body.device_id ?? null,
        tipe: "absen_stasiun",
        hasilJson: result,
      });
    }
    return c.json(result, 201);
  })
  // Absen SENDIRI — atas nama pemanggil (auth.sub). Aman untuk peran tim: tak
  // ada kode yang bisa dititipkan; server memakai keanggotaan pemanggil.
  .post("/saya", zValidator("json", SelfBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    if (body.client_ref) {
      const ada = await cariHasilIdempoten(auth.company_id!, body.client_ref);
      if (ada) return c.json(ada.hasilJson, 200);
    }
    const branchId = await resolveBranchId(c);
    const { lat, lng, foto_url } = body;
    const { jarakM, namaCabang } = await cekRadius(branchId, lat, lng);

    const [m] = await db
      .select({
        kode: memberships.employeeCode,
        nama: users.nama,
        isActive: users.isActive,
      })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .where(
        and(
          eq(memberships.companyId, auth.company_id!),
          eq(memberships.userId, auth.sub),
          isNull(memberships.archivedAt),
        ),
      );
    if (!m) throw new HTTPException(403, { message: "Akun Anda bukan karyawan aktif cabang ini" });
    if (!m.kode) {
      throw new HTTPException(400, { message: "Kode karyawan Anda belum diatur — hubungi admin" });
    }
    if (!m.isActive) throw new HTTPException(400, { message: "Akun Anda berstatus nonaktif" });

    const result = await catatAbsen({
      companyId: auth.company_id!,
      branchId,
      userId: auth.sub,
      employeeCode: m.kode,
      nama: m.nama,
      namaCabang,
      fotoUrl: foto_url,
      jarakM,
    });
    if (body.client_ref) {
      await catatHasilIdempoten({
        companyId: auth.company_id!,
        clientRef: body.client_ref,
        userId: auth.sub,
        deviceId: body.device_id ?? null,
        tipe: "absen_saya",
        hasilJson: result,
      });
    }
    return c.json(result, 201);
  })
  // Ringkasan absensi hari ini (atau ?tanggal=YYYY-MM-DD) di cabang: jam masuk
  // pertama & jam keluar terakhir per karyawan.
  .get("/", async (c) => {
    const auth = c.get("auth");
    const branchId = await resolveBranchId(c);
    const tanggalQ = c.req.query("tanggal");
    if (tanggalQ !== undefined && !tanggalValid(tanggalQ)) {
      throw new HTTPException(400, { message: "Format tanggal harus YYYY-MM-DD" });
    }
    const tanggal = tanggalQ ?? tanggalDi(await timezoneOf(auth.company_id!));
    const rows = await db
      .select({
        user_id: attendances.userId,
        nama: users.nama,
        employee_code: memberships.employeeCode,
        masuk: sql<string | null>`min(${attendances.waktu}) filter (where ${attendances.tipe} = 'masuk')`,
        keluar: sql<string | null>`max(${attendances.waktu}) filter (where ${attendances.tipe} = 'keluar')`,
        // foto pada cap masuk PERTAMA & keluar TERAKHIR (urut waktu)
        foto_masuk: sql<
          string | null
        >`(array_agg(${attendances.fotoUrl} order by ${attendances.waktu}) filter (where ${attendances.tipe} = 'masuk'))[1]`,
        foto_keluar: sql<
          string | null
        >`(array_agg(${attendances.fotoUrl} order by ${attendances.waktu} desc) filter (where ${attendances.tipe} = 'keluar'))[1]`,
      })
      .from(attendances)
      .innerJoin(users, eq(attendances.userId, users.id))
      .leftJoin(
        memberships,
        and(
          eq(memberships.userId, attendances.userId),
          eq(memberships.companyId, attendances.companyId),
        ),
      )
      .where(
        and(
          eq(attendances.companyId, auth.company_id!),
          eq(attendances.branchId, branchId),
          eq(attendances.attendDate, tanggal),
        ),
      )
      .groupBy(attendances.userId, users.nama, memberships.employeeCode)
      .orderBy(sql`min(${attendances.waktu})`);
    const dto: AbsensiRow[] = rows.map((r) => ({
      user_id: r.user_id,
      nama: r.nama,
      employee_code: r.employee_code ?? null,
      masuk: r.masuk ? new Date(r.masuk).toISOString() : null,
      keluar: r.keluar ? new Date(r.keluar).toISOString() : null,
      foto_masuk: r.foto_masuk ?? null,
      foto_keluar: r.foto_keluar ?? null,
    }));
    return c.json(dto);
  })
  /**
   * REKAP ABSEN SEBULAN — khusus owner/admin (gerbang INLINE: grup `/absensi/*`
   * sengaja terbuka untuk 6 peran karena semua orang absen sendiri, tapi rekap
   * lintas karyawan setara laporan manajemen).
   *
   * Query: `?bulan=YYYY-MM` (default bulan berjalan di zona waktu perusahaan),
   * `?branch_id=` (`all` = semua cabang), `?status=aktif|arsip|semua`
   * (bawaan `aktif` — karyawan yang sudah keluar tak ikut mengotori rekap).
   *
   * Aturan hitung — "outlet buka tiap hari", tanpa tabel jadwal kerja:
   *   ada cap absen           → hadir
   *   pengajuan DISETUJUI     → cuti / libur
   *   selain itu (dan sudah lewat) → alpa
   *   di luar jendela hitung  → kosong (tak pernah dihitung)
   * Jendela hitung per karyawan dipotong tanggal bergabung & tanggal diarsipkan
   * supaya karyawan baru/keluar tak terlihat alpa sebulan penuh.
   */
  .get("/rekap", requireRole("owner", "admin"), async (c) => {
    const auth = c.get("auth");
    const tz = await timezoneOf(auth.company_id!);
    const hariIni = tanggalDi(tz);

    const bulanQ = c.req.query("bulan");
    const bulan = bulanQ && /^\d{4}-(0[1-9]|1[0-2])$/.test(bulanQ) ? bulanQ : hariIni.slice(0, 7);
    const [th, bl] = bulan.split("-").map(Number);
    const jumlahHariBulan = new Date(Date.UTC(th, bl, 0)).getUTCDate();
    const dari = `${bulan}-01`;
    const sampai = `${bulan}-${String(jumlahHariBulan).padStart(2, "0")}`;
    // Batas kanan jendela: hari ini bila bulan berjalan, akhir bulan bila sudah lewat.
    const batasHitung = hariIni < dari ? null : hariIni < sampai ? hariIni : sampai;

    const branchQ = c.req.query("branch_id");
    const branchId = branchQ && branchQ !== "all" ? branchQ : undefined;

    // (1) Karyawan mana yang masuk daftar — `?status=`:
    //   aktif (bawaan) : keanggotaan belum diarsipkan — daftar kerja sehari-hari
    //   arsip          : sudah keluar, TAPI keluarnya pada/sesudah bulan ini.
    //                    Yang keluar tahun lalu tak punya satu pun hari kerja di
    //                    bulan ini — barisnya cuma titik-titik, jadi disembunyikan.
    //   semua          : gabungan keduanya.
    const statusQ = c.req.query("status");
    const status: "aktif" | "arsip" | "semua" =
      statusQ === "arsip" || statusQ === "semua" ? statusQ : "aktif";
    const awalBulan = new Date(`${dari}T00:00:00Z`);
    const saringStatus =
      status === "aktif"
        ? isNull(memberships.archivedAt)
        : status === "arsip"
          ? and(isNotNull(memberships.archivedAt), gte(memberships.archivedAt, awalBulan))
          : or(isNull(memberships.archivedAt), gte(memberships.archivedAt, awalBulan));

    const karyawanMentah = await db
      .select({
        user_id: users.id,
        nama: users.nama,
        employee_code: memberships.employeeCode,
        role: memberships.role,
        cabang: branches.nama,
        bergabung: memberships.createdAt,
        arsip: memberships.archivedAt,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .leftJoin(branches, eq(branches.id, memberships.branchId))
      .where(
        and(
          eq(memberships.companyId, auth.company_id!),
          branchId ? eq(memberships.branchId, branchId) : undefined,
          saringStatus,
        ),
      )
      .orderBy(users.nama);

    // Yang baru bergabung SETELAH bulan ini berakhir tak punya hari kerja di
    // sini — tanpa ini barisnya muncul berisi titik-titik semua. Disaring di
    // memori (bukan SQL) agar konversi zona waktunya persis sama dengan
    // perhitungan `mulaiHitung` di bawah.
    const karyawan = karyawanMentah.filter((k) => tanggalDi(tz, k.bergabung) <= sampai);

    // (2) Absensi bulan itu, satu baris per (karyawan, tanggal).
    const cap = await db
      .select({
        user_id: attendances.userId,
        tanggal: attendances.attendDate,
        masuk: sql<string | null>`min(${attendances.waktu}) filter (where ${attendances.tipe} = 'masuk')`,
        keluar: sql<string | null>`max(${attendances.waktu}) filter (where ${attendances.tipe} = 'keluar')`,
      })
      .from(attendances)
      .where(
        and(
          eq(attendances.companyId, auth.company_id!),
          branchId ? eq(attendances.branchId, branchId) : undefined,
          gte(attendances.attendDate, dari),
          lte(attendances.attendDate, sampai),
        ),
      )
      .groupBy(attendances.userId, attendances.attendDate);

    const petaCap = new Map<string, { masuk: string | null; keluar: string | null }>();
    for (const r of cap) {
      petaCap.set(`${r.user_id}|${r.tanggal}`, {
        masuk: r.masuk ? new Date(r.masuk).toISOString() : null,
        keluar: r.keluar ? new Date(r.keluar).toISOString() : null,
      });
    }

    // (3) Cuti/libur DISETUJUI yang bertindih bulan ini → tebar per tanggal.
    const izin = await pengajuanDisetujuiPadaRentang(auth.company_id!, dari, sampai, branchId);
    const petaIzin = new Map<string, { jenis: "cuti" | "libur"; kategori: PengajuanKategori }>();
    for (const p of izin) {
      const mulai = p.mulai < dari ? dari : p.mulai;
      const selesai = p.selesai > sampai ? sampai : p.selesai;
      for (const t of tanggalDalamRentang(mulai, selesai)) {
        petaIzin.set(`${p.userId}|${t}`, {
          jenis: p.jenis,
          kategori: p.kategori as PengajuanKategori,
        });
      }
    }

    const semuaTanggal = tanggalDalamRentang(dari, sampai);
    const rows: RekapAbsenRow[] = karyawan.map((k) => {
      // Jendela per karyawan: sejak bergabung sampai diarsipkan (atau batas bulan).
      const mulaiHitung = (() => {
        const gabung = tanggalDi(tz, k.bergabung);
        return gabung > dari ? gabung : dari;
      })();
      const akhirHitung = (() => {
        if (!batasHitung) return null;
        if (!k.arsip) return batasHitung;
        const keluar = tanggalDi(tz, k.arsip);
        return keluar < batasHitung ? keluar : batasHitung;
      })();

      let hadir = 0;
      let alpa = 0;
      let cuti = 0;
      let libur = 0;
      const harian: RekapAbsenHari[] = semuaTanggal.map((tanggal) => {
        const kunci = `${k.user_id}|${tanggal}`;
        const c1 = petaCap.get(kunci);
        if (c1) {
          hadir++;
          return { tanggal, status: "hadir", kategori: null, masuk: c1.masuk, keluar: c1.keluar };
        }
        const i1 = petaIzin.get(kunci);
        if (i1) {
          if (i1.jenis === "cuti") cuti++;
          else libur++;
          return {
            tanggal,
            status: i1.jenis,
            kategori: i1.kategori,
            masuk: null,
            keluar: null,
          };
        }
        const dalamJendela =
          akhirHitung !== null && tanggal >= mulaiHitung && tanggal <= akhirHitung;
        if (dalamJendela) {
          alpa++;
          return { tanggal, status: "alpa", kategori: null, masuk: null, keluar: null };
        }
        return { tanggal, status: "kosong", kategori: null, masuk: null, keluar: null };
      });

      return {
        user_id: k.user_id,
        nama: k.nama,
        employee_code: k.employee_code ?? null,
        role: k.role,
        cabang: k.cabang ?? null,
        arsip_pada: k.arsip ? k.arsip.toISOString() : null,
        hadir,
        tidak_hadir: alpa,
        cuti,
        libur,
        harian,
      };
    });

    const dto: RekapAbsenDto = {
      bulan,
      dari,
      sampai,
      hari: jumlahHariBulan,
      hari_terhitung: batasHitung ? jumlahHari(dari, batasHitung) : 0,
      rows,
    };
    return c.json(dto);
  });

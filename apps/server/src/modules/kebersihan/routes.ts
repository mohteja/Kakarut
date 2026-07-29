import { zValidator } from "@hono/zod-validator";
import { aliasedTable, and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  KODE_SESI_KEBERSIHAN,
  type AreaKebersihanDto,
  type KebersihanSesi,
  type LaporanKebersihanDto,
  type LaporanKebersihanItem,
  type LaporanKebersihanRingkas,
  type RekapKebersihanDto,
  type RekapKebersihanHari,
} from "@kakarut/shared";
import { db } from "../../db/client";
import {
  branches,
  cleaningAreas,
  cleaningReportItems,
  cleaningReports,
  companies,
  memberships,
  users,
} from "../../db/schema";
import { tanggalDi } from "../../lib/time";
import { requireRole, terikatCabang, type AppEnv } from "../../middleware/auth";
import { tanggalDalamRentang } from "../pengajuan/routes";

/**
 * LAPORAN KEBERSIHAN HARIAN. Semua peran MEMBUAT laporannya masing-masing
 * (gerbang grup di app.ts sama dengan absensi/pengajuan); yang MEMBACA REKAP
 * dan mengatur master area hanya owner/admin — digerbang inline pada rute
 * terkait, karena grupnya sengaja terbuka.
 *
 * Dua aturan yang menjadi tulang punggung modul ini:
 *  1. `tanggal` SELALU diturunkan server dari zona waktu perusahaan — klien tak
 *     pernah mengirimnya, jadi laporan tak bisa dibuat mundur.
 *  2. `branchId` diambil dari keanggotaan sisi server, bukan dari body.
 */

/** Batas wajar agar satu laporan tidak dipakai mengirim ratusan baris. */
const MAKS_ITEM = 100;

/** Zona waktu perusahaan; sama seperti modul absensi. */
async function timezoneOf(companyId: string): Promise<string> {
  const [c] = await db
    .select({ tz: companies.timezone })
    .from(companies)
    .where(eq(companies.id, companyId));
  return c?.tz ?? "Asia/Jakarta";
}

const ItemBody = z.object({
  area_id: z.string().uuid("Area tidak valid"),
  bersih: z.boolean(),
  catatan: z.string().trim().max(300).nullish(),
  foto_url: z.string().trim().max(500).nullish(),
});

const LaporanBody = z.object({
  // `tanggal` SENGAJA tidak diterima — server yang menurunkannya.
  sesi: z.enum(KODE_SESI_KEBERSIHAN),
  catatan: z.string().trim().max(500).nullish(),
  items: z.array(ItemBody).min(1, "Checklist tidak boleh kosong").max(MAKS_ITEM),
});

/** PATCH hanya mengganti isi; sesi & tanggal tetap seperti saat dibuat. */
const UbahBody = z.object({
  catatan: z.string().trim().max(500).nullish(),
  items: z.array(ItemBody).min(1, "Checklist tidak boleh kosong").max(MAKS_ITEM),
});

const CatatanBody = z.object({
  catatan_owner: z.string().trim().max(1000).nullish(),
});

const AreaBody = z.object({
  nama: z.string().trim().min(1, "Nama area wajib diisi").max(120),
  /** null / tak dikirim = berlaku di semua lokasi */
  branch_id: z.string().uuid().nullish(),
  urutan: z.number().int().min(0).max(9999).optional(),
  is_active: z.boolean().optional(),
});

const UbahAreaBody = AreaBody.partial();

/** Pemberi catatan di-join lewat alias — `users` sudah dipakai untuk pelapor. */
const pencatat = aliasedTable(users, "pencatat");

const kolomLaporan = {
  id: cleaningReports.id,
  user_id: cleaningReports.userId,
  nama: users.nama,
  branch_id: cleaningReports.branchId,
  cabang: branches.nama,
  tanggal: cleaningReports.tanggal,
  sesi: cleaningReports.sesi,
  catatan: cleaningReports.catatan,
  catatan_owner: cleaningReports.catatanOwner,
  catatan_owner_oleh: pencatat.nama,
  catatan_owner_pada: cleaningReports.catatanOwnerPada,
  created_at: cleaningReports.createdAt,
  updated_at: cleaningReports.updatedAt,
};

type BarisLaporan = { [K in keyof typeof kolomLaporan]: unknown };

function toItem(r: {
  id: string;
  areaId: string | null;
  areaNama: string;
  bersih: boolean;
  catatan: string | null;
  fotoUrl: string | null;
  urutan: number;
}): LaporanKebersihanItem {
  return {
    id: r.id,
    area_id: r.areaId,
    area_nama: r.areaNama,
    bersih: r.bersih,
    catatan: r.catatan,
    foto_url: r.fotoUrl,
    urutan: r.urutan,
  };
}

function toDto(r: BarisLaporan, items: LaporanKebersihanItem[]): LaporanKebersihanDto {
  const bersih = items.filter((i) => i.bersih).length;
  return {
    id: String(r.id),
    user_id: String(r.user_id),
    nama: String(r.nama),
    branch_id: String(r.branch_id),
    cabang: (r.cabang as string | null) ?? null,
    tanggal: String(r.tanggal),
    sesi: r.sesi as KebersihanSesi,
    catatan: (r.catatan as string | null) ?? null,
    catatan_owner: (r.catatan_owner as string | null) ?? null,
    catatan_owner_oleh: (r.catatan_owner_oleh as string | null) ?? null,
    catatan_owner_pada: r.catatan_owner_pada
      ? (r.catatan_owner_pada as Date).toISOString()
      : null,
    total_area: items.length,
    area_bersih: bersih,
    area_kotor: items.length - bersih,
    jumlah_foto: items.filter((i) => !!i.foto_url).length,
    created_at: (r.created_at as Date).toISOString(),
    updated_at: (r.updated_at as Date).toISOString(),
    items,
  };
}

/**
 * Baris laporan mentah (tanpa item) — dipakai detail, list, dan rekap.
 * Urutan diserahkan pemanggil; `limit` 0 berarti tanpa batas.
 */
async function selectLaporan(
  syarat: SQL[],
  urut: SQL[] = [],
  limit = 0,
): Promise<BarisLaporan[]> {
  const q = db
    .select(kolomLaporan)
    .from(cleaningReports)
    .innerJoin(users, eq(users.id, cleaningReports.userId))
    .leftJoin(branches, eq(branches.id, cleaningReports.branchId))
    .leftJoin(pencatat, eq(pencatat.id, cleaningReports.catatanOwnerOlehUserId))
    .where(and(...syarat))
    .$dynamic();
  if (urut.length > 0) q.orderBy(...urut);
  if (limit > 0) q.limit(limit);
  return q;
}

/** Item milik sekumpulan laporan, terkelompok per laporan. */
async function itemsPerLaporan(ids: string[]): Promise<Map<string, LaporanKebersihanItem[]>> {
  const peta = new Map<string, LaporanKebersihanItem[]>();
  if (ids.length === 0) return peta;
  const rows = await db
    .select({
      id: cleaningReportItems.id,
      reportId: cleaningReportItems.reportId,
      areaId: cleaningReportItems.areaId,
      areaNama: cleaningReportItems.areaNama,
      bersih: cleaningReportItems.bersih,
      catatan: cleaningReportItems.catatan,
      fotoUrl: cleaningReportItems.fotoUrl,
      urutan: cleaningReportItems.urutan,
    })
    .from(cleaningReportItems)
    .where(inArray(cleaningReportItems.reportId, ids))
    .orderBy(asc(cleaningReportItems.urutan));
  for (const r of rows) {
    const arr = peta.get(r.reportId) ?? [];
    arr.push(toItem(r));
    peta.set(r.reportId, arr);
  }
  return peta;
}

/** Ambil satu laporan lengkap (untuk respons setelah tulis). */
async function ambilSatu(id: string, companyId: string): Promise<LaporanKebersihanDto> {
  const [row] = await selectLaporan([
    eq(cleaningReports.id, id),
    eq(cleaningReports.companyId, companyId),
  ]);
  if (!row) throw new HTTPException(404, { message: "Laporan kebersihan tidak ditemukan" });
  const peta = await itemsPerLaporan([id]);
  return toDto(row, peta.get(id) ?? []);
}

/**
 * Cabang pelapor, dari keanggotaan SAAT INI. Owner/admin yang bertugas di
 * Kantor tidak punya cabang — mereka tak bisa membuat laporan kebersihan.
 */
async function cabangPelapor(userId: string, companyId: string): Promise<string> {
  const [m] = await db
    .select({ branchId: memberships.branchId })
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.companyId, companyId),
        isNull(memberships.archivedAt),
      ),
    );
  if (!m?.branchId) {
    throw new HTTPException(400, {
      message: "Akun tanpa cabang tidak bisa membuat laporan kebersihan",
    });
  }
  return m.branchId;
}

/**
 * Ubah body checklist menjadi baris siap simpan: nama area diambil dari master
 * (bukan dari klien) lalu DISALIN ke baris sebagai snapshot.
 */
async function siapkanItems(
  companyId: string,
  branchId: string,
  items: z.infer<typeof ItemBody>[],
) {
  const ids = [...new Set(items.map((i) => i.area_id))];
  if (ids.length !== items.length) {
    throw new HTTPException(400, { message: "Ada area yang dikirim lebih dari sekali" });
  }
  const master = await db
    .select({ id: cleaningAreas.id, nama: cleaningAreas.nama, urutan: cleaningAreas.urutan })
    .from(cleaningAreas)
    .where(
      and(
        eq(cleaningAreas.companyId, companyId),
        inArray(cleaningAreas.id, ids),
        // Area khusus cabang lain tak boleh dipakai.
        or(isNull(cleaningAreas.branchId), eq(cleaningAreas.branchId, branchId))!,
        // Area yang sudah dinonaktifkan owner tak boleh masuk laporan baru:
        // tanpa ini, tablet dapur yang cache-nya belum segar tetap bisa
        // mengirimnya dan `total_area` di rekap owner ikut menghitung baris
        // yang sengaja sudah dipensiunkan.
        eq(cleaningAreas.isActive, true),
      ),
    );
  const peta = new Map(master.map((m) => [m.id, m]));
  const kurang = ids.filter((id) => !peta.has(id));
  if (kurang.length > 0) {
    // Sebut jumlahnya: pesan lama tak menyebut apa pun, jadi pengirim tak tahu
    // baris mana yang harus dibuang.
    throw new HTTPException(400, {
      message: `${kurang.length} area tidak dikenal, sudah dinonaktifkan, atau bukan untuk lokasi Anda — muat ulang daftar area`,
    });
  }
  if (!items.some((i) => !!i.foto_url?.trim())) {
    throw new HTTPException(400, { message: "Lampirkan minimal 1 foto bukti" });
  }
  return items.map((i) => {
    const m = peta.get(i.area_id)!;
    return {
      areaId: m.id,
      areaNama: m.nama,
      bersih: i.bersih,
      catatan: i.catatan?.trim() || null,
      fotoUrl: i.foto_url?.trim() || null,
      urutan: m.urutan,
    };
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `branch_id` dari query masuk langsung ke klausa WHERE kolom uuid. Nilai yang
 * bukan uuid membuat Postgres melempar `invalid input syntax for type uuid`,
 * yang keluar sebagai **500** — padahal itu murni salah input klien. Disaring
 * lebih dulu jadi 400 yang bisa ditindaklanjuti.
 *
 * Mengembalikan null bila tak ada saringan (`all` / tak dikirim).
 */
function saringCabang(v: string | undefined): string | null {
  if (!v || v === "all") return null;
  if (!UUID_RE.test(v)) {
    throw new HTTPException(400, { message: "branch_id bukan UUID yang sah" });
  }
  return v;
}

/** Deteksi pelanggaran unique (user × tanggal × sesi) tanpa menebak-nebak pesan. */
function bentrokSesi(err: unknown): boolean {
  const kode = (err as { cause?: { code?: string }; code?: string })?.cause?.code ??
    (err as { code?: string })?.code;
  return kode === "23505";
}

export const kebersihanRoutes = new Hono<AppEnv>()
  /* ===== Master area — DIDAFTARKAN SEBELUM /:id agar tidak tertangkap olehnya ===== */

  /**
   * Daftar area checklist. Peran terkunci cabang hanya menerima area yang
   * berlaku untuk lokasinya (umum + khusus cabangnya).
   *
   * Manajemen memakai endpoint yang sama untuk DUA hal yang berbeda, jadi
   * saringannya harus dipilih pemanggil:
   *  - layar pengisian → `?aktif=1` tanpa `branch_id` = "area yang boleh SAYA
   *    laporkan": ikut cabang penugasan sendiri, hanya yang aktif. Tanpa
   *    bawaan ini, admin bercabang melihat area cabang lain + area nonaktif di
   *    formulirnya, lalu `siapkanItems` menolak kirimannya dengan 400.
   *  - modal master area → `?branch_id=all` = seluruh area perusahaan apa
   *    adanya, termasuk yang nonaktif (memang itu yang diatur di sana).
   */
  .get("/area", async (c) => {
    const auth = c.get("auth");
    const syarat = [eq(cleaningAreas.companyId, auth.company_id!)];

    if (terikatCabang(auth.role)) {
      if (auth.branch_id) {
        syarat.push(or(isNull(cleaningAreas.branchId), eq(cleaningAreas.branchId, auth.branch_id))!);
      } else {
        syarat.push(isNull(cleaningAreas.branchId));
      }
      syarat.push(eq(cleaningAreas.isActive, true));
    } else {
      const q = c.req.query("branch_id");
      const branchId = saringCabang(q);
      if (branchId) {
        syarat.push(or(isNull(cleaningAreas.branchId), eq(cleaningAreas.branchId, branchId))!);
      } else if (q !== "all" && auth.branch_id) {
        // Tak menyebut cabang = bertindak sebagai pelapor di cabangnya sendiri.
        syarat.push(or(isNull(cleaningAreas.branchId), eq(cleaningAreas.branchId, auth.branch_id))!);
      }
      if (c.req.query("aktif") === "1") syarat.push(eq(cleaningAreas.isActive, true));
    }

    const rows = await db
      .select({
        id: cleaningAreas.id,
        nama: cleaningAreas.nama,
        branch_id: cleaningAreas.branchId,
        cabang: branches.nama,
        urutan: cleaningAreas.urutan,
        is_active: cleaningAreas.isActive,
      })
      .from(cleaningAreas)
      .leftJoin(branches, eq(branches.id, cleaningAreas.branchId))
      .where(and(...syarat))
      .orderBy(asc(cleaningAreas.urutan), asc(cleaningAreas.nama));

    const dto: AreaKebersihanDto[] = rows.map((r) => ({
      id: r.id,
      nama: r.nama,
      branch_id: r.branch_id,
      cabang: r.cabang,
      urutan: r.urutan,
      is_active: r.is_active,
    }));
    return c.json(dto);
  })

  /** Tambah area — owner/admin (gerbang inline, grup ini terbuka semua peran). */
  .post("/area", requireRole("owner", "admin"), zValidator("json", AreaBody), async (c) => {
    const auth = c.get("auth");
    const b = c.req.valid("json");
    if (b.branch_id) await pastikanCabangMilik(b.branch_id, auth.company_id!);
    const [baru] = await db
      .insert(cleaningAreas)
      .values({
        companyId: auth.company_id!,
        branchId: b.branch_id ?? null,
        nama: b.nama,
        urutan: b.urutan ?? 0,
        isActive: b.is_active ?? true,
      })
      .returning({ id: cleaningAreas.id });
    return c.json({ id: baru.id }, 201);
  })

  .patch("/area/:id", requireRole("owner", "admin"), zValidator("json", UbahAreaBody), async (c) => {
    const auth = c.get("auth");
    const id = c.req.param("id");
    const b = c.req.valid("json");
    const [ada] = await db
      .select({ id: cleaningAreas.id })
      .from(cleaningAreas)
      .where(and(eq(cleaningAreas.id, id), eq(cleaningAreas.companyId, auth.company_id!)));
    if (!ada) throw new HTTPException(404, { message: "Area tidak ditemukan" });
    if (b.branch_id) await pastikanCabangMilik(b.branch_id, auth.company_id!);

    await db
      .update(cleaningAreas)
      .set({
        ...(b.nama !== undefined ? { nama: b.nama } : {}),
        ...(b.branch_id !== undefined ? { branchId: b.branch_id ?? null } : {}),
        ...(b.urutan !== undefined ? { urutan: b.urutan } : {}),
        ...(b.is_active !== undefined ? { isActive: b.is_active } : {}),
      })
      .where(eq(cleaningAreas.id, id));
    return c.json({ ok: true });
  })

  /**
   * Hapus area. Aman terhadap riwayat: baris laporan lama menyimpan salinan
   * nama (`area_nama`), dan `area_id`-nya di-null-kan oleh FK.
   */
  .delete("/area/:id", requireRole("owner", "admin"), async (c) => {
    const auth = c.get("auth");
    const id = c.req.param("id");
    const [ada] = await db
      .select({ id: cleaningAreas.id })
      .from(cleaningAreas)
      .where(and(eq(cleaningAreas.id, id), eq(cleaningAreas.companyId, auth.company_id!)));
    if (!ada) throw new HTTPException(404, { message: "Area tidak ditemukan" });
    await db.delete(cleaningAreas).where(eq(cleaningAreas.id, id));
    return c.json({ ok: true });
  })

  /* ===== Rekap harian — owner/admin ===== */

  /**
   * Rekap sebulan, SATU KOTAK SATU HARI. Kebalikan rekap absen yang
   * employee-major: di sini tanggal yang menjadi baris luar, sehingga owner
   * bisa membaca "hari ini siapa saja yang sudah melapor".
   */
  .get("/rekap", requireRole("owner", "admin"), async (c) => {
    const auth = c.get("auth");
    const tz = await timezoneOf(auth.company_id!);
    const hariIni = tanggalDi(tz);

    // Bulan HARUS 01–12. Pola longgar `\d{2}` meloloskan "2026-13"/"2026-00",
    // yang lalu dirakit jadi tanggal mustahil ("2026-13-01") dan membuat
    // Postgres melempar → 500, padahal kontraknya menjanjikan jatuh ke bulan
    // berjalan. Pola ketat ini sama dengan rekap absensi (absensi/routes.ts).
    const bulanQ = c.req.query("bulan");
    const bulan = bulanQ && /^\d{4}-(0[1-9]|1[0-2])$/.test(bulanQ) ? bulanQ : hariIni.slice(0, 7);
    const dari = `${bulan}-01`;
    const [th, bl] = bulan.split("-").map(Number);
    const akhirBulan = new Date(Date.UTC(th, bl, 0)).toISOString().slice(0, 10);
    // Bulan berjalan berhenti di hari ini — hari yang belum datang bukan "bolong".
    const sampai = akhirBulan > hariIni ? hariIni : akhirBulan;

    const syarat = [
      eq(cleaningReports.companyId, auth.company_id!),
      gte(cleaningReports.tanggal, dari),
      lte(cleaningReports.tanggal, sampai),
    ];
    const branchId = saringCabang(c.req.query("branch_id"));
    if (branchId) syarat.push(eq(cleaningReports.branchId, branchId));
    const sesi = c.req.query("sesi");
    if (sesi === "pagi" || sesi === "siang" || sesi === "malam") {
      syarat.push(eq(cleaningReports.sesi, sesi));
    }

    const rows = await selectLaporan(syarat, [
      asc(branches.nama),
      asc(cleaningReports.sesi),
      asc(cleaningReports.createdAt),
    ]);

    const peta = await itemsPerLaporan(rows.map((r) => String(r.id)));

    const perTanggal = new Map<string, LaporanKebersihanRingkas[]>();
    for (const r of rows) {
      const items = peta.get(String(r.id)) ?? [];
      const bersih = items.filter((i) => i.bersih).length;
      const ringkas: LaporanKebersihanRingkas = {
        id: String(r.id),
        user_id: String(r.user_id),
        nama: String(r.nama),
        branch_id: String(r.branch_id),
        cabang: (r.cabang as string | null) ?? null,
        sesi: r.sesi as KebersihanSesi,
        total_area: items.length,
        area_bersih: bersih,
        area_kotor: items.length - bersih,
        jumlah_foto: items.filter((i) => !!i.foto_url).length,
        foto_utama: items.find((i) => !!i.foto_url)?.foto_url ?? null,
        ada_catatan_owner: !!(r.catatan_owner as string | null),
        created_at: (r.created_at as Date).toISOString(),
      };
      const tgl = String(r.tanggal);
      const arr = perTanggal.get(tgl) ?? [];
      arr.push(ringkas);
      perTanggal.set(tgl, arr);
    }

    // Hari tanpa laporan tetap muncul sebagai kotak kosong — itulah gunanya
    // rekap ini: melihat hari yang bolong, bukan hanya yang terisi.
    const hari: RekapKebersihanHari[] = tanggalDalamRentang(dari, sampai)
      .reverse()
      .map((tanggal) => {
        const laporan = perTanggal.get(tanggal) ?? [];
        return {
          tanggal,
          total: laporan.length,
          area_kotor: laporan.reduce((s, l) => s + l.area_kotor, 0),
          sesi: {
            pagi: laporan.filter((l) => l.sesi === "pagi").length,
            siang: laporan.filter((l) => l.sesi === "siang").length,
            malam: laporan.filter((l) => l.sesi === "malam").length,
          },
          laporan,
        };
      });

    const dto: RekapKebersihanDto = { bulan, dari, sampai, hari };
    return c.json(dto);
  })

  /**
   * Ringkasan hari ini untuk badge sidebar — sengaja terpisah dari `/rekap`
   * yang memuat sebulan penuh, karena badge di-poll tiap menit.
   */
  .get("/ringkas", requireRole("owner", "admin"), async (c) => {
    const auth = c.get("auth");
    const tz = await timezoneOf(auth.company_id!);
    const tanggal = tanggalDi(tz);
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(cleaningReports)
      .where(
        and(eq(cleaningReports.companyId, auth.company_id!), eq(cleaningReports.tanggal, tanggal)),
      );
    return c.json({
      tanggal,
      total: row?.n ?? 0,
      kotor: await jumlahKotorHariIni(auth.company_id!),
    });
  })

  /* ===== Laporan ===== */

  /**
   * Daftar laporan. Peran terkunci cabang SELALU hanya melihat miliknya —
   * laporan memuat penilaian pekerjaan, jadi tak dibagikan antar karyawan.
   *
   * `?saya=1` memaksa penyempitan itu untuk SEMUA peran. Manajemen butuh ini
   * di layar pengisian: tanpa penanda eksplisit, daftarnya berisi laporan
   * seluruh karyawan, dan layar yang menyebutnya "laporan saya" akan menandai
   * sesi milik orang lain sebagai sudah terisi lalu mencoba mem-PATCH-nya
   * (ditolak 403 — pelapornya jadi buntu).
   */
  .get("/", async (c) => {
    const auth = c.get("auth");
    const syarat = [eq(cleaningReports.companyId, auth.company_id!)];

    if (terikatCabang(auth.role) || c.req.query("saya") === "1") {
      syarat.push(eq(cleaningReports.userId, auth.sub));
    } else {
      const branchId = saringCabang(c.req.query("branch_id"));
      if (branchId) syarat.push(eq(cleaningReports.branchId, branchId));
    }
    const dari = c.req.query("dari");
    const sampai = c.req.query("sampai");
    if (dari && /^\d{4}-\d{2}-\d{2}$/.test(dari)) syarat.push(gte(cleaningReports.tanggal, dari));
    if (sampai && /^\d{4}-\d{2}-\d{2}$/.test(sampai)) {
      syarat.push(lte(cleaningReports.tanggal, sampai));
    }
    const sesi = c.req.query("sesi");
    if (sesi === "pagi" || sesi === "siang" || sesi === "malam") {
      syarat.push(eq(cleaningReports.sesi, sesi));
    }

    const rows = await selectLaporan(
      syarat,
      [desc(cleaningReports.tanggal), asc(cleaningReports.sesi)],
      200,
    );

    const peta = await itemsPerLaporan(rows.map((r) => String(r.id)));
    return c.json(rows.map((r) => toDto(r, peta.get(String(r.id)) ?? [])));
  })

  /** Detail satu laporan — pemiliknya atau owner/admin. */
  .get("/:id", async (c) => {
    const auth = c.get("auth");
    const dto = await ambilSatu(c.req.param("id"), auth.company_id!);
    if (terikatCabang(auth.role) && dto.user_id !== auth.sub) {
      throw new HTTPException(404, { message: "Laporan kebersihan tidak ditemukan" });
    }
    return c.json(dto);
  })

  /** Kirim laporan sesi hari ini — semua peran, selalu atas nama diri sendiri. */
  .post("/", zValidator("json", LaporanBody), async (c) => {
    const auth = c.get("auth");
    const b = c.req.valid("json");
    const branchId = await cabangPelapor(auth.sub, auth.company_id!);
    const tanggal = tanggalDi(await timezoneOf(auth.company_id!));
    const baris = await siapkanItems(auth.company_id!, branchId, b.items);

    // SATU TRANSAKSI: baris induk + itemnya. Bila keduanya terpisah, kegagalan
    // di tengah meninggalkan laporan tanpa item sama sekali — melanggar
    // invarian "minimal 1 area + minimal 1 foto" yang baru saja divalidasi,
    // dan indeks unik sesi membuat pelapor tak bisa mengirim ulang (409).
    let id: string;
    try {
      id = await db.transaction(async (tx) => {
        const [baru] = await tx
          .insert(cleaningReports)
          .values({
            companyId: auth.company_id!,
            branchId,
            userId: auth.sub,
            tanggal,
            sesi: b.sesi,
            catatan: b.catatan?.trim() || null,
          })
          .returning({ id: cleaningReports.id });
        await tx
          .insert(cleaningReportItems)
          .values(baris.map((r) => ({ ...r, reportId: baru.id })));
        return baru.id;
      });
    } catch (err) {
      // 23505 tetap terbaca dari dalam transaksi yang di-rollback.
      if (bentrokSesi(err)) {
        throw new HTTPException(409, {
          message: "Laporan sesi ini sudah dibuat — perbarui laporan yang ada",
        });
      }
      throw err;
    }

    return c.json(await ambilSatu(id, auth.company_id!), 201);
  })

  /**
   * Perbaiki laporan sendiri — hanya selama masih tanggal yang sama, supaya
   * penilaian hari kemarin tidak bisa dipoles setelah dibaca owner.
   */
  .patch("/:id", zValidator("json", UbahBody), async (c) => {
    const auth = c.get("auth");
    const id = c.req.param("id");
    const b = c.req.valid("json");

    const [ada] = await db
      .select({
        userId: cleaningReports.userId,
        branchId: cleaningReports.branchId,
        tanggal: cleaningReports.tanggal,
      })
      .from(cleaningReports)
      .where(and(eq(cleaningReports.id, id), eq(cleaningReports.companyId, auth.company_id!)));
    if (!ada) throw new HTTPException(404, { message: "Laporan kebersihan tidak ditemukan" });
    if (ada.userId !== auth.sub) {
      throw new HTTPException(403, { message: "Hanya bisa mengubah laporan sendiri" });
    }
    const hariIni = tanggalDi(await timezoneOf(auth.company_id!));
    if (ada.tanggal !== hariIni) {
      throw new HTTPException(409, {
        message: "Laporan hari sebelumnya tidak bisa diubah lagi",
      });
    }

    const baris = await siapkanItems(auth.company_id!, ada.branchId, b.items);
    // SATU TRANSAKSI: tanpa ini, INSERT yang gagal setelah DELETE sukses
    // membuang seluruh checklist berikut foto buktinya — dan mulai besok
    // laporan itu terkunci (409) sehingga tak bisa diisi ulang.
    await db.transaction(async (tx) => {
      await tx.delete(cleaningReportItems).where(eq(cleaningReportItems.reportId, id));
      await tx.insert(cleaningReportItems).values(baris.map((r) => ({ ...r, reportId: id })));
      await tx
        .update(cleaningReports)
        .set({
          // Hanya sentuh `catatan` bila field-nya memang dikirim. `?.trim() ||
          // null` tanpa penjaga ini mengubah field yang TIDAK dikirim menjadi
          // NULL, jadi klien yang cuma memperbaiki checklist ikut menghapus
          // pesan karyawan ke owner tanpa galat dan tanpa jejak.
          ...(b.catatan !== undefined ? { catatan: b.catatan?.trim() || null } : {}),
          updatedAt: new Date(),
        })
        .where(eq(cleaningReports.id, id));
    });
    return c.json(await ambilSatu(id, auth.company_id!));
  })

  /**
   * Catatan owner/admin atas sebuah laporan (mis. "toilet masih kotor").
   * Gerbang inline — grup `/kebersihan/*` terbuka untuk semua peran.
   */
  .patch(
    "/:id/catatan",
    requireRole("owner", "admin"),
    zValidator("json", CatatanBody),
    async (c) => {
      const auth = c.get("auth");
      const id = c.req.param("id");
      const isi = c.req.valid("json").catatan_owner?.trim() || null;
      const [ada] = await db
        .select({ id: cleaningReports.id })
        .from(cleaningReports)
        .where(and(eq(cleaningReports.id, id), eq(cleaningReports.companyId, auth.company_id!)));
      if (!ada) throw new HTTPException(404, { message: "Laporan kebersihan tidak ditemukan" });

      await db
        .update(cleaningReports)
        .set({
          catatanOwner: isi,
          // Catatan dikosongkan → jejak pemberi catatan ikut dibersihkan.
          catatanOwnerOlehUserId: isi ? auth.sub : null,
          catatanOwnerPada: isi ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(eq(cleaningReports.id, id));
      return c.json(await ambilSatu(id, auth.company_id!));
    },
  )

  /** Hapus. Pelapor boleh menghapus miliknya hari itu; owner/admin kapan saja. */
  .delete("/:id", async (c) => {
    const auth = c.get("auth");
    const id = c.req.param("id");
    const [ada] = await db
      .select({ userId: cleaningReports.userId, tanggal: cleaningReports.tanggal })
      .from(cleaningReports)
      .where(and(eq(cleaningReports.id, id), eq(cleaningReports.companyId, auth.company_id!)));
    if (!ada) throw new HTTPException(404, { message: "Laporan kebersihan tidak ditemukan" });

    const manajemen = auth.role === "owner" || auth.role === "admin";
    if (!manajemen) {
      if (ada.userId !== auth.sub) {
        throw new HTTPException(403, { message: "Hanya bisa menghapus laporan sendiri" });
      }
      const hariIni = tanggalDi(await timezoneOf(auth.company_id!));
      if (ada.tanggal !== hariIni) {
        throw new HTTPException(409, {
          message: "Laporan hari sebelumnya tidak bisa dihapus lagi",
        });
      }
    }
    await db.delete(cleaningReports).where(eq(cleaningReports.id, id));
    return c.json({ ok: true });
  });

/** Cabang harus milik perusahaan ini — mencegah area "menempel" ke tenant lain. */
async function pastikanCabangMilik(branchId: string, companyId: string): Promise<void> {
  const [b] = await db
    .select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.id, branchId), eq(branches.companyId, companyId)));
  if (!b) throw new HTTPException(400, { message: "Cabang tidak dikenal" });
}

/**
 * Berapa laporan hari ini yang memuat area TIDAK bersih — sumber badge merah
 * di sidebar owner/admin.
 */
export async function jumlahKotorHariIni(companyId: string): Promise<number> {
  const tanggal = tanggalDi(await timezoneOf(companyId));
  const [row] = await db
    .select({ n: sql<number>`count(distinct ${cleaningReports.id})::int` })
    .from(cleaningReports)
    .innerJoin(cleaningReportItems, eq(cleaningReportItems.reportId, cleaningReports.id))
    .where(
      and(
        eq(cleaningReports.companyId, companyId),
        eq(cleaningReports.tanggal, tanggal),
        eq(cleaningReportItems.bersih, false),
      ),
    );
  return row?.n ?? 0;
}

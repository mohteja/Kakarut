import { zValidator } from "../../lib/validator";
import { aliasedTable, and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  jenisKategori,
  KODE_KATEGORI_PENGAJUAN,
  type PengajuanRow,
  type PengajuanStatus,
} from "@kakarut/shared";
import { db } from "../../db/client";
import { branches, leaveRequests, memberships, users } from "../../db/schema";
import { kunciAntrean } from "../../lib/kunci";
import { tambahHari } from "../../lib/time";
import { requireRole, terikatCabang, type AppEnv, cabangDariQuery} from "../../middleware/auth";

/**
 * PENGAJUAN CUTI & LIBUR. Semua peran boleh MENGAJUKAN (gerbang grup di app.ts
 * sama dengan absensi); yang MEMUTUSKAN hanya owner/admin — digerbang inline
 * pada PATCH. Pengajuan berstatus `disetujui` inilah yang mengubah sebuah
 * tanggal dari "alpa" menjadi "cuti"/"libur" pada rekap absen.
 */

/** Rentang terpanjang yang masuk akal untuk satu pengajuan (cuti melahirkan ±3 bulan). */
const MAKS_HARI = 100;

/** Validasi tanggal YYYY-MM-DD yang benar (menolak 2026-13-40). */
function tanggalValid(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Selisih hari INKLUSIF antara dua tanggal YYYY-MM-DD (1 = hari yang sama). */
export function jumlahHari(mulai: string, selesai: string): number {
  const a = Date.parse(`${mulai}T00:00:00Z`);
  const b = Date.parse(`${selesai}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000) + 1;
}

const BuatBody = z.object({
  // `jenis` SENGAJA tidak diterima dari klien — selalu diturunkan dari kategori.
  kategori: z.enum(KODE_KATEGORI_PENGAJUAN),
  tanggal_mulai: z.string().refine(tanggalValid, "Tanggal mulai tidak valid"),
  tanggal_selesai: z.string().refine(tanggalValid, "Tanggal selesai tidak valid"),
  alasan: z.string().trim().max(500).nullish(),
  lampiran_url: z.string().trim().max(500).nullish(),
}).strict();

const PutusBody = z
  .object({
    status: z.enum(["disetujui", "ditolak"]),
    alasan_tolak: z.string().trim().max(500).nullish(),
  }).strict()
  .refine((b) => b.status !== "ditolak" || !!b.alasan_tolak?.trim(), {
    message: "Alasan penolakan wajib diisi",
    path: ["alasan_tolak"],
  });

/** Pemutus di-join lewat alias — tabel `users` sudah dipakai untuk pemohon. */
const pemutus = aliasedTable(users, "pemutus");

const kolomDto = {
  id: leaveRequests.id,
  user_id: leaveRequests.userId,
  nama: users.nama,
  employee_code: memberships.employeeCode,
  cabang: branches.nama,
  jenis: leaveRequests.jenis,
  kategori: leaveRequests.kategori,
  tanggal_mulai: leaveRequests.tanggalMulai,
  tanggal_selesai: leaveRequests.tanggalSelesai,
  alasan: leaveRequests.alasan,
  lampiran_url: leaveRequests.lampiranUrl,
  status: leaveRequests.status,
  alasan_tolak: leaveRequests.alasanTolak,
  diputus_oleh: pemutus.nama,
  diputus_pada: leaveRequests.diputusPada,
  created_at: leaveRequests.createdAt,
};

type BarisMentah = {
  [K in keyof typeof kolomDto]: unknown;
};

function toDto(r: BarisMentah): PengajuanRow {
  const mulai = String(r.tanggal_mulai);
  const selesai = String(r.tanggal_selesai);
  return {
    id: String(r.id),
    user_id: String(r.user_id),
    nama: String(r.nama),
    employee_code: (r.employee_code as string | null) ?? null,
    cabang: (r.cabang as string | null) ?? null,
    jenis: r.jenis as PengajuanRow["jenis"],
    kategori: r.kategori as PengajuanRow["kategori"],
    tanggal_mulai: mulai,
    tanggal_selesai: selesai,
    jumlah_hari: jumlahHari(mulai, selesai),
    alasan: (r.alasan as string | null) ?? null,
    lampiran_url: (r.lampiran_url as string | null) ?? null,
    status: r.status as PengajuanStatus,
    alasan_tolak: (r.alasan_tolak as string | null) ?? null,
    diputus_oleh: (r.diputus_oleh as string | null) ?? null,
    diputus_pada: r.diputus_pada ? (r.diputus_pada as Date).toISOString() : null,
    created_at: (r.created_at as Date).toISOString(),
  };
}

/** Ambil satu pengajuan lengkap (untuk respons setelah tulis). */
async function ambilSatu(id: string, companyId: string): Promise<PengajuanRow> {
  const [row] = await db
    .select(kolomDto)
    .from(leaveRequests)
    .innerJoin(users, eq(users.id, leaveRequests.userId))
    .leftJoin(
      memberships,
      and(eq(memberships.userId, leaveRequests.userId), eq(memberships.companyId, companyId)),
    )
    .leftJoin(branches, eq(branches.id, leaveRequests.branchId))
    .leftJoin(pemutus, eq(pemutus.id, leaveRequests.diputusOlehUserId))
    .where(and(eq(leaveRequests.id, id), eq(leaveRequests.companyId, companyId)));
  if (!row) throw new HTTPException(404, { message: "Pengajuan tidak ditemukan" });
  return toDto(row);
}

/**
 * Haruskah daftar ini dipersempit ke milik pemanggil sendiri?
 *
 * Dua sebab yang berbeda, dan keduanya harus ada:
 *
 * 1. Peran terkunci cabang (kasir/tim/kitchen/bar) tak pernah boleh melihat
 *    milik orang lain — pengajuan memuat alasan pribadi (mis. sakit, surat
 *    dokter), jadi tak dibagikan ke sesama karyawan seperti daftar absensi.
 * 2. `?saya=1` — PEMANGGILNYA yang meminta, berlaku untuk SEMUA peran termasuk
 *    owner/admin. Tanpa ini, satu-satunya daftar yang tersedia bagi mereka
 *    adalah daftar SEPERUSAHAAN, dan layar "Pengajuan saya" di halaman Absen
 *    memakainya apa adanya: pengajuan seluruh karyawan tampil sebagai milik
 *    sendiri, lengkap dengan tombol Batalkan yang memang dituruti server untuk
 *    manajemen. Owner yang membatalkan "pengajuannya" bisa membatalkan
 *    pengajuan orang lain tanpa satu pun petunjuk bahwa itu bukan miliknya.
 */
export function hanyaMilikSendiri(role: string | null, saya: string | undefined): boolean {
  return saya === "1" || terikatCabang(role);
}

export const pengajuanRoutes = new Hono<AppEnv>()
  /** Daftar pengajuan — lihat `hanyaMilikSendiri` untuk aturan cakupannya. */
  .get("/", async (c) => {
    const auth = c.get("auth");
    const syarat = [eq(leaveRequests.companyId, auth.company_id!)];

    if (hanyaMilikSendiri(auth.role, c.req.query("saya"))) {
      syarat.push(eq(leaveRequests.userId, auth.sub));
    } else {
      const branchId = await cabangDariQuery(c);
      if (branchId) syarat.push(eq(leaveRequests.branchId, branchId));
    }

    const status = c.req.query("status");
    if (status === "menunggu" || status === "disetujui" || status === "ditolak") {
      syarat.push(eq(leaveRequests.status, status));
    }
    // Rentang: ambil yang BERTINDIH, bukan yang termuat seluruhnya — cuti
    // 28 Jul–3 Agu harus muncul saat menyaring bulan Juli maupun Agustus.
    const dari = c.req.query("dari");
    const sampai = c.req.query("sampai");
    if (dari && tanggalValid(dari)) syarat.push(gte(leaveRequests.tanggalSelesai, dari));
    if (sampai && tanggalValid(sampai)) syarat.push(lte(leaveRequests.tanggalMulai, sampai));

    const rows = await db
      .select(kolomDto)
      .from(leaveRequests)
      .innerJoin(users, eq(users.id, leaveRequests.userId))
      .leftJoin(
        memberships,
        and(
          eq(memberships.userId, leaveRequests.userId),
          eq(memberships.companyId, auth.company_id!),
        ),
      )
      .leftJoin(branches, eq(branches.id, leaveRequests.branchId))
      .leftJoin(pemutus, eq(pemutus.id, leaveRequests.diputusOlehUserId))
      .where(and(...syarat))
      // Menunggu dulu (yang perlu tindakan), lalu terbaru.
      .orderBy(sql`${leaveRequests.status} = 'menunggu' desc`, desc(leaveRequests.createdAt));
    return c.json(rows.map(toDto));
  })

  /** Ajukan cuti/libur — semua peran, selalu atas nama diri sendiri. */
  .post("/", zValidator("json", BuatBody), async (c) => {
    const auth = c.get("auth");
    const b = c.req.valid("json");
    if (b.tanggal_selesai < b.tanggal_mulai) {
      throw new HTTPException(400, {
        message: "Tanggal selesai tidak boleh sebelum tanggal mulai",
      });
    }
    const hari = jumlahHari(b.tanggal_mulai, b.tanggal_selesai);
    if (hari > MAKS_HARI) {
      throw new HTTPException(400, {
        message: `Pengajuan maksimal ${MAKS_HARI} hari — pecah menjadi beberapa pengajuan`,
      });
    }

    // Cabang pemohon diambil dari keanggotaannya SAAT INI (bukan dari klien) —
    // dipakai owner/admin untuk menyaring pengajuan per cabang.
    const [m] = await db
      .select({ branchId: memberships.branchId })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, auth.sub),
          eq(memberships.companyId, auth.company_id!),
          isNull(memberships.archivedAt),
        ),
      );

    /*
     * Tolak yang bertindih dengan pengajuan sendiri yang masih hidup: dua baris
     * untuk hari yang sama membuat rekap ambigu (mana yang dipakai?).
     *
     * PERIKSA DAN TULIS DALAM SATU TRANSAKSI BERKUNCI, sebab larangan ini tak
     * bisa dititipkan ke indeks.
     *
     * Aturannya "rentang tanggal bertindih", bukan "kolom sama", jadi tak ada
     * indeks unik yang bisa menegakkannya — dan barisnya belum ada saat
     * diperiksa, jadi tak ada apa pun untuk dipegang `FOR UPDATE`. Yang
     * tersisa: mengunci atas nama ATURANNYA.
     *
     * Tanpa kunci ini dua permintaan bersamaan sama-sama membaca "belum ada"
     * lalu sama-sama menyisipkan. TERUKUR di sini juga: 24 permintaan serentak
     * dari satu kasir, lima ronde — dua di antaranya meninggalkan DUA baris
     * hidup yang bertindih. Bukan kasus teoretis; ketukan ganda di ponsel dan
     * kiriman ulang antrean offline persis sebentuk itu.
     *
     * Akibatnya di hilir bukan sekadar baris kembar. `absensi/routes.ts`
     * menyusun rekapnya dengan `petaIzin.set(`${userId}|${tanggal}`, …)` atas
     * kueri TANPA `ORDER BY`: dari dua baris yang bertindih, yang menang cuma
     * yang kebetulan terbaca belakangan. Satu tanggal bisa terbaca "Sakit"
     * hari ini dan "Cuti Tahunan" besok tanpa ada yang mengubah data — dan
     * bila `jenis`-nya berbeda (cuti vs libur), hitungan harinya ikut berubah.
     */
    const baru = await db.transaction(async (tx) => {
      await kunciAntrean(tx, "pengajuan", auth.company_id!, auth.sub);
      const [bentrok] = await tx
        .select({ id: leaveRequests.id, mulai: leaveRequests.tanggalMulai })
        .from(leaveRequests)
        .where(
          and(
            eq(leaveRequests.companyId, auth.company_id!),
            eq(leaveRequests.userId, auth.sub),
            inArray(leaveRequests.status, ["menunggu", "disetujui"]),
            lte(leaveRequests.tanggalMulai, b.tanggal_selesai),
            gte(leaveRequests.tanggalSelesai, b.tanggal_mulai),
          ),
        )
        .limit(1);
      if (bentrok) {
        // Dilempar DARI DALAM transaksi: penolakan membatalkan seluruhnya, jadi
        // tak ada baris separuh jadi, dan kuncinya lepas begitu rollback.
        throw new HTTPException(409, {
          message: "Sudah ada pengajuan Anda pada tanggal yang bertindih — batalkan dulu yang lama",
        });
      }
      const [row] = await tx
        .insert(leaveRequests)
        .values({
          companyId: auth.company_id!,
          userId: auth.sub,
          branchId: m?.branchId ?? null,
          jenis: jenisKategori(b.kategori),
          kategori: b.kategori,
          tanggalMulai: b.tanggal_mulai,
          tanggalSelesai: b.tanggal_selesai,
          alasan: b.alasan?.trim() || null,
          lampiranUrl: b.lampiran_url?.trim() || null,
        })
        .returning({ id: leaveRequests.id });
      return row;
    });
    return c.json(await ambilSatu(baru.id, auth.company_id!), 201);
  })

  /**
   * ACC / tolak — hanya owner & admin. Gerbang dipasang INLINE karena grup
   * `/pengajuan/*` sengaja terbuka untuk semua peran (semua boleh mengajukan).
   */
  .patch("/:id", requireRole("owner", "admin"), zValidator("json", PutusBody), async (c) => {
    const auth = c.get("auth");
    const id = c.req.param("id");
    const b = c.req.valid("json");

    const [ada] = await db
      .select({ status: leaveRequests.status })
      .from(leaveRequests)
      .where(and(eq(leaveRequests.id, id), eq(leaveRequests.companyId, auth.company_id!)));
    if (!ada) throw new HTTPException(404, { message: "Pengajuan tidak ditemukan" });
    if (ada.status !== "menunggu") {
      throw new HTTPException(409, {
        message: `Pengajuan sudah ${ada.status} — tidak bisa diputuskan lagi`,
      });
    }

    /*
     * PUTUSAN DIKLAIM LEWAT SYARAT STATUS, BUKAN LEWAT PEMERIKSAAN DI ATAS.
     *
     * Pemeriksaan `ada.status !== "menunggu"` hanya menangkap percobaan
     * BERURUTAN. Dua atasan yang memutus pengajuan yang SAMA di saat bersamaan
     * — owner menyetujui, admin menolak — sama-sama membaca `menunggu`, lalu
     * sama-sama menulis. Tanpa syarat di sini, penulis terakhir menang DIAM-
     * DIAM: keduanya dibalas 200, keduanya mengira putusannya berlaku, dan
     * `diputus_oleh` hanya merekam salah satunya tanpa petunjuk bahwa yang lain
     * pernah terjadi. Karyawannya bisa diberi tahu "disetujui" sementara
     * catatannya berbunyi "ditolak".
     *
     * Idiomnya sudah baku di basis kode ini — lihat persetujuan penyesuaian
     * opname: UPDATE bersyarat status + periksa barisnya + 409/404.
     */
    const diputus = await db
      .update(leaveRequests)
      .set({
        status: b.status,
        alasanTolak: b.status === "ditolak" ? (b.alasan_tolak?.trim() ?? null) : null,
        diputusOlehUserId: auth.sub,
        diputusPada: new Date(),
      })
      .where(
        and(
          eq(leaveRequests.id, id),
          eq(leaveRequests.companyId, auth.company_id!),
          eq(leaveRequests.status, "menunggu"),
        ),
      )
      .returning({ id: leaveRequests.id });
    if (diputus.length === 0) {
      throw new HTTPException(409, {
        message: "Pengajuan sudah diputuskan orang lain — muat ulang lalu periksa hasilnya",
      });
    }
    return c.json(await ambilSatu(id, auth.company_id!));
  })

  /**
   * Batalkan. Pemohon boleh membatalkan miliknya SELAMA masih menunggu;
   * owner/admin boleh menghapus kapan saja (mis. salah ACC).
   */
  .delete("/:id", async (c) => {
    const auth = c.get("auth");
    const id = c.req.param("id");
    const [ada] = await db
      .select({ userId: leaveRequests.userId, status: leaveRequests.status })
      .from(leaveRequests)
      .where(and(eq(leaveRequests.id, id), eq(leaveRequests.companyId, auth.company_id!)));
    if (!ada) throw new HTTPException(404, { message: "Pengajuan tidak ditemukan" });

    const manajemen = auth.role === "owner" || auth.role === "admin";
    if (!manajemen) {
      if (ada.userId !== auth.sub) {
        throw new HTTPException(403, { message: "Hanya bisa membatalkan pengajuan sendiri" });
      }
      if (ada.status !== "menunggu") {
        throw new HTTPException(409, {
          message: "Pengajuan yang sudah diputuskan tidak bisa dibatalkan — hubungi atasan",
        });
      }
    }
    /*
     * Pemohon hanya boleh membatalkan SELAMA masih `menunggu`, dan syarat itu
     * harus ikut di WHERE-nya — bukan cuma diperiksa di atas. Tanpa itu,
     * pembatalan yang datang tepat saat atasan menyetujui akan MENANG:
     * pengajuan yang sudah disetujui lenyap tanpa jejak, sementara atasannya
     * sudah dibalas 200.
     *
     * Manajemen tetap boleh menghapus kapan saja (mis. salah ACC), jadi
     * syaratnya sengaja hanya dipasang untuk pemohon.
     */
    const dihapus = await db
      .delete(leaveRequests)
      .where(
        and(
          eq(leaveRequests.id, id),
          eq(leaveRequests.companyId, auth.company_id!),
          ...(manajemen ? [] : [eq(leaveRequests.status, "menunggu")]),
        ),
      )
      .returning({ id: leaveRequests.id });
    if (dihapus.length === 0) {
      throw new HTTPException(409, {
        message: "Pengajuan yang sudah diputuskan tidak bisa dibatalkan — hubungi atasan",
      });
    }
    return c.json({ ok: true });
  });

/**
 * Pengajuan DISETUJUI yang bertindih rentang tanggal — dipakai modul absensi
 * untuk menyusun rekap. Ditaruh di sini agar aturan "hanya yang disetujui yang
 * berlaku" hidup di satu tempat.
 *
 * DISARING PER ORANG, BUKAN PER CABANG — dan itu disengaja.
 *
 * `leaveRequests.branchId` adalah POTRET cabang pemohon pada saat mengajukan;
 * ia tidak ikut berubah saat orangnya dipindah cabang (`PATCH /users/:id`).
 * Rekap absen menyusun daftar karyawannya dari `memberships.branchId` yang
 * BERJALAN. Menyaring cuti dengan cabang potret lalu memasangkannya ke daftar
 * cabang berjalan membuat cuti yang sudah di-ACC lenyap begitu orangnya pindah
 * — dan tanggal itu jatuh jadi ALPA, bukan sekadar kosong.
 *
 * Pemanggilnya sudah mempersempit daftar karyawan lebih dulu, jadi menyaring
 * dengan `userIds` menutup cacat itu tanpa melebarkan cakupan.
 */
export async function pengajuanDisetujuiPadaRentang(
  companyId: string,
  dari: string,
  sampai: string,
  userIds?: string[],
): Promise<
  { userId: string; jenis: "cuti" | "libur"; kategori: string; mulai: string; selesai: string }[]
> {
  if (userIds?.length === 0) return [];
  const syarat = [
    eq(leaveRequests.companyId, companyId),
    eq(leaveRequests.status, "disetujui"),
    lte(leaveRequests.tanggalMulai, sampai),
    gte(leaveRequests.tanggalSelesai, dari),
  ];
  if (userIds) syarat.push(inArray(leaveRequests.userId, userIds));
  const rows = await db
    .select({
      userId: leaveRequests.userId,
      jenis: leaveRequests.jenis,
      kategori: leaveRequests.kategori,
      mulai: leaveRequests.tanggalMulai,
      selesai: leaveRequests.tanggalSelesai,
    })
    .from(leaveRequests)
    .where(and(...syarat));
  return rows;
}

/** Daftar tanggal YYYY-MM-DD dari rentang inklusif. */
export function tanggalDalamRentang(mulai: string, selesai: string): string[] {
  const out: string[] = [];
  for (let t = mulai; t <= selesai; t = tambahHari(t, 1)) out.push(t);
  return out;
}

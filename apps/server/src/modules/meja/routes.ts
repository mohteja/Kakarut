import { zValidator } from "../../lib/validator";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { rapikanRuangan, ruanganUntukTitik } from "@kakarut/shared";
import type { MejaDto, MejaKosongLogRow, MejaStatusDto, RuanganDto } from "@kakarut/shared";
import { db } from "../../db/client";
import { meja, mejaKosongLogs, ruanganMeja, users } from "../../db/schema";
import { tanpaBentrok } from "../../lib/pg-galat";
import {
  branchUntukTulis,
  pastikanCabang,
  requireRole,
  resolveBranchId,
  terikatCabang,
  type AppEnv,
} from "../../middleware/auth";
import { hitungOkupansi, sedangTerisi } from "./okupansi";

const MejaBody = z.object({
  branch_id: z.string().uuid().optional(),
  nama: z.string().trim().min(1),
  tipe: z.enum(["dine_in", "takeaway"]).optional(),
  is_active: z.boolean().optional(),
}).strict();

/*
 * SENGAJA TIDAK `.strict()`, dan ini pengecualian BERTANGGAL.
 *
 * Ketujuh build ponsel yang pernah rilis (1.0.0+3 … +10) mengirim `branch_id`
 * di BADAN sini — termasuk build yang terpasang hari ini, karena
 * perbaikannya (`4e02a0b`, cabang dipindah ke query) belum tayang. Repo ini
 * tak punya gerbang versi klien, jadi `.strict()` di sini berarti setiap
 * ponsel lama menerima 400 saat menyimpan denah meja: fitur yang sekarang
 * jalan, mati pada saat deploy, tanpa peringatan bagi siapa pun.
 *
 * Diamnya sendiri sudah pernah menggigit — `branch_id` yang dibuang di sini
 * membuat `PUT /meja/tata-letak` membalas 200 berisi meja cabang LAIN. Yang
 * menutup lubang itu bukan skema ini melainkan pemanggilnya, dan penjaga
 * `cabang-ikut-di-url` yang menjaganya tetap begitu.
 *
 * SYARAT CABUT: sesudah build ber-`4e02a0b` tayang DAN build lama habis dari
 * lapangan. Pengecualian tanpa syarat cabut adalah pengecualian permanen yang
 * menyamar.
 */
const TataLetakBody = z.object({
  items: z
    .array(
      z.object({
        id: z.string().uuid(),
        pos_x: z.number().int().min(0).max(100),
        pos_y: z.number().int().min(0).max(100),
      }),
    )
    .max(500),
  /**
   * Kotak ruangan (2026-11-11) — opsional: klien lama yang hanya mengirim
   * meja tetap jalan. Keanggotaan meja di ruangan dihitung ulang tiap simpan.
   */
  ruangan: z
    .array(
      z.object({
        id: z.string().uuid(),
        pos_x: z.number().int().min(0).max(100),
        pos_y: z.number().int().min(0).max(100),
        lebar: z.number().int().min(1).max(100),
        tinggi: z.number().int().min(1).max(100),
      }),
    )
    .max(100)
    .optional(),
});

const RuanganBody = z.object({
  branch_id: z.string().uuid().optional(),
  nama: z.string().trim().min(1).max(40),
  pos_x: z.number().int().min(0).max(100).optional(),
  pos_y: z.number().int().min(0).max(100).optional(),
  lebar: z.number().int().min(1).max(100).optional(),
  tinggi: z.number().int().min(1).max(100).optional(),
}).strict();
const RuanganPatchBody = z.object({ nama: z.string().trim().min(1).max(40) }).strict();

function ruanganDto(row: typeof ruanganMeja.$inferSelect): RuanganDto {
  return {
    id: row.id,
    branch_id: row.branchId,
    nama: row.nama,
    pos_x: row.posX,
    pos_y: row.posY,
    lebar: row.lebar,
    tinggi: row.tinggi,
  };
}

/**
 * Hitung ulang ruangan tiap meja cabang dari posisinya — satu pernyataan.
 * Dipanggil sesudah tata letak (meja atau ruangan) berubah.
 */
async function selaraskanRuanganMeja(companyId: string, branchId: string): Promise<void> {
  const [ruangan, daftar] = await Promise.all([
    db
      .select()
      .from(ruanganMeja)
      .where(and(eq(ruanganMeja.companyId, companyId), eq(ruanganMeja.branchId, branchId))),
    db
      .select({ id: meja.id, x: meja.posX, y: meja.posY })
      .from(meja)
      .where(and(eq(meja.companyId, companyId), eq(meja.branchId, branchId))),
  ]);
  if (daftar.length === 0) return;
  const kotak = ruangan.map(ruanganDto);
  await db.execute(sql`
    UPDATE ${meja}
    SET ruangan_id = v.ruangan
    FROM (
      SELECT unnest(${sql.param(daftar.map((m) => m.id))}::uuid[]) AS id,
             unnest(${sql.param(daftar.map((m) => ruanganUntukTitik(m.x, m.y, kotak)))}::uuid[]) AS ruangan
    ) AS v
    WHERE ${meja.id} = v.id
      AND ${meja.companyId} = ${companyId}
      AND ${meja.branchId} = ${branchId}
  `);
}

function toDto(row: typeof meja.$inferSelect): MejaDto {
  return {
    id: row.id,
    branch_id: row.branchId,
    nama: row.nama,
    tipe: row.tipe,
    pos_x: row.posX,
    pos_y: row.posY,
    is_active: row.isActive,
    ruangan_id: row.ruanganId ?? null,
  };
}

/** Peran yang boleh MENGUBAH master meja (tambah/ubah/hapus/tata letak). */
const bolehAturMeja = requireRole("owner", "admin", "cashier");
/**
 * Peran yang boleh MENGOSONGKAN meja. Owner meminta "tim ataupun kasir";
 * kitchen & bar tetap boleh MELIHAT papan meja (mereka perlu tahu ruangan
 * seramai apa) tapi membereskan meja bukan pekerjaan mereka.
 */
const bolehKosongkanMeja = requireRole("owner", "admin", "cashier", "tim");

/**
 * Penjaga master data: meja yang masih ada tamunya tak boleh dihapus atau
 * dinonaktifkan. Memakai perhitungan okupansi yang SAMA dengan papan, supaya
 * layar dan penjaga mustahil berbeda pendapat soal arti "terisi".
 */
async function tolakBilaTerisi(
  mejaId: string,
  branchId: string,
  auth: { company_id: string | null },
) {
  const [okupansi] = await hitungOkupansi(db, {
    companyId: auth.company_id!,
    branchId,
    mejaId,
  });
  if (okupansi && sedangTerisi(okupansi)) {
    throw new HTTPException(409, {
      message: "Meja masih terisi — kosongkan dulu di papan meja",
    });
  }
}

/** Ringkas untuk kolom `detail` di jejak — dibaca manusia, bukan mesin. */
function ringkasPengosongan(bill: number, jual: number): string {
  const bagian: string[] = [];
  if (jual > 0) bagian.push(`${jual} transaksi lunas`);
  if (bill > 0) bagian.push(`${bill} bill belum dibayar`);
  return bagian.join(" · ") || "tanpa transaksi";
}

/**
 * Master meja per cabang + PAPAN STATUS meja (isi/kosong).
 *
 * Pembagian aksesnya sengaja ASIMETRIS, dan itulah alasan gerbangnya dipasang
 * per-rute di sini alih-alih satu gerbang prefix di `app.ts` (gerbang prefix
 * tak bisa membedakan metode):
 *
 * - **Membaca** (daftar meja, status, riwayat) terbuka untuk seluruh peran
 *   cabang — kitchen, bar, dan tim perlu tahu meja mana yang kosong.
 * - **Mengubah master** (tambah, ubah, hapus, tata letak denah) hanya
 *   owner/admin/kasir. Sebelum ini modul ini TIDAK punya gerbang peran sama
 *   sekali, jadi siapa pun yang punya membership bisa menghapus meja lewat API
 *   walau tombolnya tak ada di layarnya.
 * - **Mengosongkan meja** owner/admin/kasir/tim.
 *
 * Meja "Ruang Tunggu" (tipe takeaway) tidak boleh dihapus dan tidak punya
 * status okupansi — lihat `okupansi.ts`.
 */
export const mejaRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const auth = c.get("auth");
    const branchId = await resolveBranchId(c);
    const rows = await db
      .select()
      .from(meja)
      .where(
        and(eq(meja.companyId, auth.company_id!), eq(meja.branchId, branchId)),
      )
      // `id` sebagai pemutus seri — meja baru lazim menumpuk di pos (0,0)
      // dengan nama mirip, jadi seri di sini justru sering terjadi. Urutan yang
      // goyah membuat ETag daftar berubah walau datanya sama.
      .orderBy(asc(meja.posY), asc(meja.posX), asc(meja.nama), asc(meja.id));
    return c.json(rows.map(toDto));
  })
  /**
   * PAPAN MEJA — status okupansi cabang. Sengaja TERPISAH dari `GET /meja`:
   * daftar master itu di-cache klien lewat ETag, dan menempelkan status hidup
   * ke badannya membuat sidik jarinya berubah tiap ada transaksi. Hemat data
   * aplikasi mobile hilang, dan gejalanya menyamar jadi "jaringan lambat".
   */
  .get("/status", async (c) => {
    const auth = c.get("auth");
    const branchId = await resolveBranchId(c);
    const rows = await hitungOkupansi(db, {
      companyId: auth.company_id!,
      branchId,
    });
    return c.json(
      rows.map(
        (r): MejaStatusDto => ({
          meja_id: r.meja_id,
          nama: r.nama,
          status: sedangTerisi(r) ? "isi" : "kosong",
          bill_terbuka: r.bill_terbuka,
          transaksi_aktif: r.transaksi_aktif,
          lunas_masih_duduk: r.bill_terbuka === 0 && r.transaksi_aktif > 0,
          sejak: r.sejak ? r.sejak.toISOString() : null,
          dikosongkan_pada: r.dikosongkan_pada
            ? r.dikosongkan_pada.toISOString()
            : null,
          dikosongkan_oleh: r.dikosongkan_oleh,
          // Hanya bermakna saat mejanya masih terisi. Meja kosong sengaja
          // dikosongkan juga di sini supaya klien tak pernah menawarkan
          // "tamu yang sama" untuk meja yang sudah dibereskan.
          konsumen_nama: sedangTerisi(r) ? r.konsumen_nama : null,
          konsumen_wa: sedangTerisi(r) ? r.konsumen_wa : null,
        }),
      ),
    );
  })
  /**
   * Bereskan meja: tamu sudah pergi, meja siap ditempati orang berikutnya.
   *
   * Tidak ada satu pun peristiwa di data yang menandai "tamu pergi" — jadi
   * inilah satu-satunya hal yang benar-benar disimpan dari seluruh fitur ini,
   * lengkap dengan siapa dan kapan.
   *
   * Bila masih ada bill BELUM DIBAYAR di meja itu, permintaan pertama ditolak
   * 409 `bill_berjalan` supaya tak ada yang membereskan meja tanpa sadar ada
   * tagihan menggantung. Kirim ulang dengan `paksa: true` untuk tetap
   * membereskannya — bill-nya TIDAK dibatalkan dan tidak hilang dari daftar
   * kasir; yang berubah hanya: ia berhenti menahan mejanya.
   */
  .post(
    "/:id/kosongkan",
    bolehKosongkanMeja,
    zValidator("json", z.object({ paksa: z.boolean().optional() }).strict().optional()),
    async (c) => {
      const auth = c.get("auth");
      const branchId = await resolveBranchId(c);
      const id = c.req.param("id");
      const paksa = c.req.valid("json")?.paksa === true;

      const [row] = await db
        .select({ id: meja.id, tipe: meja.tipe, nama: meja.nama })
        .from(meja)
        .where(
          and(
            eq(meja.id, id),
            eq(meja.companyId, auth.company_id!),
            eq(meja.branchId, branchId),
          ),
        );
      if (!row)
        throw new HTTPException(404, { message: "Meja tidak ditemukan" });
      if (row.tipe === "takeaway") {
        throw new HTTPException(400, {
          message:
            "Ruang Tunggu dipakai bergantian sepanjang hari — tidak perlu dikosongkan",
        });
      }

      return await db.transaction(async (tx) => {
        // Status turunan tak punya baris untuk dikunci, jadi dipakai kunci
        // penasihat per meja — pola yang sama dengan `kunciKirimCabang` di
        // modul stok. Tanpa ini dua orang yang menekan bersamaan menulis dua
        // baris jejak untuk satu pembersihan yang sama.
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${`meja-kosong:${id}`}))`,
        );
        const [okupansi] = await hitungOkupansi(tx, {
          companyId: auth.company_id!,
          branchId,
          mejaId: id,
        });
        if (!okupansi || !sedangTerisi(okupansi)) {
          // Sudah kosong (mis. rekan menekan duluan) — bukan galat, dan JANGAN
          // menulis jejak kedua untuk pembersihan yang tak terjadi.
          return c.json({ ok: true, status: "kosong", sudah_kosong: true });
        }
        if (okupansi.bill_terbuka > 0 && !paksa) {
          // DIKEMBALIKAN, bukan di-throw: penangan galat global membentuk ulang
          // HTTPException jadi `{error}` saja, dan `kode` yang dibutuhkan klien
          // untuk memunculkan konfirmasi kedua akan hilang di situ.
          return c.json(
            {
              error: `Meja ini masih punya ${okupansi.bill_terbuka} pesanan yang belum dibayar`,
              kode: "bill_berjalan",
              bill_terbuka: okupansi.bill_terbuka,
            },
            409,
          );
        }
        await tx.insert(mejaKosongLogs).values({
          companyId: auth.company_id!,
          branchId,
          mejaId: id,
          aksi: paksa
            ? "Meja dikosongkan (masih ada bill belum dibayar)"
            : "Meja dikosongkan",
          paksa,
          detail: ringkasPengosongan(
            okupansi.bill_terbuka,
            okupansi.transaksi_aktif,
          ),
          userId: auth.sub,
          // WATERMARK, bukan `now()`: batasnya adalah transaksi TERBARU yang
          // benar-benar ikut terhitung barusan. Dengan `now()`, pesanan yang
          // masuk sepersekian detik sebelum tombol ditekan ikut tersapu diam-
          // diam dan meja jadi hijau padahal tamunya baru datang.
          //
          // Ditulis sebagai SQL dari teks aslinya, bukan lewat objek Date:
          // `timestamptz` berpresisi mikrodetik, `Date` hanya milidetik, dan
          // pembulatan itu membuat watermark SEDIKIT lebih tua dari transaksi
          // yang baru dibereskan — mejanya tak pernah benar-benar kosong.
          sampai: okupansi.batas_baru
            ? sql`${okupansi.batas_baru}::timestamptz`
            : sql`now()`,
        });
        return c.json({ ok: true, status: "kosong", sudah_kosong: false });
      });
    },
  )
  /** Riwayat "meja ini dibereskan siapa, kapan" — terbuka untuk semua peran cabang. */
  .get("/:id/log", async (c) => {
    const auth = c.get("auth");
    const branchId = await resolveBranchId(c);
    const [ada] = await db
      .select({ id: meja.id })
      .from(meja)
      .where(
        and(
          eq(meja.id, c.req.param("id")),
          eq(meja.companyId, auth.company_id!),
          eq(meja.branchId, branchId),
        ),
      );
    if (!ada) throw new HTTPException(404, { message: "Meja tidak ditemukan" });
    const rows = await db
      .select({
        waktu: mejaKosongLogs.waktu,
        aksi: mejaKosongLogs.aksi,
        paksa: mejaKosongLogs.paksa,
        detail: mejaKosongLogs.detail,
        oleh: users.nama,
      })
      .from(mejaKosongLogs)
      .leftJoin(users, eq(mejaKosongLogs.userId, users.id))
      .where(eq(mejaKosongLogs.mejaId, ada.id))
      .orderBy(desc(mejaKosongLogs.waktu), desc(mejaKosongLogs.id))
      .limit(50);
    return c.json(
      rows.map(
        (r): MejaKosongLogRow => ({
          waktu: r.waktu.toISOString(),
          aksi: r.aksi,
          oleh: r.oleh ?? null,
          paksa: r.paksa,
          detail: r.detail,
        }),
      ),
    );
  })
  /** RUANGAN denah cabang (2026-11-11) — dibaca semua peran yang melihat denah. */
  .get("/ruangan", async (c) => {
    const auth = c.get("auth");
    const branchId = await resolveBranchId(c);
    const rows = await db
      .select()
      .from(ruanganMeja)
      .where(and(eq(ruanganMeja.companyId, auth.company_id!), eq(ruanganMeja.branchId, branchId)))
      .orderBy(asc(ruanganMeja.posY), asc(ruanganMeja.posX), asc(ruanganMeja.nama), asc(ruanganMeja.id));
    return c.json(rows.map(ruanganDto));
  })
  .post("/ruangan", bolehAturMeja, zValidator("json", RuanganBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const branchId = await branchUntukTulis(c, body.branch_id, "Hanya boleh menambah ruangan di cabang sendiri");
    const kotak = rapikanRuangan({
      pos_x: body.pos_x ?? 5,
      pos_y: body.pos_y ?? 5,
      lebar: body.lebar ?? 40,
      tinggi: body.tinggi ?? 40,
    });
    const [row] = await db
      .insert(ruanganMeja)
      .values({
        companyId: auth.company_id!,
        branchId,
        nama: body.nama,
        posX: kotak.pos_x,
        posY: kotak.pos_y,
        lebar: kotak.lebar,
        tinggi: kotak.tinggi,
      })
      .onConflictDoNothing()
      .returning();
    if (!row) throw new HTTPException(409, { message: `Ruangan "${body.nama}" sudah ada di cabang ini` });
    await selaraskanRuanganMeja(auth.company_id!, branchId);
    return c.json(ruanganDto(row), 201);
  })
  .patch("/ruangan/:id", bolehAturMeja, zValidator("json", RuanganPatchBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const branchId = await resolveBranchId(c);
    const [row] = await tanpaBentrok(`Ruangan "${body.nama}" sudah ada di cabang ini`, () =>
      db
        .update(ruanganMeja)
        .set({ nama: body.nama })
        .where(
          and(
            eq(ruanganMeja.id, c.req.param("id")),
            eq(ruanganMeja.companyId, auth.company_id!),
            eq(ruanganMeja.branchId, branchId),
          ),
        )
        .returning(),
    );
    if (!row) throw new HTTPException(404, { message: "Ruangan tidak ditemukan" });
    return c.json(ruanganDto(row));
  })
  .delete("/ruangan/:id", bolehAturMeja, async (c) => {
    const auth = c.get("auth");
    const branchId = await resolveBranchId(c);
    // Mejanya TIDAK ikut terhapus — hanya keluar dari ruangan (FK set null).
    const [row] = await db
      .delete(ruanganMeja)
      .where(
        and(
          eq(ruanganMeja.id, c.req.param("id")),
          eq(ruanganMeja.companyId, auth.company_id!),
          eq(ruanganMeja.branchId, branchId),
        ),
      )
      .returning({ id: ruanganMeja.id });
    if (!row) throw new HTTPException(404, { message: "Ruangan tidak ditemukan" });
    return c.json({ ok: true });
  })
  .post("/", bolehAturMeja, zValidator("json", MejaBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const branchId = await branchUntukTulis(
      c,
      body.branch_id,
      "Hanya boleh menambah meja di cabang sendiri",
    );
    const [row] = await db
      .insert(meja)
      .values({
        companyId: auth.company_id!,
        branchId,
        nama: body.nama,
        tipe: body.tipe ?? "dine_in",
      })
      .onConflictDoNothing()
      .returning();
    if (!row) {
      throw new HTTPException(409, {
        message: `Meja "${body.nama}" sudah ada di cabang ini`,
      });
    }
    return c.json(toDto(row), 201);
  })
  // Simpan tata letak denah sekaligus (posisi persen 0..100). Kasir untuk cabangnya.
  .put(
    "/tata-letak",
    bolehAturMeja,
    zValidator("json", TataLetakBody),
    async (c) => {
      const auth = c.get("auth");
      const body = c.req.valid("json");
      const branchId = await resolveBranchId(c);
      /*
       * SATU pernyataan, bukan satu UPDATE per baris — bentuk yang sama dengan
       * `PUT /menu/urutan`, dan alasannya sama: loop di dalam transaksi menahan
       * satu dari sepuluh koneksi kolam selama N round-trip berurutan, dan N
       * ditentukan pengirim. Diukur pada 2.000 baris terhadap Postgres yang
       * sama: 289 ms berurutan vs 11 ms satu pernyataan.
       *
       * `sql.param(...)` WAJIB di sekeliling lariknya: tanpa itu drizzle
       * memecah larik JS jadi TUPLE `($1, $2, …)` dan Postgres membalas
       * "cannot cast type record to uuid[]".
       *
       * Transaksinya ikut dibuang — satu pernyataan sudah atomik sendiri.
       * Pengurungan perusahaan DAN cabang tetap di WHERE.
       */
      if (body.ruangan && body.ruangan.length > 0) {
        const kotak = body.ruangan.map(rapikanRuangan);
        await db.execute(sql`
          UPDATE ${ruanganMeja}
          SET pos_x = v.x, pos_y = v.y, lebar = v.l, tinggi = v.t
          FROM (
            SELECT unnest(${sql.param(kotak.map((k) => k.id))}::uuid[]) AS id,
                   unnest(${sql.param(kotak.map((k) => k.pos_x))}::int[]) AS x,
                   unnest(${sql.param(kotak.map((k) => k.pos_y))}::int[]) AS y,
                   unnest(${sql.param(kotak.map((k) => k.lebar))}::int[]) AS l,
                   unnest(${sql.param(kotak.map((k) => k.tinggi))}::int[]) AS t
          ) AS v
          WHERE ${ruanganMeja.id} = v.id
            AND ${ruanganMeja.companyId} = ${auth.company_id!}
            AND ${ruanganMeja.branchId} = ${branchId}
        `);
      }
      if (body.items.length > 0) {
        await db.execute(sql`
          UPDATE ${meja}
          SET pos_x = v.x, pos_y = v.y
          FROM (
            SELECT unnest(${sql.param(body.items.map((i) => i.id))}::uuid[]) AS id,
                   unnest(${sql.param(body.items.map((i) => i.pos_x))}::int[]) AS x,
                   unnest(${sql.param(body.items.map((i) => i.pos_y))}::int[]) AS y
          ) AS v
          WHERE ${meja.id} = v.id
            AND ${meja.companyId} = ${auth.company_id!}
            AND ${meja.branchId} = ${branchId}
        `);
      }
      // Meja masuk ruangan tempat ia diletakkan — dihitung server, bukan klien.
      await selaraskanRuanganMeja(auth.company_id!, branchId);
      const rows = await db
        .select()
        .from(meja)
        .where(
          and(
            eq(meja.companyId, auth.company_id!),
            eq(meja.branchId, branchId),
          ),
        )
        // `id` sebagai pemutus seri — meja baru lazim menumpuk di pos (0,0)
        // dengan nama mirip, jadi seri di sini justru sering terjadi. Urutan yang
        // goyah membuat ETag daftar berubah walau datanya sama.
        .orderBy(asc(meja.posY), asc(meja.posX), asc(meja.nama), asc(meja.id));
      return c.json(rows.map(toDto));
    },
  )
  .patch(
    "/:id",
    bolehAturMeja,
    zValidator("json", MejaBody.partial()),
    async (c) => {
      const auth = c.get("auth");
      const body = c.req.valid("json");
      const [existing] = await db
        .select()
        .from(meja)
        .where(
          and(
            eq(meja.id, c.req.param("id")),
            eq(meja.companyId, auth.company_id!),
          ),
        );
      if (!existing)
        throw new HTTPException(404, { message: "Meja tidak ditemukan" });
      if (terikatCabang(auth.role) && existing.branchId !== auth.branch_id) {
        throw new HTTPException(403, {
          message: "Hanya boleh mengubah meja di cabang sendiri",
        });
      }
      // Menonaktifkan meja yang masih ada tamunya membuat pilihan meja kasir
      // tercabut di tengah transaksi (halaman kasir melepas meja yang hilang dari
      // daftar aktif), dan bill yang sah jadi tak bisa ditagih.
      if (body.is_active === false)
        await tolakBilaTerisi(existing.id, existing.branchId, auth);
      const [row] = await tanpaBentrok(
        "Nama meja itu sudah dipakai di cabang ini",
        () =>
          db
            .update(meja)
            .set({
              ...(body.nama !== undefined && { nama: body.nama }),
              ...(body.is_active !== undefined && { isActive: body.is_active }),
            })
            .where(
              and(
                eq(meja.id, existing.id),
                eq(meja.companyId, auth.company_id!),
              ),
            )
            .returning(),
      );
      return c.json(toDto(row));
    },
  )
  .delete("/:id", bolehAturMeja, async (c) => {
    const auth = c.get("auth");
    const [existing] = await db
      .select()
      .from(meja)
      .where(
        and(
          eq(meja.id, c.req.param("id")),
          eq(meja.companyId, auth.company_id!),
        ),
      );
    if (!existing)
      throw new HTTPException(404, { message: "Meja tidak ditemukan" });
    if (terikatCabang(auth.role) && existing.branchId !== auth.branch_id) {
      throw new HTTPException(403, {
        message: "Hanya boleh menghapus meja di cabang sendiri",
      });
    }
    if (existing.tipe === "takeaway") {
      throw new HTTPException(400, {
        message: "Meja Ruang Tunggu tidak bisa dihapus",
      });
    }
    // `sales.meja_id` & `open_bills.meja_id` ber-onDelete "set null": menghapus
    // meja yang masih dipakai membuat tagihannya yatim — masih hidup, tapi tak
    // lagi menempati apa pun, jadi tak akan pernah muncul di papan meja mana pun.
    await tolakBilaTerisi(existing.id, existing.branchId, auth);
    await db
      .delete(meja)
      .where(
        and(eq(meja.id, existing.id), eq(meja.companyId, auth.company_id!)),
      );
    return c.json({ ok: true });
  });

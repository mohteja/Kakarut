import { zValidator } from "@hono/zod-validator";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { MejaDto, MejaKosongLogRow, MejaStatusDto } from "@kakarut/shared";
import { db } from "../../db/client";
import { meja, mejaKosongLogs, users } from "../../db/schema";
import { tanpaBentrok } from "../../lib/pg-galat";
import {
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
});

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
});

function toDto(row: typeof meja.$inferSelect): MejaDto {
  return {
    id: row.id,
    branch_id: row.branchId,
    nama: row.nama,
    tipe: row.tipe,
    pos_x: row.posX,
    pos_y: row.posY,
    is_active: row.isActive,
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
    zValidator("json", z.object({ paksa: z.boolean().optional() }).optional()),
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
      .orderBy(desc(mejaKosongLogs.waktu))
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
  .post("/", bolehAturMeja, zValidator("json", MejaBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const branchId = body.branch_id
      ? await pastikanCabang(body.branch_id, auth.company_id!)
      : await resolveBranchId(c);
    if (terikatCabang(auth.role) && branchId !== auth.branch_id) {
      throw new HTTPException(403, {
        message: "Hanya boleh menambah meja di cabang sendiri",
      });
    }
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
      await db.transaction(async (tx) => {
        for (const it of body.items) {
          await tx
            .update(meja)
            .set({ posX: it.pos_x, posY: it.pos_y })
            .where(
              and(
                eq(meja.id, it.id),
                eq(meja.companyId, auth.company_id!),
                eq(meja.branchId, branchId),
              ),
            );
        }
      });
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

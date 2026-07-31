import { zValidator } from "@hono/zod-validator";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { qtyTeks, type JenisPengadaan } from "@kakarut/shared";
import { db } from "../../db/client";
import {
  branches,
  dokumenNomor,
  ingredients,
  productions,
  storageLocations,
  suppliers,
} from "../../db/schema";
import { resolveBranchId, terikatCabang, type AppEnv } from "../../middleware/auth";
import { catatLogFaktur } from "../produksi/log";
import { autoFileRakCabang } from "../penyimpanan/autoFile";

/**
 * Kiriman yang TIBA di sebuah cabang untuk diterima: faktur BELI (pemasok →
 * cabang; baris bertujuan cabang lain yang MASIH transit di CK belum masuk —
 * baru muncul setelah dikirim lewat POST /kirim) atau work-order PRODUKSI
 * Central Kitchen yang sudah dikirim (baris pindah ke cabang tujuan →
 * `branch_id == tujuan_branch_id`). Produksi biasa (tanpa tujuan)
 * dikonfirmasi di tempat lewat /konfirmasi, bukan di sini.
 */
const KIRIMAN_MASUK = or(
  and(
    eq(productions.tipe, "beli"),
    or(
      isNull(productions.tujuanBranchId),
      eq(productions.tujuanBranchId, productions.branchId),
    ),
  ),
  and(
    eq(productions.tipe, "produksi"),
    eq(productions.tujuanBranchId, productions.branchId),
  ),
)!;

/**
 * KIRIMAN MENGGANTUNG — satu definisi, dipakai pendeteksi DAN penghapusnya.
 *
 * Sengaja satu tempat: kalau pendeteksi dan penghapus punya salinan predikat
 * masing-masing, suatu saat keduanya akan berbeda pendapat soal "mana yang
 * menggantung" — dan bedanya baru ketahuan setelah ada baris SEHAT yang
 * terhapus. Predikat penghapusan tak boleh lebih longgar dari yang ditampilkan.
 */
function cteMenggantung(companyId: string) {
  return sql`
    WITH g AS (
      SELECT pr.id, pr.faktur_id, pr.tipe, pr.status, pr.qty, pr.waktu,
             pr.branch_id, pr.tujuan_branch_id, pr.ingredient_id,
             COALESCE(
               ((pr.tipe = 'beli' AND (pr.tujuan_branch_id IS NULL OR pr.tujuan_branch_id = pr.branch_id))
                OR (pr.tipe = 'produksi' AND pr.tujuan_branch_id = pr.branch_id)),
               false
             ) AS lolos_gerbang,
             COALESCE(
               pr.dari_branch_id,
               (SELECT p2.dari_branch_id FROM productions p2
                 WHERE p2.faktur_id = pr.faktur_id AND p2.dari_branch_id IS NOT NULL LIMIT 1),
               (SELECT fl.branch_id FROM faktur_logs fl
                 WHERE fl.faktur_id = pr.faktur_id ORDER BY fl.waktu ASC LIMIT 1)
             ) AS asal_faktur
      FROM productions pr
      WHERE pr.company_id = ${companyId}
        AND pr.status IN ('menunggu', 'ditolak')
        AND pr.deleted_at IS NULL
    )
  `;
}

/** Predikat pendampingnya — dipakai di WHERE atas CTE `g` di atas. */
const MENGGANTUNG = sql`g.lolos_gerbang = false
        AND g.asal_faktur IS NOT NULL
        AND g.asal_faktur <> g.branch_id`;

const TolakBody = z.object({ alasan: z.string().trim().max(300).nullish() });

const TutupAnomaliBody = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  alasan: z.string().trim().max(300).nullish(),
});

const TerimaSebagianBody = z.object({
  /** qty yang benar-benar diterima per baris; 0 = baris itu ditolak */
  items: z
    .array(z.object({ id: z.string().uuid(), qty_diterima: z.number().nonnegative() }))
    .min(1),
  alasan: z.string().trim().max(300).nullish(),
});

/** Kondisi dasar satu faktur kiriman milik perusahaan; kasir terkunci cabangnya. */
function kondisiFaktur(c: Context<AppEnv>, fakturId: string) {
  const auth = c.get("auth");
  const conds = [
    eq(productions.companyId, auth.company_id!),
    eq(productions.fakturId, fakturId),
    KIRIMAN_MASUK,
    isNull(productions.deletedAt),
  ];
  if (terikatCabang(auth.role) && auth.branch_id) {
    conds.push(eq(productions.branchId, auth.branch_id));
  }
  return conds;
}

/**
 * Penerimaan barang di toko/cabang (jalur beli) — dapat diakses SEMUA peran,
 * termasuk kasir (terkunci ke cabangnya): kiriman berstatus 'menunggu'
 * (dikirim) bisa DITERIMA semua, DITERIMA SEBAGIAN (barang kurang), atau
 * DITOLAK; penolakan bisa DIBATALKAN (kasir salah cek) → faktur selesai
 * (dikonfirmasi, stok masuk).
 */
export const penerimaanRoutes = new Hono<AppEnv>()
  /** Daftar kiriman yang menunggu penerimaan + yang ditolak, per cabang. */
  .get("/", async (c) => {
    const auth = c.get("auth");
    // Kantor: owner/admin boleh "?branch_id=all" → semua cabang; kasir/tim terkunci.
    const semuaCabang = !terikatCabang(auth.role) && c.req.query("branch_id") === "all";
    const branchId = semuaCabang ? null : await resolveBranchId(c);
    const rows = await db
      .select({
        id: productions.id,
        ingredient_id: productions.ingredientId,
        bahan: ingredients.nama,
        isi: ingredients.isi,
        /** SATUAN TAMPILAN: `qty` di bawah SELALU dinyatakan dalam ini */
        satuan: ingredients.satuan,
        /** satuan kemasan — hanya bahan teks setara, JANGAN dipasang ke `qty` */
        satuan_beli: ingredients.satuanBeli,
        qty: productions.qty,
        total_harga: productions.totalHarga,
        /** ASAL-USUL input, BUKAN satuan — lihat catatan di qty_teks */
        is_batch: productions.isBatch,
        catatan: productions.catatan,
        waktu: productions.waktu,
        prod_date: productions.prodDate,
        faktur_id: productions.fakturId,
        no_faktur: productions.noFaktur,
        // nomor faktur asal (PB-/PR-) — "penerimaan dari faktur nomor berapa"
        nomor: dokumenNomor.nomorTeks,
        status: productions.status,
        // jalur kiriman (🛒 beli / 🏭 produksi CK) + cabang penerima (utk Kantor)
        jalur: productions.tipe,
        cabang: branches.nama,
        supplier: suppliers.nama,
        tempat: storageLocations.nama,
        qty_dipesan: productions.qtyDipesan,
        alasan_tolak: productions.alasanTolak,
      })
      .from(productions)
      .innerJoin(ingredients, eq(productions.ingredientId, ingredients.id))
      .leftJoin(suppliers, eq(productions.supplierId, suppliers.id))
      .leftJoin(storageLocations, eq(productions.storageLocationId, storageLocations.id))
      .leftJoin(branches, eq(productions.branchId, branches.id))
      .leftJoin(
        dokumenNomor,
        and(
          eq(dokumenNomor.companyId, productions.companyId),
          eq(dokumenNomor.refId, productions.fakturId),
        ),
      )
      .where(
        and(
          eq(productions.companyId, auth.company_id!),
          ...(branchId ? [eq(productions.branchId, branchId)] : []),
          KIRIMAN_MASUK,
          inArray(productions.status, ["menunggu", "ditolak"]),
          isNull(productions.deletedAt),
        ),
      )
      .orderBy(asc(productions.waktu), asc(productions.id));
    // Teks kuantitas ditulis SERVER supaya web & mobile mustahil berbeda
    // satuan — menebak sendiri sudah pernah melahirkan "900 kg" untuk barang
    // yang sebenarnya 900 gr, dan "batch" untuk barang bersatuan gr.
    const rowsTeks = rows.map((r) => {
      const t = qtyTeks({ qty: r.qty, satuan: r.satuan, isi: r.isi, satuanBeli: r.satuan_beli });
      const d =
        r.qty_dipesan == null
          ? null
          : qtyTeks({
              qty: r.qty_dipesan,
              satuan: r.satuan,
              isi: r.isi,
              satuanBeli: r.satuan_beli,
            });
      return { ...r, qty_teks: t.teks, qty_setara: t.setara, qty_dipesan_teks: d?.teks ?? null };
    });
    return c.json({ rows: rowsTeks });
  })
  /**
   * PENDETEKSI KIRIMAN MENGGANTUNG — nilai benarnya NOL.
   *
   * Sebuah baris yang SUDAH BERPINDAH CABANG tapi TIDAK lolos `KIRIMAN_MASUK`
   * adalah barang yang dikirim ke cabang tapi tak bisa diterima siapa pun:
   * tak ada tombol Terima, stok tak pernah bertambah, dan tak ada satu pun
   * layar yang menampilkannya. Barang hilang dari pembukuan tanpa galat.
   *
   * Yang PALING sulit di sini adalah membedakan dua keadaan yang bentuk
   * datanya mirip:
   *
   *   (a) BELUM dikirim — masih di CK menunggu tombol Kirim. SAH, jangan
   *       diusik; memunculkannya di Penerimaan membuat cabang bisa "menerima"
   *       barang yang masih di rak CK.
   *   (b) SUDAH dikirim tapi menggantung — INI korbannya.
   *
   * Pembedanya: DI MANA FAKTUR ITU LAHIR. Diambil berjenjang karena tak satu
   * pun sumber lengkap sendirian:
   *   1. `dari_branch_id` baris itu (diisi saat pindah — paling andal),
   *   2. `dari_branch_id` baris saudara sefaktur (baris hasil "maju sebagian"
   *      dulu tak kebagian kolom ini),
   *   3. entri `faktur_logs` paling awal (ditulis saat faktur dibuat).
   *
   * Baris berstatus selesai (`dikonfirmasi`) sengaja di luar cakupan: stoknya
   * sudah masuk, jadi tak ada yang hilang.
   */
  .get("/anomali", async (c) => {
    const auth = c.get("auth");
    /**
     * Peran terkunci cabang (kasir, tim, kitchen, bar) hanya melihat barang
     * yang MENDARAT DI CABANGNYA — aturan yang sama dengan daftar Penerimaan
     * di atas. Mereka justru orang yang paling berguna melihatnya: kardusnya
     * ada di rak mereka, tinggal dicari. Owner/admin melihat semuanya.
     */
    const kunciCabang =
      terikatCabang(auth.role) && auth.branch_id
        ? sql`AND g.branch_id = ${auth.branch_id}`
        : sql``;
    const rows = await db.execute(sql`
      ${cteMenggantung(auth.company_id!)}
      SELECT g.id, g.faktur_id, g.tipe, g.status, g.qty, g.waktu,
             i.nama AS bahan, i.satuan,
             bp.nama AS posisi_sekarang,
             ba.nama AS dikirim_dari,
             EXTRACT(DAY FROM now() - g.waktu)::int AS umur_hari
      FROM g
      JOIN ingredients i ON i.id = g.ingredient_id
      LEFT JOIN branches bp ON bp.id = g.branch_id
      LEFT JOIN branches ba ON ba.id = g.asal_faktur
      WHERE ${MENGGANTUNG}
        ${kunciCabang}
      ORDER BY g.waktu ASC
    `);
    const daftar = rows.rows as Record<string, unknown>[];
    return c.json({
      jumlah: daftar.length,
      qty_total: daftar.reduce((t, r) => t + Number(r.qty ?? 0), 0),
      rows: daftar,
    });
  })
  /**
   * TUTUP kiriman menggantung — hapuskan (soft-delete → Tempat Sampah).
   *
   * Untuk barang yang TERLANJUR menggantung sebelum perbaikan "alamat ikut
   * barang". Kalau cabang SUDAH mengompensasi manual (Stok Awal / opname /
   * faktur manual), barangnya sudah ada di pembukuan — MENERIMA kirimannya
   * sekarang justru menghitungnya DUA KALI, karena penerimaan menyetel
   * `waktu = now()` yang jatuh SESUDAH garis Stok Awal, sehingga qty-nya
   * ditumpuk di atas saldo pembuka. Jadi jalan yang benar bukan diterima,
   * melainkan dihapuskan.
   *
   * PENGAMANNYA — dan ini inti berkas ini: daftar id yang dikirim klien TIDAK
   * dipercaya. Predikat menggantung dihitung ULANG di server dengan CTE yang
   * SAMA PERSIS dengan pendeteksi di atas, lalu id yang dikirim hanya dipakai
   * sebagai IRISAN. Baris yang sehat MUSTAHIL terhapus lewat sini walau
   * id-nya diketik manual — dan karena kedua endpoint memakai satu sumber
   * predikat, keduanya tak bisa berbeda pendapat soal "mana yang menggantung".
   *
   * Soft-delete, jadi bisa dipulihkan dari Tempat Sampah bila ternyata salah.
   */
  .post("/anomali/tutup", zValidator("json", TutupAnomaliBody), async (c) => {
    const auth = c.get("auth");
    // Penghapusan pembukuan = keputusan manajemen. Modul ini tanpa group guard
    // ([any] — kasir pun boleh menerima barang), jadi gerbangnya di sini.
    if (auth.role !== "owner" && auth.role !== "admin") {
      throw new HTTPException(403, {
        message: "Hanya owner/admin yang boleh menghapuskan kiriman menggantung",
      });
    }
    const body = c.req.valid("json");
    const ids = [...new Set(body.ids)];
    const now = new Date();
    const hasil = await db.transaction(async (tx) => {
      const target = await tx.execute(sql`
        ${cteMenggantung(auth.company_id!)}
        SELECT g.id, g.faktur_id, g.tipe, g.branch_id, g.qty
        FROM g
        WHERE ${MENGGANTUNG}
          AND g.id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
      `);
      const baris = target.rows as {
        id: string;
        faktur_id: string;
        tipe: string;
        branch_id: string;
        qty: string | number;
      }[];
      if (baris.length === 0) return { baris: [] as typeof baris };
      await tx
        .update(productions)
        .set({ deletedAt: now, deletedBy: auth.sub })
        .where(
          and(
            eq(productions.companyId, auth.company_id!),
            isNull(productions.deletedAt),
            inArray(
              productions.id,
              baris.map((b) => b.id),
            ),
          ),
        );
      return { baris };
    });
    // Satu entri log per faktur — jejak siapa menghapuskan apa, dan alasannya.
    const perFaktur = new Map<string, typeof hasil.baris>();
    for (const b of hasil.baris) {
      const kump = perFaktur.get(b.faktur_id) ?? [];
      kump.push(b);
      perFaktur.set(b.faktur_id, kump);
    }
    for (const [fakturId, kump] of perFaktur) {
      await catatLogFaktur(db, {
        companyId: auth.company_id!,
        branchId: kump[0].branch_id,
        fakturId,
        jalur: kump[0].tipe as JenisPengadaan,
        aksi: "Kiriman menggantung dihapuskan (tidak pernah sampai)",
        detail:
          `${kump.length} baris` +
          (body.alasan ? ` — ${body.alasan}` : " — sudah dikompensasi manual"),
        userId: auth.sub,
      });
    }
    return c.json({
      ditutup: hasil.baris.length,
      // id yang TIDAK menggantung (atau sudah terhapus) sengaja dilewati, bukan
      // digagalkan: kalau satu id basi membatalkan seluruh permintaan, orang
      // akan mencoba lagi dengan daftar yang sama dan macet selamanya.
      dilewati: ids.length - hasil.baris.length,
    });
  })
  /** Terima SEMUA barang kiriman → masuk stok. */
  .post("/:fakturId/terima", async (c) => {
    const auth = c.get("auth");
    // waktu = saat diterima (bukan saat RAB dibuat) agar stok masuk terhitung
    // relatif ke opname terakhir, bukan tanggal faktur dibuat.
    const now = new Date();
    const rows = await db
      .update(productions)
      .set({ status: "dikonfirmasi", confirmedBy: auth.sub, confirmedAt: now, waktu: now })
      .where(
        and(...kondisiFaktur(c, c.req.param("fakturId")), eq(productions.status, "menunggu")),
      )
      .returning({
        id: productions.id,
        branchId: productions.branchId,
        tipe: productions.tipe,
      });
    if (rows.length === 0) {
      throw new HTTPException(404, { message: "Kiriman tidak ditemukan atau bukan status dikirim" });
    }
    // barang tiba di cabang → otomatis diletakkan di rak default bahannya
    await autoFileRakCabang(auth.company_id!, rows.map((r) => r.id));
    await catatLogFaktur(db, {
      companyId: auth.company_id!,
      branchId: rows[0].branchId,
      fakturId: c.req.param("fakturId"),
      jalur: rows[0].tipe as JenisPengadaan,
      aksi: "Diterima semua (toko) — stok masuk",
      detail: `${rows.length} baris`,
      userId: auth.sub,
    });
    return c.json({ ok: true, jumlah_baris: rows.length });
  })
  /**
   * Terima SEBAGIAN: kasir mengisi qty yang benar-benar diterima per baris
   * (0 = baris ditolak). qty pesanan awal disimpan di qty_dipesan dan harga
   * diproratakan agar pengeluaran sesuai barang yang diterima.
   */
  .post("/:fakturId/terima-sebagian", zValidator("json", TerimaSebagianBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const fakturId = c.req.param("fakturId");

    const baris = await db
      .select({
        id: productions.id,
        qty: productions.qty,
        totalHarga: productions.totalHarga,
        branchId: productions.branchId,
        tipe: productions.tipe,
      })
      .from(productions)
      .where(and(...kondisiFaktur(c, fakturId), eq(productions.status, "menunggu")));
    if (baris.length === 0) {
      throw new HTTPException(404, { message: "Kiriman tidak ditemukan atau bukan status dikirim" });
    }
    const terimaById = new Map(body.items.map((i) => [i.id, i.qty_diterima]));
    const belum = baris.filter((b) => !terimaById.has(b.id));
    if (belum.length > 0) {
      throw new HTTPException(400, {
        message: "Semua baris kiriman harus diisi qty diterimanya (0 bila tidak diterima)",
      });
    }
    // Qty diterima tak boleh melebihi qty yang dikirim — barang tidak mungkin
    // datang lebih dari yang dikirim; tanpa batas ini stok & pengeluaran bisa
    // digelembungkan sewenang-wenang.
    const kelebihan = baris.find((b) => terimaById.get(b.id)! > b.qty);
    if (kelebihan) {
      throw new HTTPException(400, {
        message: "Qty diterima tidak boleh melebihi qty yang dikirim",
      });
    }

    // waktu = saat diterima (bukan saat RAB), lihat catatan di endpoint /terima.
    const now = new Date();
    await db.transaction(async (tx) => {
      for (const b of baris) {
        const diterima = terimaById.get(b.id)!;
        // WHERE tetap menuntut status 'menunggu' + belum dihapus: bila baris
        // berubah oleh proses lain sejak dibaca, update 0 baris → rollback.
        const res =
          diterima > 0
            ? await tx
                .update(productions)
                .set({
                  qtyDipesan: b.qty,
                  qty: diterima,
                  // prorata harga sesuai porsi yang diterima
                  totalHarga:
                    b.totalHarga != null ? Math.round((b.totalHarga * diterima) / b.qty) : null,
                  status: "dikonfirmasi",
                  confirmedBy: auth.sub,
                  confirmedAt: now,
                  waktu: now,
                })
                .where(
                  and(
                    eq(productions.id, b.id),
                    eq(productions.status, "menunggu"),
                    isNull(productions.deletedAt),
                  ),
                )
                .returning({ id: productions.id })
            : await tx
                .update(productions)
                .set({
                  status: "ditolak",
                  alasanTolak: body.alasan ?? "Barang tidak diterima",
                  updatedBy: auth.sub,
                  updatedAt: now,
                })
                .where(
                  and(
                    eq(productions.id, b.id),
                    eq(productions.status, "menunggu"),
                    isNull(productions.deletedAt),
                  ),
                )
                .returning({ id: productions.id });
        if (res.length === 0) {
          throw new HTTPException(409, {
            message: "Status kiriman berubah — muat ulang halaman penerimaan lalu coba lagi",
          });
        }
      }
      const diterima = baris.filter((b) => terimaById.get(b.id)! > 0).length;
      await catatLogFaktur(tx, {
        companyId: auth.company_id!,
        branchId: baris[0].branchId,
        fakturId,
        jalur: baris[0].tipe as JenisPengadaan,
        aksi: "Diterima sebagian (toko)",
        detail:
          `${diterima} baris diterima, ${baris.length - diterima} ditolak` +
          (body.alasan ? ` · ${body.alasan}` : ""),
        userId: auth.sub,
      });
    });
    // baris yang diterima → auto-file ke rak default bahannya di cabang
    await autoFileRakCabang(
      auth.company_id!,
      baris.filter((b) => terimaById.get(b.id)! > 0).map((b) => b.id),
    );
    return c.json({ ok: true, jumlah_baris: baris.length });
  })
  /** Tolak seluruh kiriman (barang kurang/salah). */
  .post("/:fakturId/tolak", zValidator("json", TolakBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const rows = await db
      .update(productions)
      .set({
        status: "ditolak",
        alasanTolak: body.alasan ?? null,
        updatedBy: auth.sub,
        updatedAt: new Date(),
      })
      .where(
        and(...kondisiFaktur(c, c.req.param("fakturId")), eq(productions.status, "menunggu")),
      )
      .returning({
        id: productions.id,
        branchId: productions.branchId,
        tipe: productions.tipe,
      });
    if (rows.length === 0) {
      throw new HTTPException(404, { message: "Kiriman tidak ditemukan atau bukan status dikirim" });
    }
    await catatLogFaktur(db, {
      companyId: auth.company_id!,
      branchId: rows[0].branchId,
      fakturId: c.req.param("fakturId"),
      jalur: rows[0].tipe as JenisPengadaan,
      aksi: "Kiriman ditolak",
      detail: body.alasan ?? null,
      userId: auth.sub,
    });
    return c.json({ ok: true, jumlah_baris: rows.length });
  })
  /**
   * Batalkan penolakan (kasir salah cek SATU faktur penuh): baris yang ditolak
   * dianggap diterima → faktur selesai (dikonfirmasi, stok masuk).
   */
  .post("/:fakturId/batal-tolak", async (c) => {
    const auth = c.get("auth");
    const fakturId = c.req.param("fakturId");
    // Bila faktur sudah diterima SEBAGIAN (ada baris dikonfirmasi), baris yang
    // ditolak tadi memang sengaja tak diterima (qty 0) — membatalkannya akan
    // memasukkan qty & harga PENUH yang salah. Batal-tolak hanya untuk
    // penolakan satu faktur penuh (semua baris ditolak).
    const [adaDiterima] = await db
      .select({ id: productions.id })
      .from(productions)
      .where(and(...kondisiFaktur(c, fakturId), eq(productions.status, "dikonfirmasi")))
      .limit(1);
    if (adaDiterima) {
      throw new HTTPException(400, {
        message:
          "Faktur ini sudah diterima sebagian — baris yang ditolak tidak bisa dibatalkan (barang memang tidak diterima)",
      });
    }
    const now = new Date();
    const rows = await db
      .update(productions)
      .set({
        status: "dikonfirmasi",
        alasanTolak: null,
        confirmedBy: auth.sub,
        confirmedAt: now,
        waktu: now,
      })
      .where(and(...kondisiFaktur(c, fakturId), eq(productions.status, "ditolak")))
      .returning({
        id: productions.id,
        branchId: productions.branchId,
        tipe: productions.tipe,
      });
    if (rows.length === 0) {
      throw new HTTPException(404, { message: "Tidak ada baris ditolak pada kiriman ini" });
    }
    await catatLogFaktur(db, {
      companyId: auth.company_id!,
      branchId: rows[0].branchId,
      fakturId,
      jalur: rows[0].tipe as JenisPengadaan,
      aksi: "Penolakan dibatalkan — stok masuk",
      detail: `${rows.length} baris`,
      userId: auth.sub,
    });
    return c.json({ ok: true, jumlah_baris: rows.length });
  });

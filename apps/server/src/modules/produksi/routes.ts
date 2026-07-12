import { randomUUID } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { JenisPengadaan } from "@kakarut/shared";
import { db } from "../../db/client";
import {
  companies,
  fakturDana,
  ingredients,
  memberships,
  productions,
  storageLocations,
  suppliers,
  users,
} from "../../db/schema";
import {
  pastikanCabang,
  resolveBranchId,
  verifikasiPassword,
  type AppEnv,
} from "../../middleware/auth";
import { tanggalDi } from "../../lib/time";

const pembuat = alias(users, "pembuat_prod");
const pengubah = alias(users, "pengubah_prod");
const pekerja = alias(users, "pekerja_prod");

const FakturEditBody = z.object({
  password: z.string(),
  supplier_id: z.string().uuid().nullish(),
  no_faktur: z.string().trim().max(60).nullish(),
  catatan: z.string().nullish(),
  storage_location_id: z.string().uuid().nullish(),
  /** ganti pelaksana karyawan (khusus jalur produksi); null = kosongkan */
  worker_id: z.string().uuid().nullish(),
  prod_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
const HapusBody = z.object({ password: z.string() });

const TahapBody = z.object({
  ke: z.enum(["dikerjakan", "menunggu", "dikonfirmasi"]),
  /**
   * Maju SEBAGIAN: hanya baris terpilih yang naik tahap; qty < qty baris →
   * baris di-split (sisa tetap di tahap lama sebagai tugas). Tanpa items =
   * perilaku lama (seluruh faktur, wajib berurutan satu langkah).
   */
  items: z
    .array(z.object({ id: z.string().uuid(), qty: z.number().positive() }))
    .min(1)
    .optional(),
  /**
   * Dana yang benar-benar cair saat faktur meninggalkan tahap RAB — penuh
   * sesuai RAB atau sebagian. Dicatat sebagai entri faktur_dana (akumulatif).
   */
  dana_cair: z.number().nonnegative().max(1_000_000_000_000).nullish(),
});
/** transisi tahap produksi wajib berurutan: rencana → dikerjakan → menunggu (lalu /konfirmasi) */
const TAHAP_SEBELUM = { dikerjakan: "rencana", menunggu: "dikerjakan" } as const;
/** urutan pipeline untuk aturan "hanya boleh maju" pada tahap sebagian */
const URUTAN_TAHAP = { rencana: 0, dikerjakan: 1, menunggu: 2, dikonfirmasi: 3 } as const;

/** Terima hanya tanggal format YYYY-MM-DD; selain itu undefined. */
const tglValid = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);

/** Cocokkan satu faktur: baris ber-fakturId, atau baris lama (fakturId null) via id. */
function cocokFaktur(key: string) {
  return or(
    eq(productions.fakturId, key),
    and(isNull(productions.fakturId), eq(productions.id, key)),
  );
}

const TambahStokBody = z
  .object({
    branch_id: z.string().uuid().optional(),
    ingredient_id: z.string().uuid(),
    qty: z.number().positive().optional(),
    /** true = 1 batch/1 pembelian → qty otomatis = isi bahan saat ini */
    batch: z.boolean().default(false),
    /** khusus jalur beli: total harga pembelian (catatan pengeluaran) */
    total_harga: z.number().nonnegative().nullish(),
    catatan: z.string().nullish(),
  })
  .refine((v) => v.batch || v.qty != null, {
    message: "Isi qty, atau set batch=true",
  });

const FakturBody = z.object({
  branch_id: z.string().uuid().optional(),
  supplier_id: z.string().uuid().nullish(),
  no_faktur: z.string().trim().max(60).nullish(),
  catatan: z.string().nullish(),
  /** karyawan pelaksana — WAJIB untuk jalur produksi, diabaikan untuk beli */
  worker_id: z.string().uuid().nullish(),
  items: z
    .array(
      z.object({
        ingredient_id: z.string().uuid(),
        /** jumlah dalam pcs, atau dalam batch (dikali isi bahan) */
        mode: z.enum(["pcs", "batch"]),
        jumlah: z.number().positive(),
        storage_location_id: z.string().uuid().nullish(),
        total_harga: z.number().nonnegative().nullish(),
      }),
    )
    .min(1),
});

const LABEL: Record<JenisPengadaan, { jalur: string }> = {
  produksi: { jalur: "Produksi Bahan Baku" },
  beli: { jalur: "Beli Bahan Baku" },
};

async function resolveBranchUntukTulis(
  c: Context<AppEnv>,
  bodyBranchId: string | undefined,
) {
  const auth = c.get("auth");
  const branchId = bodyBranchId
    ? await pastikanCabang(bodyBranchId, auth.company_id!)
    : await resolveBranchId(c);
  if (auth.role === "cashier" && branchId !== auth.branch_id) {
    throw new HTTPException(403, { message: "Kasir hanya boleh input di cabangnya" });
  }
  return branchId;
}

/** Bahan harus milik perusahaan DAN jenis pengadaannya sesuai jalur. */
function pastikanJalur(
  ing: typeof ingredients.$inferSelect | undefined,
  tipe: JenisPengadaan,
  id: string,
) {
  if (!ing) throw new HTTPException(404, { message: `Bahan tidak ditemukan (${id})` });
  if (!ing.trackStok) {
    throw new HTTPException(400, {
      message: `Stok "${ing.nama}" tidak dilacak — centang "Lacak stok" di halaman Bahan Baku dulu`,
    });
  }
  if (ing.pengadaan !== tipe) {
    throw new HTTPException(400, {
      message: `"${ing.nama}" berjenis ${ing.pengadaan === "beli" ? "beli jadi" : "produksi sendiri"} — tambah stok lewat menu ${LABEL[ing.pengadaan].jalur}`,
    });
  }
  return ing;
}

/**
 * Estimasi biaya proporsional dari harga per batch bahan:
 * jalur beli = harga default pembelian; jalur produksi = RAB (perkiraan biaya).
 */
function hargaDefault(qty: number, ing: { isi: number; hargaBeli: number }) {
  return Math.round((qty / ing.isi) * ing.hargaBeli);
}

/** Pastikan user adalah anggota (karyawan) perusahaan — untuk penugasan produksi. */
async function pastikanKaryawan(userId: string, companyId: string) {
  const [m] = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.companyId, companyId)));
  if (!m) throw new HTTPException(400, { message: "Karyawan bukan anggota perusahaan" });
}

/**
 * Dua jalur penambahan stok dengan aturan yang sama, dibedakan `tipe`:
 * - /produksi  → hanya bahan berjenis pengadaan "produksi" (dibuat sendiri)
 * - /pembelian → hanya bahan berjenis pengadaan "beli" (dibeli jadi)
 *
 * Alur utama: POST /faktur (multi-item, status "menunggu") →
 * POST /konfirmasi/:fakturId ("ya, ada" — stok baru terhitung setelah ini).
 * POST / lama (satu item, langsung dikonfirmasi) dipertahankan untuk
 * kompatibilitas.
 */
function buatRuteTambahStok(tipe: JenisPengadaan) {
  return new Hono<AppEnv>()
    .post("/faktur", zValidator("json", FakturBody), async (c) => {
      const auth = c.get("auth");
      const body = c.req.valid("json");
      const branchId = await resolveBranchUntukTulis(c, body.branch_id);

      // Muat & validasi semua referensi milik perusahaan/cabang
      const ingIds = [...new Set(body.items.map((i) => i.ingredient_id))];
      const ingRows = await db
        .select()
        .from(ingredients)
        .where(
          and(eq(ingredients.companyId, auth.company_id!), inArray(ingredients.id, ingIds)),
        );
      const ingById = new Map(ingRows.map((r) => [r.id, r]));

      if (body.supplier_id) {
        const [s] = await db
          .select({ id: suppliers.id })
          .from(suppliers)
          .where(
            and(eq(suppliers.id, body.supplier_id), eq(suppliers.companyId, auth.company_id!)),
          );
        if (!s) throw new HTTPException(400, { message: "Supplier tidak valid" });
      }
      // Jalur produksi: pelaksana wajib — salah satu antara karyawan atau
      // supplier (yang mengerjakan pasti salah satunya). Supplier sudah
      // divalidasi milik perusahaan di atas.
      let workerId: string | null = null;
      if (tipe === "produksi") {
        if (!body.worker_id && !body.supplier_id) {
          throw new HTTPException(400, {
            message: "Pelaksana (karyawan/supplier) wajib dipilih untuk faktur produksi",
          });
        }
        if (body.worker_id) {
          await pastikanKaryawan(body.worker_id, auth.company_id!);
          workerId = body.worker_id;
        }
      }
      const lokasiIds = [
        ...new Set(body.items.map((i) => i.storage_location_id).filter(Boolean) as string[]),
      ];
      if (lokasiIds.length > 0) {
        const lokasi = await db
          .select({ id: storageLocations.id })
          .from(storageLocations)
          .where(
            and(
              eq(storageLocations.branchId, branchId),
              inArray(storageLocations.id, lokasiIds),
            ),
          );
        if (lokasi.length !== lokasiIds.length) {
          throw new HTTPException(400, {
            message: "Ada tempat penyimpanan yang tidak valid untuk cabang ini",
          });
        }
      }

      const [company] = await db
        .select({ timezone: companies.timezone })
        .from(companies)
        .where(eq(companies.id, auth.company_id!));
      const prodDate = tanggalDi(company?.timezone ?? "Asia/Jakarta");
      const fakturId = randomUUID();

      // Kedua jalur mulai dari tahap "rencana" (RAB):
      // produksi → dikerjakan → selesai (menunggu konfirmasi) → masuk stok;
      // beli → diproses → dikirim (menunggu penerimaan toko) → diterima.
      const statusAwal = "rencana" as const;
      const rows = body.items.map((item) => {
        const ing = pastikanJalur(ingById.get(item.ingredient_id), tipe, item.ingredient_id);
        const qty = item.mode === "batch" ? item.jumlah * ing.isi : item.jumlah;
        return {
          companyId: auth.company_id!,
          branchId,
          ingredientId: ing.id,
          qty,
          tipe,
          // beli: harga input/estimasi; produksi: RAB otomatis dari harga bahan
          totalHarga:
            tipe === "beli"
              ? (item.total_harga ?? hargaDefault(qty, ing))
              : hargaDefault(qty, ing),
          fakturId,
          noFaktur: body.no_faktur ?? null,
          supplierId: body.supplier_id ?? null,
          storageLocationId: item.storage_location_id ?? null,
          status: statusAwal,
          isBatch: item.mode === "batch",
          catatan: body.catatan ?? null,
          userId: auth.sub,
          workerId,
          prodDate,
        };
      });

      const inserted = await db.transaction(async (tx) =>
        tx.insert(productions).values(rows).returning(),
      );
      return c.json(
        { faktur_id: fakturId, status: statusAwal, jumlah_baris: inserted.length },
        201,
      );
    })
    /**
     * Ubah tahap (kedua jalur):
     * produksi: rencana → dikerjakan → menunggu (selesai) → dikonfirmasi;
     * beli: rencana (RAB) → dikerjakan (diproses) → menunggu (dikirim) → diterima.
     *
     * Tanpa `items`: seluruh faktur naik SATU langkah (wajib berurutan) —
     * perilaku lama. Dengan `items`: hanya baris terpilih yang maju (boleh
     * lompat tahap ke depan, tak pernah mundur); qty < qty baris → baris
     * di-SPLIT: bagian yang maju jadi baris baru, sisanya tetap di tahap
     * lama sebagai tugas yang masih harus dikerjakan.
     */
    .post("/tahap/:fakturId", zValidator("json", TahapBody), async (c) => {
      const auth = c.get("auth");
      const { ke, items, dana_cair } = c.req.valid("json");

      const conds = [
        eq(productions.companyId, auth.company_id!),
        eq(productions.fakturId, c.req.param("fakturId")),
        eq(productions.tipe, tipe),
        isNull(productions.deletedAt),
      ];
      if (auth.role === "cashier" && auth.branch_id) {
        conds.push(eq(productions.branchId, auth.branch_id));
      }

      // ===== Maju sebagian (dropdown + penyesuaian per baris) =====
      if (items) {
        const target = URUTAN_TAHAP[ke];
        const baris = await db
          .select()
          .from(productions)
          .where(and(...conds));
        if (baris.length === 0) {
          throw new HTTPException(404, { message: "Faktur tidak ditemukan" });
        }
        const byId = new Map(baris.map((b) => [b.id, b]));

        // Validasi seluruh permintaan dulu — semua-atau-tidak-sama-sekali.
        const terpakai = new Set<string>();
        for (const item of items) {
          if (terpakai.has(item.id)) {
            throw new HTTPException(400, { message: "Baris yang sama dikirim dua kali" });
          }
          terpakai.add(item.id);
          const b = byId.get(item.id);
          if (!b) {
            throw new HTTPException(400, { message: "Ada baris yang bukan milik faktur ini" });
          }
          if (b.status === "ditolak" || URUTAN_TAHAP[b.status] >= target) {
            throw new HTTPException(400, {
              message: `Baris berstatus "${b.status}" tidak bisa dipindah ke "${ke}" — tahap hanya bisa maju`,
            });
          }
          if (item.qty > b.qty + 1e-9) {
            throw new HTTPException(400, { message: "Qty maju melebihi qty baris" });
          }
        }

        const now = new Date();
        // waktu di-set saat dikonfirmasi (bukan saat RAB) — lihat /konfirmasi.
        const naik =
          ke === "dikonfirmasi"
            ? ({ status: ke, confirmedBy: auth.sub, confirmedAt: now, waktu: now } as const)
            : ({ status: ke, updatedBy: auth.sub, updatedAt: now } as const);

        await db.transaction(async (tx) => {
          if (dana_cair != null) {
            await tx.insert(fakturDana).values({
              companyId: auth.company_id!,
              branchId: baris[0].branchId,
              fakturId: c.req.param("fakturId"),
              nominal: dana_cair,
              userId: auth.sub,
            });
          }
          for (const item of items) {
            const b = byId.get(item.id)!;
            // WHERE menuntut status persis seperti saat dibaca: bila berubah
            // oleh proses lain, update 0 baris → seluruh transaksi batal.
            const kunci = and(
              eq(productions.id, b.id),
              eq(productions.status, b.status),
              isNull(productions.deletedAt),
            );
            if (Math.abs(b.qty - item.qty) < 1e-9) {
              const res = await tx
                .update(productions)
                .set(naik)
                .where(kunci)
                .returning({ id: productions.id });
              if (res.length === 0) {
                throw new HTTPException(409, {
                  message: "Status faktur berubah — muat ulang halaman lalu coba lagi",
                });
              }
            } else {
              // Split: bagian yang maju jadi baris BARU; baris asli menyimpan
              // sisa qty di tahap lama. Harga diprorata dan jumlah keduanya
              // tetap = harga awal (tidak ada rupiah yang hilang/berlipat).
              const hargaMaju =
                b.totalHarga != null ? Math.round((b.totalHarga * item.qty) / b.qty) : null;
              const res = await tx
                .update(productions)
                .set({
                  qty: b.qty - item.qty,
                  ...(b.totalHarga != null
                    ? { totalHarga: b.totalHarga - (hargaMaju ?? 0) }
                    : {}),
                  updatedBy: auth.sub,
                  updatedAt: now,
                })
                .where(kunci)
                .returning({ id: productions.id });
              if (res.length === 0) {
                throw new HTTPException(409, {
                  message: "Status faktur berubah — muat ulang halaman lalu coba lagi",
                });
              }
              await tx.insert(productions).values({
                companyId: b.companyId,
                branchId: b.branchId,
                ingredientId: b.ingredientId,
                qty: item.qty,
                tipe: b.tipe,
                totalHarga: hargaMaju,
                fakturId: b.fakturId,
                noFaktur: b.noFaktur,
                supplierId: b.supplierId,
                storageLocationId: b.storageLocationId,
                isBatch: b.isBatch,
                catatan: b.catatan,
                userId: b.userId,
                workerId: b.workerId,
                prodDate: b.prodDate,
                ...naik,
              });
            }
          }
        });
        return c.json({ ok: true, status: ke, jumlah_baris: items.length });
      }

      // ===== Perilaku lama: seluruh faktur, wajib berurutan satu langkah =====
      if (ke === "dikonfirmasi") {
        throw new HTTPException(400, {
          message: 'Sertakan "items" (baris terpilih) atau pakai endpoint /konfirmasi',
        });
      }
      const dari = TAHAP_SEBELUM[ke];

      const rows = await db
        .update(productions)
        .set({ status: ke, updatedBy: auth.sub, updatedAt: new Date() })
        .where(and(...conds, eq(productions.status, dari)))
        .returning({ id: productions.id, branchId: productions.branchId });

      if (rows.length === 0) {
        const [ada] = await db
          .select({ status: productions.status })
          .from(productions)
          .where(and(...conds))
          .limit(1);
        if (!ada) throw new HTTPException(404, { message: "Faktur tidak ditemukan" });
        throw new HTTPException(400, {
          message: `Tahap tidak berurutan: faktur berstatus "${ada.status}" — hanya bisa "${dari}" → "${ke}"`,
        });
      }
      if (dana_cair != null) {
        await db.insert(fakturDana).values({
          companyId: auth.company_id!,
          branchId: rows[0].branchId,
          fakturId: c.req.param("fakturId"),
          nominal: dana_cair,
          userId: auth.sub,
        });
      }
      return c.json({ ok: true, status: ke, jumlah_baris: rows.length });
    })
    /** Konfirmasi "ya, ada": barang benar-benar diterima → stok terhitung. */
    .post("/konfirmasi/:fakturId", async (c) => {
      const auth = c.get("auth");
      const conds = [
        eq(productions.companyId, auth.company_id!),
        eq(productions.fakturId, c.req.param("fakturId")),
        eq(productions.tipe, tipe),
        eq(productions.status, "menunggu"),
      ];
      if (auth.role === "cashier" && auth.branch_id) {
        conds.push(eq(productions.branchId, auth.branch_id));
      }
      // waktu = saat dikonfirmasi (bukan saat RAB dibuat) agar stok masuk
      // terhitung relatif ke opname terakhir — kalau tetap pakai waktu insert,
      // faktur yang dibuat sebelum opname lalu dikonfirmasi setelahnya tak
      // pernah masuk saldo.
      const now = new Date();
      const rows = await db
        .update(productions)
        .set({ status: "dikonfirmasi", confirmedBy: auth.sub, confirmedAt: now, waktu: now })
        .where(and(...conds))
        .returning();
      if (rows.length === 0) {
        throw new HTTPException(404, {
          message: "Faktur tidak ditemukan atau sudah dikonfirmasi",
        });
      }
      return c.json({ ok: true, jumlah_baris: rows.length });
    })
    .post("/", zValidator("json", TambahStokBody), async (c) => {
      const auth = c.get("auth");
      const body = c.req.valid("json");
      const branchId = await resolveBranchUntukTulis(c, body.branch_id);

      const [ingRow] = await db
        .select()
        .from(ingredients)
        .where(
          and(
            eq(ingredients.id, body.ingredient_id),
            eq(ingredients.companyId, auth.company_id!),
          ),
        );
      const ing = pastikanJalur(ingRow, tipe, body.ingredient_id);

      const [company] = await db
        .select({ timezone: companies.timezone })
        .from(companies)
        .where(eq(companies.id, auth.company_id!));

      const qty = body.batch ? ing.isi : body.qty!;
      const [row] = await db
        .insert(productions)
        .values({
          companyId: auth.company_id!,
          branchId,
          ingredientId: ing.id,
          qty,
          tipe,
          totalHarga:
            tipe === "beli" ? (body.total_harga ?? hargaDefault(qty, ing)) : null,
          isBatch: body.batch,
          catatan: body.catatan ?? null,
          userId: auth.sub,
          prodDate: tanggalDi(company?.timezone ?? "Asia/Jakarta"),
        })
        .returning();
      return c.json({ ...row, bahan: ing.nama }, 201);
    })
    /**
     * Daftar "buku besar": pagination per FAKTUR, urut terlama → terbaru
     * (halaman awal = terlama, halaman terakhir = terbaru). Filter rentang
     * tanggal opsional (dari/sampai). Balikan { rows, total, total_pengeluaran }.
     */
    .get("/", async (c) => {
      const auth = c.get("auth");
      const branchId = await resolveBranchId(c);
      const dari = tglValid(c.req.query("dari"));
      const sampai = tglValid(c.req.query("sampai"));
      // dukung juga ?tanggal= (satu hari) demi kompatibilitas
      const satuHari = tglValid(c.req.query("tanggal"));
      const page = Math.max(1, Number(c.req.query("page") ?? "1") || 1);
      const perPage = Math.min(200, Math.max(1, Number(c.req.query("per_page") ?? "20") || 20));

      const conds = [
        eq(productions.companyId, auth.company_id!),
        eq(productions.branchId, branchId),
        eq(productions.tipe, tipe),
        isNull(productions.deletedAt),
      ];
      if (satuHari) conds.push(eq(productions.prodDate, satuHari));
      if (dari) conds.push(gte(productions.prodDate, dari));
      if (sampai) conds.push(lte(productions.prodDate, sampai));

      const keyExpr = sql<string>`COALESCE(${productions.fakturId}::text, ${productions.id}::text)`;

      const [ringkas] = await db
        .select({
          total: sql<number>`COUNT(DISTINCT ${keyExpr})::int`,
          total_pengeluaran: sql<number>`COALESCE(SUM(${productions.totalHarga}) FILTER (WHERE ${productions.status} = 'dikonfirmasi'), 0)`,
        })
        .from(productions)
        .where(and(...conds));
      const total = ringkas?.total ?? 0;

      // faktur untuk halaman ini (terlama dulu; halaman terakhir = terbaru)
      const keyRows = await db
        .select({ key: keyExpr })
        .from(productions)
        .where(and(...conds))
        .groupBy(keyExpr)
        .orderBy(sql`MIN(${productions.waktu}) ASC`)
        .limit(perPage)
        .offset((page - 1) * perPage);
      const keys = keyRows.map((r) => r.key);

      const select = {
        id: productions.id,
        ingredient_id: productions.ingredientId,
        bahan: ingredients.nama,
        isi: ingredients.isi,
        satuan: ingredients.satuan,
        qty: productions.qty,
        total_harga: productions.totalHarga,
        is_batch: productions.isBatch,
        catatan: productions.catatan,
        waktu: productions.waktu,
        prod_date: productions.prodDate,
        faktur_id: productions.fakturId,
        no_faktur: productions.noFaktur,
        status: productions.status,
        supplier: suppliers.nama,
        tempat: storageLocations.nama,
        storage_location_id: productions.storageLocationId,
        supplier_id: productions.supplierId,
        dibuat_oleh: pembuat.nama,
        diubah_oleh: pengubah.nama,
        updated_at: productions.updatedAt,
        worker_id: productions.workerId,
        dikerjakan_oleh: pekerja.nama,
        qty_dipesan: productions.qtyDipesan,
        alasan_tolak: productions.alasanTolak,
        // total dana cair faktur ini (nilai sama di tiap baris; 0 bila belum ada)
        dana_cair: sql<number>`COALESCE((SELECT SUM(fd.nominal)::float8 FROM faktur_dana fd WHERE fd.faktur_id = ${productions.fakturId}), 0)`,
      };
      const rows =
        keys.length === 0
          ? []
          : await db
              .select(select)
              .from(productions)
              .innerJoin(ingredients, eq(productions.ingredientId, ingredients.id))
              .leftJoin(suppliers, eq(productions.supplierId, suppliers.id))
              .leftJoin(storageLocations, eq(productions.storageLocationId, storageLocations.id))
              .leftJoin(pembuat, eq(productions.userId, pembuat.id))
              .leftJoin(pengubah, eq(productions.updatedBy, pengubah.id))
              .leftJoin(pekerja, eq(productions.workerId, pekerja.id))
              .where(
                and(
                  eq(productions.companyId, auth.company_id!),
                  eq(productions.branchId, branchId),
                  eq(productions.tipe, tipe),
                  isNull(productions.deletedAt),
                  inArray(keyExpr, keys),
                ),
              )
              .orderBy(asc(productions.waktu), asc(productions.id));

      return c.json({
        rows,
        total,
        page,
        per_page: perPage,
        total_pengeluaran: Number(ringkas?.total_pengeluaran ?? 0),
      });
    })
    /** Ubah metadata faktur (butuh password). Tak mengubah qty/harga → stok tetap. */
    .patch("/faktur/:key", zValidator("json", FakturEditBody), async (c) => {
      const auth = c.get("auth");
      const body = c.req.valid("json");
      const key = c.req.param("key");
      if (!/^[0-9a-f-]{36}$/i.test(key)) {
        throw new HTTPException(404, { message: "Faktur tidak ditemukan" });
      }
      await verifikasiPassword(auth.sub, body.password);

      // Muat faktur (milik perusahaan + jalur, belum dihapus) untuk cek + branch
      const barisFaktur = await db
        .select({ id: productions.id, branchId: productions.branchId })
        .from(productions)
        .where(
          and(
            eq(productions.companyId, auth.company_id!),
            eq(productions.tipe, tipe),
            isNull(productions.deletedAt),
            cocokFaktur(key),
          ),
        );
      if (barisFaktur.length === 0) {
        throw new HTTPException(404, { message: "Faktur tidak ditemukan" });
      }
      const branchId = barisFaktur[0].branchId;

      if (body.supplier_id) {
        const [s] = await db
          .select({ id: suppliers.id })
          .from(suppliers)
          .where(
            and(eq(suppliers.id, body.supplier_id), eq(suppliers.companyId, auth.company_id!)),
          );
        if (!s) throw new HTTPException(400, { message: "Supplier tidak valid" });
      }
      if (body.storage_location_id) {
        const [l] = await db
          .select({ id: storageLocations.id })
          .from(storageLocations)
          .where(
            and(
              eq(storageLocations.id, body.storage_location_id),
              eq(storageLocations.branchId, branchId),
            ),
          );
        if (!l) throw new HTTPException(400, { message: "Tempat penyimpanan tidak valid" });
      }

      const set: Partial<typeof productions.$inferInsert> = {
        updatedBy: auth.sub,
        updatedAt: new Date(),
      };
      if (body.worker_id !== undefined && tipe === "produksi") {
        if (body.worker_id) await pastikanKaryawan(body.worker_id, auth.company_id!);
        set.workerId = body.worker_id ?? null;
      }
      if (body.supplier_id !== undefined) set.supplierId = body.supplier_id ?? null;
      if (body.no_faktur !== undefined) set.noFaktur = body.no_faktur ?? null;
      if (body.catatan !== undefined) set.catatan = body.catatan ?? null;
      if (body.storage_location_id !== undefined)
        set.storageLocationId = body.storage_location_id ?? null;
      if (body.prod_date !== undefined) set.prodDate = body.prod_date;

      const rows = await db
        .update(productions)
        .set(set)
        .where(
          and(
            eq(productions.companyId, auth.company_id!),
            eq(productions.tipe, tipe),
            isNull(productions.deletedAt),
            cocokFaktur(key),
          ),
        )
        .returning({ id: productions.id });
      return c.json({ ok: true, jumlah_baris: rows.length });
    })
    /** Hapus faktur → Tempat Sampah (soft-delete, butuh password). Stok dikoreksi. */
    .delete("/faktur/:key", zValidator("json", HapusBody), async (c) => {
      const auth = c.get("auth");
      const body = c.req.valid("json");
      const key = c.req.param("key");
      if (!/^[0-9a-f-]{36}$/i.test(key)) {
        throw new HTTPException(404, { message: "Faktur tidak ditemukan" });
      }
      await verifikasiPassword(auth.sub, body.password);
      const rows = await db
        .update(productions)
        .set({ deletedAt: new Date(), deletedBy: auth.sub })
        .where(
          and(
            eq(productions.companyId, auth.company_id!),
            eq(productions.tipe, tipe),
            isNull(productions.deletedAt),
            cocokFaktur(key),
          ),
        )
        .returning({ id: productions.id });
      if (rows.length === 0) {
        throw new HTTPException(404, { message: "Faktur tidak ditemukan" });
      }
      return c.json({ ok: true, jumlah_baris: rows.length });
    });
}

export const produksiRoutes = buatRuteTambahStok("produksi");
export const pembelianRoutes = buatRuteTambahStok("beli");

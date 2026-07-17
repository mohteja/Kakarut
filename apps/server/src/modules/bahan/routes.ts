import { zValidator } from "@hono/zod-validator";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  hargaPerUnit,
  type BahanDto,
  type BahanResepRow,
  type BahanSupplierDto,
} from "@kakarut/shared";
import { db } from "../../db/client";
import {
  ingredientComponents,
  ingredientSuppliers,
  ingredients,
  menuComponents,
  menus,
  productions,
  suppliers,
} from "../../db/schema";
import { requireRole, type AppEnv } from "../../middleware/auth";
import { kanonikKategori, kategoriKanonikMap } from "../kategori-bahan/service";
import { resolveKodeBahan, resolveKodeBahanBatch } from "./kode";

const BahanBody = z.object({
  slug: z.string().trim().min(1).optional(),
  /** kode produk (kosong → generate otomatis dari nama) */
  kode: z.string().trim().max(20).nullish(),
  nama: z.string().trim().min(1),
  harga_beli: z.number().nonnegative(),
  isi: z.number().positive(),
  satuan: z.string().trim().min(1).max(20).default("pcs"),
  /** satuan beli (mis. "dus"); 1 satuan_beli = isi satuan */
  satuan_beli: z.string().trim().max(20).nullish(),
  /** lacak stok saat membeli & menjual */
  track_stok: z.boolean().default(true),
  /** ambang batas stok minimum: saldo ≤ nilai ini → "menipis" (0 = rasio default) */
  stok_minimum: z.number().nonnegative().default(0),
  /** ambang stok minimum khusus cabang toko (0 = rasio default) */
  stok_minimum_toko: z.number().nonnegative().default(0),
  /** pengali biaya resep → harga per batch bahan produksi (1 = mengikuti resep) */
  overhead_x: z.number().positive().max(1000).default(1),
  kategori: z.string().trim().min(1).max(30).default("lain"),
  /** jalur pengadaan: produksi sendiri atau beli jadi */
  pengadaan: z.enum(["produksi", "beli"]).default("beli"),
  catatan: z.string().nullish(),
  is_packaging: z.boolean().default(false),
  is_complement: z.boolean().default(false),
  /** boleh dibeli eceran per pcs; false = pembulatan per kemasan `isi` (jalur beli) */
  boleh_eceran: z.boolean().default(false),
  /** minimal belanja (MOQ) saat belanja otomatis; 0 = tanpa minimum */
  min_beli: z.number().nonnegative().default(0),
});

/**
 * Body PUT parsial TANPA .default(): di zod v4, .partial() atas field
 * ber-default MENGISI default untuk key yang absen — PUT parsial diam-diam
 * me-reset kolom (mis. satuan kembali "pcs"). Semua field opsional murni.
 */
const BahanPatchBody = z.object({
  slug: z.string().trim().min(1).optional(),
  kode: z.string().trim().max(20).nullish(),
  nama: z.string().trim().min(1).optional(),
  harga_beli: z.number().nonnegative().optional(),
  isi: z.number().positive().optional(),
  satuan: z.string().trim().min(1).max(20).optional(),
  satuan_beli: z.string().trim().max(20).nullish(),
  track_stok: z.boolean().optional(),
  stok_minimum: z.number().nonnegative().optional(),
  stok_minimum_toko: z.number().nonnegative().optional(),
  overhead_x: z.number().positive().max(1000).optional(),
  kategori: z.string().trim().min(1).max(30).optional(),
  pengadaan: z.enum(["produksi", "beli"]).optional(),
  catatan: z.string().nullish(),
  is_packaging: z.boolean().optional(),
  is_complement: z.boolean().optional(),
  boleh_eceran: z.boolean().optional(),
  min_beli: z.number().nonnegative().optional(),
});

const ResepBody = z.object({
  komponen: z
    .array(z.object({ ingredient_id: z.string().uuid(), qty: z.number().positive() }))
    .default([]),
});

/** Satu baris "tambah bahan baku" (bulk) — selalu jalur beli, tanpa kemasan/complement. */
const BahanBulkRow = z.object({
  kode: z.string().trim().max(20).nullish(),
  nama: z.string().trim().min(1),
  harga_beli: z.number().nonnegative(),
  isi: z.number().positive(),
  satuan: z.string().trim().min(1).max(20).default("pcs"),
  satuan_beli: z.string().trim().max(20).nullish(),
  kategori: z.string().trim().min(1).max(30).default("lain"),
  track_stok: z.boolean().default(true),
  stok_minimum: z.number().nonnegative().default(0),
  boleh_eceran: z.boolean().default(false),
});
const BahanBulkBody = z.object({ items: z.array(BahanBulkRow).min(1).max(200) });

/** Satu baris impor CSV (nilai sudah dikoersi di web; default aman bila kosong). */
const BahanImportRowBody = z.object({
  kode: z.string().trim().max(20).nullish(),
  nama: z.string().trim().min(1),
  kategori: z.string().trim().min(1).max(30).default("lain"),
  jenis: z.enum(["produksi", "beli"]).default("beli"),
  harga_beli: z.number().nonnegative().default(0),
  isi: z.number().positive().default(1),
  satuan: z.string().trim().min(1).max(20).default("pcs"),
  satuan_beli: z.string().trim().max(20).nullish(),
  stok_minimum: z.number().nonnegative().default(0),
  boleh_eceran: z.boolean().default(false),
  lacak_stok: z.boolean().default(true),
  catatan: z.string().nullish(),
});
const BahanImportBody = z.object({
  mode: z.enum(["perbarui", "tambah"]),
  items: z.array(BahanImportRowBody).min(1).max(1000),
});

const BahanSupplierBody = z.object({
  items: z
    .array(
      z.object({
        supplier_id: z.string().uuid(),
        is_utama: z.boolean().default(false),
      }),
    )
    .max(50)
    .default([]),
});

/** Ringkasan supplier per bahan: nama supplier utama + jumlah terdaftar. */
async function infoSupplier(
  companyId: string,
  ingredientIds?: string[],
): Promise<Map<string, { utama: string | null; jumlah: number }>> {
  if (ingredientIds && ingredientIds.length === 0) return new Map();
  const rows = await db
    .select({
      ingredientId: ingredientSuppliers.ingredientId,
      utama: sql<string | null>`MAX(${suppliers.nama}) FILTER (WHERE ${ingredientSuppliers.isUtama})`,
      jumlah: sql<number>`COUNT(*)::int`,
    })
    .from(ingredientSuppliers)
    .innerJoin(suppliers, eq(ingredientSuppliers.supplierId, suppliers.id))
    .where(
      and(
        eq(ingredientSuppliers.companyId, companyId),
        ...(ingredientIds ? [inArray(ingredientSuppliers.ingredientId, ingredientIds)] : []),
      ),
    )
    .groupBy(ingredientSuppliers.ingredientId);
  return new Map(rows.map((r) => [r.ingredientId, { utama: r.utama, jumlah: r.jumlah }]));
}

async function listSupplierBahan(
  companyId: string,
  ingredientId: string,
): Promise<BahanSupplierDto[]> {
  const rows = await db
    .select({
      id: ingredientSuppliers.id,
      supplierId: ingredientSuppliers.supplierId,
      nama: suppliers.nama,
      telepon: suppliers.telepon,
      alamat: suppliers.alamat,
      isUtama: ingredientSuppliers.isUtama,
    })
    .from(ingredientSuppliers)
    .innerJoin(suppliers, eq(ingredientSuppliers.supplierId, suppliers.id))
    .where(
      and(
        eq(ingredientSuppliers.companyId, companyId),
        eq(ingredientSuppliers.ingredientId, ingredientId),
      ),
    )
    .orderBy(desc(ingredientSuppliers.isUtama), asc(suppliers.nama));
  return rows.map((r) => ({
    id: r.id,
    supplier_id: r.supplierId,
    nama: r.nama,
    telepon: r.telepon,
    alamat: r.alamat,
    is_utama: r.isUtama,
  }));
}

function toDto(
  row: typeof ingredients.$inferSelect,
  sup?: { utama: string | null; jumlah: number },
): BahanDto {
  return {
    id: row.id,
    slug: row.slug,
    kode: row.kode,
    nama: row.nama,
    harga_beli: row.hargaBeli,
    isi: row.isi,
    satuan: row.satuan,
    satuan_beli: row.satuanBeli,
    track_stok: row.trackStok,
    stok_minimum: row.stokMinimum,
    stok_minimum_toko: row.stokMinimumToko,
    overhead_x: row.overheadX,
    harga_per_unit: hargaPerUnit(row.hargaBeli, row.isi),
    kategori: row.kategori,
    pengadaan: row.pengadaan,
    catatan: row.catatan,
    is_packaging: row.isPackaging,
    is_complement: row.isComplement,
    boleh_eceran: row.bolehEceran,
    min_beli: row.minBeli,
    is_active: row.isActive,
    supplier_utama: sup?.utama ?? null,
    jumlah_supplier: sup?.jumlah ?? 0,
  };
}

export const bahanRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const auth = c.get("auth");
    const rows = await db
      .select()
      .from(ingredients)
      .where(and(eq(ingredients.companyId, auth.company_id!), eq(ingredients.isActive, true)))
      .orderBy(asc(ingredients.nama));
    const sup = await infoSupplier(auth.company_id!);
    return c.json(rows.map((r) => toDto(r, sup.get(r.id))));
  })
  .post("/", requireRole("owner", "admin"), zValidator("json", BahanBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const slug =
      body.slug ?? body.nama.toLowerCase().trim().replace(/\s+/g, " ");
    const [existing] = await db
      .select({
        id: ingredients.id,
        isActive: ingredients.isActive,
        pengadaan: ingredients.pengadaan,
      })
      .from(ingredients)
      .where(
        and(eq(ingredients.companyId, auth.company_id!), eq(ingredients.slug, slug)),
      );
    // samakan huruf kategori dengan master (mis. "buah segar" → "Buah segar")
    const kmap = await kategoriKanonikMap(db, auth.company_id!);
    if (existing?.isActive) {
      // Duplikat sungguhan (masih aktif). Beri petunjuk lokasi — bahan BELI tak
      // muncul di daftar Resep Produksi, jadi owner bisa mengira "tak ada".
      const dimana = existing.pengadaan === "beli" ? " (ada di daftar Bahan Baku)" : "";
      throw new HTTPException(409, {
        message: `Bahan "${body.nama}" sudah ada${dimana}`,
      });
    }
    if (existing) {
      // Slug cocok bahan NONAKTIF: pernah dihapus/diarsip — TIDAK tampil di
      // daftar mana pun (bukan pula di Tempat Sampah), tapi slug tetap terpakai.
      // Menolak = memblokir pembuatan selamanya tanpa jalan keluar di UI. Jadi
      // PULIHKAN + perbarui nilainya (konsisten dgn impor CSV mode "perbarui").
      if (body.pengadaan === "beli") {
        // beli tak punya resep — bersihkan resep lama bila dulunya produksi
        await db
          .delete(ingredientComponents)
          .where(eq(ingredientComponents.ingredientId, existing.id));
      }
      const [row] = await db
        .update(ingredients)
        .set({
          isActive: true,
          nama: body.nama,
          hargaBeli: body.harga_beli,
          isi: body.isi,
          satuan: body.satuan,
          satuanBeli: body.satuan_beli ?? null,
          trackStok: body.track_stok,
          stokMinimum: body.stok_minimum,
          stokMinimumToko: body.stok_minimum_toko,
          overheadX: body.overhead_x,
          kategori: kanonikKategori(kmap, body.kategori),
          pengadaan: body.pengadaan,
          catatan: body.catatan ?? null,
          isPackaging: body.is_packaging,
          isComplement: body.is_complement,
          bolehEceran: body.boleh_eceran,
          minBeli: body.min_beli,
          updatedAt: new Date(),
        })
        .where(and(eq(ingredients.id, existing.id), eq(ingredients.companyId, auth.company_id!)))
        .returning();
      return c.json(toDto(row), 200);
    }
    const kode = await resolveKodeBahan(db, auth.company_id!, body.kode, body.nama);
    const [row] = await db
      .insert(ingredients)
      .values({
        companyId: auth.company_id!,
        slug,
        kode,
        nama: body.nama,
        hargaBeli: body.harga_beli,
        isi: body.isi,
        satuan: body.satuan,
        satuanBeli: body.satuan_beli ?? null,
        trackStok: body.track_stok,
        stokMinimum: body.stok_minimum,
        stokMinimumToko: body.stok_minimum_toko,
        overheadX: body.overhead_x,
        kategori: kanonikKategori(kmap, body.kategori),
        pengadaan: body.pengadaan,
        catatan: body.catatan ?? null,
        isPackaging: body.is_packaging,
        isComplement: body.is_complement,
        bolehEceran: body.boleh_eceran,
        minBeli: body.min_beli,
      })
      .returning();
    return c.json(toDto(row), 201);
  })
  /**
   * Tambah banyak bahan baku sekaligus (halaman "Tambah Bahan Baku" multi-baris).
   * Selalu jalur BELI. Kode & slug dibuat unik lintas-baris + existing (suffix
   * bila bentrok) agar satu baris bermasalah tak menggagalkan seluruh batch.
   */
  .post("/bulk", requireRole("owner", "admin"), zValidator("json", BahanBulkBody), async (c) => {
    const auth = c.get("auth");
    const { items } = c.req.valid("json");
    const existing = await db
      .select({ slug: ingredients.slug })
      .from(ingredients)
      .where(eq(ingredients.companyId, auth.company_id!));
    const slugDipakai = new Set(existing.map((r) => r.slug.toLowerCase()));
    const slugUnik = (nama: string): string => {
      const base = nama.toLowerCase().trim().replace(/\s+/g, " ") || "bahan";
      let s = base;
      let n = 2;
      while (slugDipakai.has(s.toLowerCase())) s = `${base} ${n++}`;
      slugDipakai.add(s.toLowerCase());
      return s;
    };
    const kodes = await resolveKodeBahanBatch(db, auth.company_id!, items);
    const kmap = await kategoriKanonikMap(db, auth.company_id!);
    const rows = await db
      .insert(ingredients)
      .values(
        items.map((b, i) => ({
          companyId: auth.company_id!,
          slug: slugUnik(b.nama),
          kode: kodes[i],
          nama: b.nama,
          hargaBeli: b.harga_beli,
          isi: b.isi,
          satuan: b.satuan,
          satuanBeli: b.satuan_beli ?? null,
          trackStok: b.track_stok,
          stokMinimum: b.stok_minimum,
          kategori: kanonikKategori(kmap, b.kategori),
          pengadaan: "beli" as const,
          bolehEceran: b.boleh_eceran,
        })),
      )
      .returning();
    return c.json({ jumlah: rows.length, bahan: rows.map((r) => toDto(r)) }, 201);
  })
  /**
   * IMPOR CSV bahan baku (owner/admin). Web mem-parse CSV → JSON, lalu:
   * - "perbarui": bahan yang cocok (kode → slug/nama) DIPERBARUI, sisanya
   *   ditambah — jadikan data terbaru.
   * - "tambah": hanya bahan yang BELUM ADA yang ditambah; yang sudah ada
   *   dilewati (tak disentuh).
   * `jenis` (pengadaan) hanya diterapkan pada bahan BARU — mengubah jenis
   * bahan lama lewat impor tak diizinkan agar resep/konsumsi tak yatim.
   * Gagal per baris dilaporkan tanpa menggagalkan seluruh impor.
   */
  .post("/import", requireRole("owner", "admin"), zValidator("json", BahanImportBody), async (c) => {
    const auth = c.get("auth");
    const { mode, items } = c.req.valid("json");
    const companyId = auth.company_id!;
    // samakan huruf kategori tiap baris dengan master (mis. "buah segar" → "Buah segar")
    const kmap = await kategoriKanonikMap(db, companyId);

    // Muat SEMUA bahan (aktif + nonaktif). Bahan nonaktif = sudah di Tempat
    // Sampah: jangan dianggap "sudah ada" yang dilewati — cocokkan terpisah agar
    // impor MEMULIHKAN-nya, bukan menolak insert (slug tetap unik utk nonaktif).
    const existing = await db
      .select({
        id: ingredients.id,
        kode: ingredients.kode,
        slug: ingredients.slug,
        isActive: ingredients.isActive,
      })
      .from(ingredients)
      .where(eq(ingredients.companyId, companyId));
    const byKode = new Map<string, string>();
    const bySlug = new Map<string, string>();
    const byKodeMati = new Map<string, string>();
    const bySlugMati = new Map<string, string>();
    const slugDipakai = new Set<string>();
    for (const e of existing) {
      slugDipakai.add(e.slug.toLowerCase());
      if (e.isActive) {
        if (e.kode) byKode.set(e.kode.toLowerCase(), e.id);
        bySlug.set(e.slug.toLowerCase(), e.id);
      } else {
        if (e.kode) byKodeMati.set(e.kode.toLowerCase(), e.id);
        bySlugMati.set(e.slug.toLowerCase(), e.id);
      }
    }

    let ditambah = 0;
    let diperbarui = 0;
    let dipulihkan = 0;
    let dilewati = 0;
    const gagal: { nama: string; alasan: string }[] = [];

    // klasifikasi: aktif → perbarui/lewati; nonaktif → pulihkan; sisanya insert.
    const updateBaris: { item: (typeof items)[number]; id: string; pulih: boolean }[] = [];
    const insertBaris: { item: (typeof items)[number]; slug: string }[] = [];
    for (const b of items) {
      const slug = b.nama.toLowerCase().trim().replace(/\s+/g, " ");
      const idAktif = (b.kode && byKode.get(b.kode.toLowerCase())) || bySlug.get(slug);
      if (idAktif) {
        if (mode === "tambah") {
          dilewati++;
          continue;
        }
        updateBaris.push({ item: b, id: idAktif, pulih: false });
        continue;
      }
      // cocok dengan bahan di Tempat Sampah → pulihkan (di kedua mode)
      const idMati = (b.kode && byKodeMati.get(b.kode.toLowerCase())) || bySlugMati.get(slug);
      if (idMati) {
        updateBaris.push({ item: b, id: idMati, pulih: true });
        continue;
      }
      let s = slug || "bahan";
      let n = 2;
      while (slugDipakai.has(s.toLowerCase())) s = `${slug} ${n++}`;
      slugDipakai.add(s.toLowerCase());
      insertBaris.push({ item: b, slug: s });
    }
    // kode untuk semua baris baru: unik terhadap existing + antar-baris
    const kodes = await resolveKodeBahanBatch(
      db,
      companyId,
      insertBaris.map((x) => ({ nama: x.item.nama, kode: x.item.kode })),
    );

    for (const u of updateBaris) {
      try {
        await db
          .update(ingredients)
          .set({
            nama: u.item.nama,
            kategori: kanonikKategori(kmap, u.item.kategori),
            hargaBeli: u.item.harga_beli,
            isi: u.item.isi,
            satuan: u.item.satuan,
            satuanBeli: u.item.satuan_beli ?? null,
            stokMinimum: u.item.stok_minimum,
            bolehEceran: u.item.boleh_eceran,
            trackStok: u.item.lacak_stok,
            catatan: u.item.catatan ?? null,
            // baris pulih: aktifkan kembali dari Tempat Sampah
            ...(u.pulih && { isActive: true }),
            updatedAt: new Date(),
          })
          .where(and(eq(ingredients.id, u.id), eq(ingredients.companyId, companyId)));
        if (u.pulih) dipulihkan++;
        else diperbarui++;
      } catch (e) {
        gagal.push({ nama: u.item.nama, alasan: (e as Error)?.message ?? "gagal diperbarui" });
      }
    }
    for (let i = 0; i < insertBaris.length; i++) {
      const { item: b, slug } = insertBaris[i];
      try {
        await db.insert(ingredients).values({
          companyId,
          slug,
          kode: kodes[i],
          nama: b.nama,
          hargaBeli: b.harga_beli,
          isi: b.isi,
          satuan: b.satuan,
          satuanBeli: b.satuan_beli ?? null,
          trackStok: b.lacak_stok,
          stokMinimum: b.stok_minimum,
          kategori: kanonikKategori(kmap, b.kategori),
          pengadaan: b.jenis,
          bolehEceran: b.boleh_eceran,
          catatan: b.catatan ?? null,
        });
        ditambah++;
      } catch (e) {
        gagal.push({ nama: b.nama, alasan: (e as Error)?.message ?? "gagal ditambah" });
      }
    }
    return c.json({ ditambah, diperbarui, dipulihkan, dilewati, gagal });
  })
  .put(
    "/:id",
    requireRole("owner", "admin"),
    zValidator("json", BahanPatchBody),
    async (c) => {
      const auth = c.get("auth");
      const body = c.req.valid("json");
      const id = c.req.param("id");
      // Kepemilikan dicek DULU (404) agar guard di bawah tak jadi oracle
      // lintas-tenant; sekalian ambil nilai lama utk deteksi perubahan.
      const [lama] = await db
        .select({ isi: ingredients.isi, pengadaan: ingredients.pengadaan })
        .from(ingredients)
        .where(and(eq(ingredients.id, id), eq(ingredients.companyId, auth.company_id!)));
      if (!lama) throw new HTTPException(404, { message: "Bahan tidak ditemukan" });
      // Konservatif: bahan yang masih jadi INPUT resep aktif tak diizinkan
      // di-flip jenisnya ke "produksi" lewat jalur edit-bahan ini — ubah dulu
      // resep yang memakainya. (Memakai bahan produksi DI DALAM resep memang
      // kini didukung, tapi itu diatur dari halaman Resep, bukan dengan
      // mem-flip jenis bahan input yang sudah dipakai.)
      if (body.pengadaan === "produksi" && lama.pengadaan !== "produksi") {
        const dipakai = await db
          .select({ nama: ingredients.nama })
          .from(ingredientComponents)
          .innerJoin(ingredients, eq(ingredientComponents.ingredientId, ingredients.id))
          .where(
            and(
              eq(ingredientComponents.inputIngredientId, id),
              eq(ingredients.isActive, true),
            ),
          )
          .limit(5);
        if (dipakai.length > 0) {
          throw new HTTPException(409, {
            message: `Bahan masih dipakai resep produksi: ${dipakai
              .map((d) => d.nama)
              .join(", ")} — keluarkan dari resep dulu`,
          });
        }
      }
      // Konsumsi bahan resep memakai `isi` LIVE saat produksi selesai —
      // mengubahnya di tengah produksi berjalan membuat konsumsi melenceng
      // dari RAB yang sudah dihitung. Selesaikan produksinya dulu.
      if (
        body.isi !== undefined &&
        Math.abs(body.isi - lama.isi) > 1e-9 &&
        (body.pengadaan ?? lama.pengadaan) === "produksi"
      ) {
        const [berjalan] = await db
          .select({ id: productions.id })
          .from(productions)
          .where(
            and(
              eq(productions.ingredientId, id),
              eq(productions.tipe, "produksi"),
              inArray(productions.status, ["rencana", "dikerjakan"]),
              isNull(productions.deletedAt),
            ),
          )
          .limit(1);
        if (berjalan) {
          throw new HTTPException(409, {
            message:
              "Isi per batch tidak bisa diubah saat masih ada produksi berjalan — selesaikan produksinya dulu",
          });
        }
      }
      // Kode: bila diisi (manual), pastikan unik per company (suffix bila bentrok).
      const kodeBaru =
        body.kode != null && body.kode.trim().length > 0
          ? await resolveKodeBahan(db, auth.company_id!, body.kode, body.nama ?? "", id)
          : undefined;
      // samakan huruf kategori dengan master (hanya bila kategori diubah)
      const kategoriBaru =
        body.kategori !== undefined
          ? kanonikKategori(await kategoriKanonikMap(db, auth.company_id!), body.kategori)
          : undefined;
      const [row] = await db
        .update(ingredients)
        .set({
          ...(kodeBaru !== undefined && { kode: kodeBaru }),
          ...(body.nama !== undefined && { nama: body.nama }),
          ...(body.harga_beli !== undefined && { hargaBeli: body.harga_beli }),
          ...(body.isi !== undefined && { isi: body.isi }),
          ...(body.satuan !== undefined && { satuan: body.satuan }),
          ...(body.satuan_beli !== undefined && { satuanBeli: body.satuan_beli ?? null }),
          ...(body.track_stok !== undefined && { trackStok: body.track_stok }),
          ...(body.stok_minimum !== undefined && { stokMinimum: body.stok_minimum }),
          ...(body.stok_minimum_toko !== undefined && {
            stokMinimumToko: body.stok_minimum_toko,
          }),
          ...(body.overhead_x !== undefined && { overheadX: body.overhead_x }),
          ...(kategoriBaru !== undefined && { kategori: kategoriBaru }),
          ...(body.pengadaan !== undefined && { pengadaan: body.pengadaan }),
          ...(body.catatan !== undefined && { catatan: body.catatan }),
          ...(body.is_packaging !== undefined && { isPackaging: body.is_packaging }),
          ...(body.is_complement !== undefined && { isComplement: body.is_complement }),
          ...(body.boleh_eceran !== undefined && { bolehEceran: body.boleh_eceran }),
          ...(body.min_beli !== undefined && { minBeli: body.min_beli }),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(ingredients.id, c.req.param("id")),
            eq(ingredients.companyId, auth.company_id!),
          ),
        )
        .returning();
      if (!row) throw new HTTPException(404, { message: "Bahan tidak ditemukan" });
      // pindah jalur ke "beli" → resep produksinya tak relevan lagi, bersihkan
      if (body.pengadaan === "beli") {
        await db
          .delete(ingredientComponents)
          .where(eq(ingredientComponents.ingredientId, row.id));
      }
      // pindah jalur ke "produksi" → dibuat sendiri, tak memakai supplier:
      // bersihkan tautan supplier agar tak ada info belanja yang menyesatkan
      if (body.pengadaan === "produksi") {
        await db
          .delete(ingredientSuppliers)
          .where(
            and(
              eq(ingredientSuppliers.companyId, auth.company_id!),
              eq(ingredientSuppliers.ingredientId, row.id),
            ),
          );
      }
      const sup = await infoSupplier(auth.company_id!, [row.id]);
      return c.json(toDto(row, sup.get(row.id)));
    },
  )
  /**
   * SUPPLIER per bahan: daftar tempat membeli bahan ini + supplier utama.
   * GET terbuka semua peran (info belanja); PUT owner/admin mengganti seluruh
   * daftar sekaligus (maksimal satu utama; tanpa penanda → item pertama).
   */
  .get("/:id/supplier", async (c) => {
    const auth = c.get("auth");
    const id = c.req.param("id");
    const [milik] = await db
      .select({ id: ingredients.id })
      .from(ingredients)
      .where(and(eq(ingredients.id, id), eq(ingredients.companyId, auth.company_id!)));
    if (!milik) throw new HTTPException(404, { message: "Bahan tidak ditemukan" });
    return c.json(await listSupplierBahan(auth.company_id!, id));
  })
  .put(
    "/:id/supplier",
    requireRole("owner", "admin"),
    zValidator("json", BahanSupplierBody),
    async (c) => {
      const auth = c.get("auth");
      const id = c.req.param("id");
      const { items } = c.req.valid("json");
      const [milik] = await db
        .select({ id: ingredients.id, pengadaan: ingredients.pengadaan })
        .from(ingredients)
        .where(and(eq(ingredients.id, id), eq(ingredients.companyId, auth.company_id!)));
      if (!milik) throw new HTTPException(404, { message: "Bahan tidak ditemukan" });
      // bahan PRODUKSI SENDIRI dibuat di dapur — tidak memakai supplier
      if (milik.pengadaan === "produksi") {
        throw new HTTPException(400, {
          message: "Bahan produksi sendiri tidak memakai supplier",
        });
      }
      // gabungkan duplikat (utama di-OR-kan) agar unique index tak meledak
      const byId = new Map<string, boolean>();
      for (const it of items) {
        byId.set(it.supplier_id, (byId.get(it.supplier_id) ?? false) || it.is_utama);
      }
      const utama = [...byId.values()].filter(Boolean).length;
      if (utama > 1) {
        throw new HTTPException(400, { message: "Hanya boleh satu supplier utama" });
      }
      const supplierIds = [...byId.keys()];
      if (supplierIds.length > 0) {
        const valid = await db
          .select({ id: suppliers.id })
          .from(suppliers)
          .where(
            and(eq(suppliers.companyId, auth.company_id!), inArray(suppliers.id, supplierIds)),
          );
        if (valid.length !== supplierIds.length) {
          throw new HTTPException(400, { message: "Ada supplier yang tidak valid" });
        }
        // tanpa penanda utama → item pertama jadi utama (selalu ada langganan)
        if (utama === 0) byId.set(supplierIds[0], true);
      }
      await db.transaction(async (tx) => {
        await tx
          .delete(ingredientSuppliers)
          .where(
            and(
              eq(ingredientSuppliers.companyId, auth.company_id!),
              eq(ingredientSuppliers.ingredientId, id),
            ),
          );
        if (supplierIds.length > 0) {
          await tx.insert(ingredientSuppliers).values(
            [...byId].map(([supplierId, isUtama]) => ({
              companyId: auth.company_id!,
              ingredientId: id,
              supplierId,
              isUtama,
            })),
          );
        }
      });
      return c.json(await listSupplierBahan(auth.company_id!, id));
    },
  )
  /**
   * RESEP PRODUKSI (BOM) bahan jadi: kebutuhan bahan mentah per 1 batch (isi).
   * GET terbuka utk semua peran (dipakai tampilan); PUT owner/admin.
   */
  .get("/:id/resep", async (c) => {
    const auth = c.get("auth");
    const id = c.req.param("id");
    const [induk] = await db
      .select({ id: ingredients.id })
      .from(ingredients)
      .where(and(eq(ingredients.id, id), eq(ingredients.companyId, auth.company_id!)));
    if (!induk) throw new HTTPException(404, { message: "Bahan tidak ditemukan" });
    const input = alias(ingredients, "input_bahan");
    const rows = await db
      .select({
        ingredientId: ingredientComponents.inputIngredientId,
        nama: input.nama,
        satuan: input.satuan,
        qty: ingredientComponents.qty,
        hargaBeli: input.hargaBeli,
        isi: input.isi,
        trackStok: input.trackStok,
      })
      .from(ingredientComponents)
      .innerJoin(input, eq(input.id, ingredientComponents.inputIngredientId))
      .where(eq(ingredientComponents.ingredientId, id))
      .orderBy(asc(input.nama));
    const resep: BahanResepRow[] = rows.map((r) => ({
      ingredient_id: r.ingredientId,
      nama: r.nama,
      satuan: r.satuan,
      qty: r.qty,
      harga_per_unit: hargaPerUnit(r.hargaBeli, r.isi),
      track_stok: r.trackStok,
    }));
    return c.json(resep);
  })
  .put(
    "/:id/resep",
    requireRole("owner", "admin"),
    zValidator("json", ResepBody),
    async (c) => {
      const auth = c.get("auth");
      const id = c.req.param("id");
      const body = c.req.valid("json");
      const [induk] = await db
        .select({ id: ingredients.id, pengadaan: ingredients.pengadaan })
        .from(ingredients)
        .where(and(eq(ingredients.id, id), eq(ingredients.companyId, auth.company_id!)));
      if (!induk) throw new HTTPException(404, { message: "Bahan tidak ditemukan" });
      if (induk.pengadaan !== "produksi") {
        throw new HTTPException(400, {
          message: "Resep hanya untuk bahan berjenis produksi",
        });
      }
      // gabungkan duplikat (qty dijumlah), tolak referensi diri sendiri
      const qtyByInput = new Map<string, number>();
      for (const k of body.komponen) {
        if (k.ingredient_id === id) {
          throw new HTTPException(400, { message: "Bahan tidak boleh memakai dirinya sendiri" });
        }
        qtyByInput.set(k.ingredient_id, (qtyByInput.get(k.ingredient_id) ?? 0) + k.qty);
      }
      const inputIds = [...qtyByInput.keys()];
      if (inputIds.length > 0) {
        // Bahan input resep harus milik perusahaan & aktif. Boleh berjenis
        // "beli" (bahan baku) MAUPUN "produksi" (bahan jadi/semi-jadi yang
        // dibuat sendiri) — resep bertingkat didukung; input produksi dipotong
        // dari STOK-nya saat produksi induk selesai (bukan diurai ulang ke
        // bahan mentahnya), jadi konsumsi tetap satu tingkat per produksi.
        const valid = await db
          .select({ id: ingredients.id, nama: ingredients.nama })
          .from(ingredients)
          .where(
            and(
              eq(ingredients.companyId, auth.company_id!),
              eq(ingredients.isActive, true),
              inArray(ingredients.id, inputIds),
            ),
          );
        if (valid.length !== inputIds.length) {
          throw new HTTPException(400, { message: "Ada bahan input yang tidak valid" });
        }
        // Cegah resep MELINGKAR (A→B→…→A): input produksi yang resepnya —
        // langsung atau tak langsung — kembali memakai bahan induk `id`
        // ditolak, agar perhitungan biaya & konsumsi tak jadi rekursi tanpa
        // akhir. Graf resep per-company kecil → DFS in-memory sudah cukup.
        const namaById = new Map(valid.map((v) => [v.id, v.nama]));
        const edges = await db
          .select({
            dari: ingredientComponents.ingredientId,
            ke: ingredientComponents.inputIngredientId,
          })
          .from(ingredientComponents)
          .innerJoin(ingredients, eq(ingredients.id, ingredientComponents.ingredientId))
          .where(eq(ingredients.companyId, auth.company_id!));
        const adj = new Map<string, string[]>();
        for (const e of edges) {
          if (e.dari === id) continue; // resep lama `id` akan diganti — abaikan
          const list = adj.get(e.dari) ?? [];
          list.push(e.ke);
          adj.set(e.dari, list);
        }
        const mencapaiInduk = (mulai: string): boolean => {
          const tumpuk = [mulai];
          const dilihat = new Set<string>();
          while (tumpuk.length > 0) {
            const n = tumpuk.pop()!;
            if (n === id) return true;
            if (dilihat.has(n)) continue;
            dilihat.add(n);
            for (const m of adj.get(n) ?? []) tumpuk.push(m);
          }
          return false;
        };
        const melingkar = inputIds.filter((iid) => mencapaiInduk(iid));
        if (melingkar.length > 0) {
          throw new HTTPException(400, {
            message: `Resep melingkar: ${melingkar
              .map((iid) => namaById.get(iid) ?? iid)
              .join(", ")} — bahan itu (langsung/tak langsung) sudah memakai bahan ini`,
          });
        }
      }
      await db.transaction(async (tx) => {
        // Re-cek DI DALAM transaksi (kunci baris): PUT /bahan bisa flip
        // pengadaan ke "beli" di sela validasi di atas (TOCTOU) — tanpa ini
        // resep yatim tertulis utk bahan non-produksi. FOR UPDATE menahan
        // flip paralel sampai transaksi ini selesai.
        const [indukTx] = await tx
          .select({ pengadaan: ingredients.pengadaan })
          .from(ingredients)
          .where(and(eq(ingredients.id, id), eq(ingredients.companyId, auth.company_id!)))
          .for("update");
        if (indukTx?.pengadaan !== "produksi") {
          throw new HTTPException(409, {
            message: "Jenis pengadaan bahan berubah — muat ulang lalu coba lagi",
          });
        }
        await tx.delete(ingredientComponents).where(eq(ingredientComponents.ingredientId, id));
        if (inputIds.length > 0) {
          await tx.insert(ingredientComponents).values(
            [...qtyByInput].map(([inputIngredientId, qty]) => ({
              ingredientId: id,
              inputIngredientId,
              qty,
            })),
          );
        }
      });
      return c.json({ ok: true, jumlah: inputIds.length });
    },
  )
  .delete("/:id", requireRole("owner", "admin"), async (c) => {
    const auth = c.get("auth");
    const id = c.req.param("id");
    // Kepemilikan dicek DULU (404): guard "masih dipakai" di bawah tanpa cek
    // ini menjadi oracle lintas-tenant (bocor nama menu/bahan tenant lain).
    const [milik] = await db
      .select({ id: ingredients.id })
      .from(ingredients)
      .where(and(eq(ingredients.id, id), eq(ingredients.companyId, auth.company_id!)));
    if (!milik) throw new HTTPException(404, { message: "Bahan tidak ditemukan" });
    // Blokir bila masih dipakai menu aktif
    const used = await db
      .select({ nama: menus.nama })
      .from(menuComponents)
      .innerJoin(menus, eq(menuComponents.menuId, menus.id))
      .where(and(eq(menuComponents.ingredientId, id), eq(menus.isActive, true)))
      .limit(5);
    if (used.length > 0) {
      throw new HTTPException(409, {
        message: `Bahan masih dipakai menu aktif: ${used.map((u) => u.nama).join(", ")}`,
      });
    }
    // Blokir bila masih dipakai resep produksi bahan lain yang aktif
    const dipakaiResep = await db
      .select({ nama: ingredients.nama })
      .from(ingredientComponents)
      .innerJoin(ingredients, eq(ingredientComponents.ingredientId, ingredients.id))
      .where(
        and(eq(ingredientComponents.inputIngredientId, id), eq(ingredients.isActive, true)),
      )
      .limit(5);
    if (dipakaiResep.length > 0) {
      throw new HTTPException(409, {
        message: `Bahan masih dipakai resep produksi: ${dipakaiResep.map((u) => u.nama).join(", ")}`,
      });
    }
    const [row] = await db
      .update(ingredients)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(ingredients.id, id), eq(ingredients.companyId, auth.company_id!)))
      .returning();
    if (!row) throw new HTTPException(404, { message: "Bahan tidak ditemukan" });
    return c.json({ ok: true });
  });

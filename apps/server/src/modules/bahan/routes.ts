import { zValidator } from "../../lib/validator";
import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  hargaPerUnit,
  type BahanDetailDto,
  type BahanDto,
  type BahanLangkahRow,
  type BahanResepRow,
  type BahanSupplierDto,
  type RakLokasi,
  type RiwayatHargaDto,
  type RiwayatHargaLot,
} from "@kakarut/shared";
import { kunciAntrean } from "../../lib/kunci";
import { alasanGagalBaris, bentrokUnikPada, tanpaBentrok } from "../../lib/pg-galat";
import { db } from "../../db/client";
import {
  branches,
  companies,
  dokumenNomor,
  ingredientComponents,
  ingredientProduksiBranches,
  ingredientSteps,
  ingredientSuppliers,
  ingredients,
  menuComponents,
  menus,
  productions,
  storageLocationIngredients,
  storageLocations,
  suppliers,
} from "../../db/schema";
import { statistikHargaLots } from "../../lib/harga-stats";
import { requireRole, type AppEnv } from "../../middleware/auth";
import { saldoBahanPerCabang } from "../stok/service";
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
  /** lokasi produksi bahan jalur produksi: Central Kitchen atau cabang store */
  produksi_di: z.enum(["ck", "cabang"]).default("ck"),
  /** divisi pelaksana saat produksi_di="cabang": kitchen (default) / bar */
  divisi_produksi: z.enum(["kitchen", "bar"]).default("kitchen"),
  /** cabang PRODUSEN saat produksi_di="cabang" (kosong = semua cabang store) */
  produksi_branch_ids: z.array(z.string().uuid()).max(100).default([]),
  catatan: z.string().nullish(),
  is_packaging: z.boolean().default(false),
  is_complement: z.boolean().default(false),
  /** boleh dibeli eceran per pcs; false = pembulatan per kemasan `isi` (jalur beli) */
  boleh_eceran: z.boolean().default(false),
  /** minimal belanja (MOQ) saat belanja otomatis; 0 = tanpa minimum */
  min_beli: z.number().nonnegative().default(0),
  /** masa simpan (hari) setelah masuk stok — dasar exp otomatis lot; 0 = tak diatur */
  masa_simpan_hari: z.number().int().min(0).max(3650).default(0),
  /** lead time (hari): beli = lama pesanan datang; produksi = lama proses; 0 = tanpa info */
  lead_time_hari: z.number().int().min(0).max(365).default(0),
  /** foto bahan jadi & foto cara packing (URL hasil POST /upload?tujuan=resep) */
  foto_hasil_url: z.string().trim().max(500).nullish(),
  foto_packing_url: z.string().trim().max(500).nullish(),
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
  produksi_di: z.enum(["ck", "cabang"]).optional(),
  divisi_produksi: z.enum(["kitchen", "bar"]).optional(),
  produksi_branch_ids: z.array(z.string().uuid()).max(100).optional(),
  catatan: z.string().nullish(),
  is_packaging: z.boolean().optional(),
  is_complement: z.boolean().optional(),
  boleh_eceran: z.boolean().optional(),
  min_beli: z.number().nonnegative().optional(),
  masa_simpan_hari: z.number().int().min(0).max(3650).optional(),
  lead_time_hari: z.number().int().min(0).max(365).optional(),
  foto_hasil_url: z.string().trim().max(500).nullish(),
  foto_packing_url: z.string().trim().max(500).nullish(),
});

const ResepBody = z.object({
  komponen: z
    .array(z.object({ ingredient_id: z.string().uuid(), qty: z.number().positive() }))
    .default([]),
  /**
   * TAKARAN BATCH — ditulis dalam TRANSAKSI YANG SAMA dengan komponennya.
   *
   * Biaya per satuan bahan produksi lahir dari PASANGAN: resepnya (komponen di
   * atas) dibagi `isi`, dikali `overhead_x`. Selama ini layar Resep menyimpan
   * keduanya lewat DUA permintaan berurutan — komponen dulu, lalu takarannya
   * lewat `PUT /bahan/:id`. Kalau yang kedua gagal, yang pertama sudah
   * mendarat: resep BARU dibagi `isi` LAMA. Angkanya tidak kelihatan salah,
   * cuma salah — dan bukan hanya bagi si pengedit: HPP setiap menu yang
   * memakai bahan ini ikut keliru sampai ada yang menyimpan ulang.
   *
   * Yang dipindahkan ke sini HANYA yang bisa membuat model biaya bertentangan
   * dengan dirinya sendiri. Foto, stok minimum, lead time, dan cara masak
   * tetap lewat endpointnya masing-masing: kegagalannya menyisakan tampilan
   * yang basi, bukan angka yang bohong.
   */
  atur: z
    .object({
      isi: z.number().positive().optional(),
      overhead_x: z.number().positive().max(1000).optional(),
      harga_beli: z.number().nonnegative().optional(),
    })
    .optional(),
});

/** Langkah cara masak bahan produksi — urutan array = urutan langkah. */
const LangkahBody = z.object({
  langkah: z
    .array(
      z.object({
        teks: z.string().trim().min(1).max(1000),
        foto_url: z.string().trim().max(500).nullish(),
      }),
    )
    .max(30)
    .default([]),
});

/** Satu baris "tambah bahan baku" (bulk) — selalu jalur beli. Field set penuh
 * (sama dengan form Ubah): min_beli, kemasan/complement, catatan. Rak simpan
 * diatur terpisah di Tempat Penyimpanan (per cabang), bukan di sini. */
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
  min_beli: z.number().nonnegative().default(0),
  masa_simpan_hari: z.number().int().min(0).max(3650).default(0),
  lead_time_hari: z.number().int().min(0).max(365).default(0),
  is_packaging: z.boolean().default(false),
  is_complement: z.boolean().default(false),
  catatan: z.string().nullish(),
});
const BahanBulkBody = z.object({ items: z.array(BahanBulkRow).min(1).max(200) });

/**
 * Satu baris impor CSV (nilai sudah dikoersi di web).
 *
 * Field selain `nama` sengaja `.optional()` TANPA `.default()`: absennya harus
 * tetap absen sampai ke rutenya, karena di sanalah ia dibedakan dari nilai
 * yang memang dikirim.
 *
 *   - dikirim (termasuk `false`/`0`/`null`) → ditulis; itu perintah yang sah;
 *   - tidak dikirim → pada bahan LAMA dibiarkan, pada bahan BARU baru dipakai
 *     default (ditulis eksplisit di jalur insert di bawah).
 *
 * Dengan `.default()` keduanya tak bisa dibedakan lagi — zod mengisi nilainya
 * sebelum rute sempat melihat, dan berkas CSV yang cuma punya kolom
 * `nama,harga_beli` menimpa seluruh kolom lain milik tiap bahan yang cocok.
 */
const BahanImportRowBody = z.object({
  kode: z.string().trim().max(20).nullish(),
  nama: z.string().trim().min(1),
  kategori: z.string().trim().min(1).max(30).optional(),
  jenis: z.enum(["produksi", "beli"]).optional(),
  harga_beli: z.number().nonnegative().optional(),
  isi: z.number().positive().optional(),
  satuan: z.string().trim().min(1).max(20).optional(),
  satuan_beli: z.string().trim().max(20).nullish(),
  stok_minimum: z.number().nonnegative().optional(),
  min_beli: z.number().nonnegative().optional(),
  boleh_eceran: z.boolean().optional(),
  lacak_stok: z.boolean().optional(),
  kemasan: z.boolean().optional(),
  complement: z.boolean().optional(),
  masa_simpan_hari: z.number().int().min(0).max(3650).optional(),
  lead_time_hari: z.number().int().min(0).max(365).optional(),
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

/**
 * "DI SIMPAN DI MANA" per bahan: daftar rak (per cabang CK/store) tempat bahan
 * disimpan — dari penugasan di Tempat Penyimpanan (storage_location_ingredients).
 * Dipakai read-only di kolom "Rak simpan" daftar Bahan Baku.
 */
async function rakLokasiByBahan(companyId: string): Promise<Map<string, RakLokasi[]>> {
  const rows = await db
    .select({
      ingredientId: storageLocationIngredients.ingredientId,
      rakId: storageLocations.id,
      rakNama: storageLocations.nama,
      branchId: branches.id,
      branchNama: branches.nama,
      branchTipe: branches.tipe,
    })
    .from(storageLocationIngredients)
    .innerJoin(storageLocations, eq(storageLocations.id, storageLocationIngredients.storageLocationId))
    .innerJoin(branches, eq(branches.id, storageLocations.branchId))
    // tabel sli kini juga memuat perlengkapan (supply_id) — batasi ke bahan baku
    .where(
      and(
        eq(storageLocationIngredients.companyId, companyId),
        isNotNull(storageLocationIngredients.ingredientId),
      ),
    )
    .orderBy(asc(branches.tipe), asc(branches.nama), asc(storageLocations.nama));
  const map = new Map<string, RakLokasi[]>();
  for (const r of rows) {
    if (!r.ingredientId) continue;
    const list = map.get(r.ingredientId) ?? [];
    list.push({
      branch_id: r.branchId,
      branch_nama: r.branchNama,
      branch_tipe: r.branchTipe,
      rak_id: r.rakId,
      rak_nama: r.rakNama,
    });
    map.set(r.ingredientId, list);
  }
  return map;
}

/** Daftar cabang produsen per bahan (produksi_di="cabang"; kosong = semua). */
async function produsenByBahan(companyId: string): Promise<Map<string, string[]>> {
  const rows = await db
    .select({
      ingredientId: ingredientProduksiBranches.ingredientId,
      branchId: ingredientProduksiBranches.branchId,
    })
    .from(ingredientProduksiBranches)
    .innerJoin(ingredients, eq(ingredients.id, ingredientProduksiBranches.ingredientId))
    .where(eq(ingredients.companyId, companyId));
  const map = new Map<string, string[]>();
  for (const r of rows) {
    const list = map.get(r.ingredientId) ?? [];
    list.push(r.branchId);
    map.set(r.ingredientId, list);
  }
  return map;
}

/** Cabang produsen wajib cabang TOKO (store) aktif milik company — 400 bila tidak. */
async function pastikanCabangProdusen(companyId: string, ids: string[]): Promise<string[]> {
  const unik = [...new Set(ids)];
  if (unik.length === 0) return unik;
  const rows = await db
    .select({ id: branches.id })
    .from(branches)
    .where(
      and(
        eq(branches.companyId, companyId),
        inArray(branches.id, unik),
        eq(branches.tipe, "store"),
        eq(branches.isActive, true),
      ),
    );
  if (rows.length !== unik.length) {
    throw new HTTPException(400, {
      message: "Cabang produsen harus cabang toko (store) aktif milik perusahaan",
    });
  }
  return unik;
}

/** Langkah cara masak satu bahan, urut sort_order — dipakai GET & PUT /langkah. */
async function listLangkah(ingredientId: string): Promise<BahanLangkahRow[]> {
  const rows = await db
    .select({
      id: ingredientSteps.id,
      teks: ingredientSteps.teks,
      fotoUrl: ingredientSteps.fotoUrl,
    })
    .from(ingredientSteps)
    .where(eq(ingredientSteps.ingredientId, ingredientId))
    .orderBy(asc(ingredientSteps.sortOrder));
  return rows.map((r) => ({ id: r.id, teks: r.teks, foto_url: r.fotoUrl }));
}

/** Ganti seluruh daftar cabang produsen satu bahan (kosong = semua cabang). */
async function simpanCabangProdusen(ingredientId: string, ids: string[]): Promise<void> {
  await db
    .delete(ingredientProduksiBranches)
    .where(eq(ingredientProduksiBranches.ingredientId, ingredientId));
  if (ids.length > 0) {
    await db
      .insert(ingredientProduksiBranches)
      .values(ids.map((branchId) => ({ ingredientId, branchId })));
  }
}

function toDto(
  row: typeof ingredients.$inferSelect,
  sup?: { utama: string | null; jumlah: number },
  rakLokasi: RakLokasi[] = [],
  produksiBranchIds: string[] = [],
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
    produksi_di: row.produksiDi,
    divisi_produksi: row.divisiProduksi,
    produksi_branch_ids: produksiBranchIds,
    catatan: row.catatan,
    is_packaging: row.isPackaging,
    is_complement: row.isComplement,
    boleh_eceran: row.bolehEceran,
    min_beli: row.minBeli,
    masa_simpan_hari: row.masaSimpanHari,
    lead_time_hari: row.leadTimeHari,
    foto_hasil_url: row.fotoHasilUrl,
    foto_packing_url: row.fotoPackingUrl,
    is_active: row.isActive,
    supplier_utama: sup?.utama ?? null,
    jumlah_supplier: sup?.jumlah ?? 0,
    rak_lokasi: rakLokasi,
  };
}

/**
 * Riwayat harga beli bahan baku: setiap faktur BELI yang sudah masuk stok
 * ('dikonfirmasi') = satu lot pembelian. `harga_satuan` = total_harga / qty
 * dalam satuan kerja (satuan). Rata-rata tertimbang hanya dari lot berharga.
 * Fondasi hitung HPP FIFO / rata-rata.
 */
async function riwayatHargaBahan(
  companyId: string,
  ing: typeof ingredients.$inferSelect,
): Promise<RiwayatHargaDto> {
  const rows = await db
    .select({
      id: productions.id,
      tanggal: productions.prodDate,
      qty: productions.qty,
      totalHarga: productions.totalHarga,
      hargaTebakan: productions.hargaTebakan,
      supplier: suppliers.nama,
      noFaktur: productions.noFaktur,
      nomor: dokumenNomor.nomorTeks,
    })
    .from(productions)
    .leftJoin(suppliers, eq(productions.supplierId, suppliers.id))
    .leftJoin(
      dokumenNomor,
      and(
        eq(dokumenNomor.companyId, productions.companyId),
        eq(dokumenNomor.refId, productions.fakturId),
      ),
    )
    .where(
      and(
        eq(productions.companyId, companyId),
        eq(productions.ingredientId, ing.id),
        eq(productions.tipe, "beli"),
        eq(productions.status, "dikonfirmasi"),
        isNull(productions.deletedAt),
      ),
    )
    .orderBy(desc(productions.prodDate), desc(productions.waktu));
  const lots: RiwayatHargaLot[] = rows.map((r) => ({
    id: r.id,
    tanggal: r.tanggal,
    qty: r.qty,
    total_harga: r.totalHarga,
    harga_satuan:
      r.totalHarga != null && r.qty > 0 ? Math.round((r.totalHarga / r.qty) * 100) / 100 : null,
    supplier: r.supplier,
    no_faktur: r.noFaktur,
    nomor: r.nomor,
    harga_tebakan: r.hargaTebakan,
  }));
  return {
    item: {
      id: ing.id,
      nama: ing.nama,
      satuan: ing.satuan,
      isi: ing.isi,
      satuan_beli: ing.satuanBeli,
    },
    harga_terkini: hargaPerUnit(ing.hargaBeli, ing.isi),
    // Keempat angka statistik (termasuk rata-rata tertimbang) datang dari SATU
    // tempat, dan tempat itu yang mengeluarkan lot tebakan — lihat catatan di
    // `statistikHargaLots`. Menghitung salah satunya di sini lagi persis
    // kesalahan yang baru saja dicabut.
    ...statistikHargaLots(lots),
    jumlah_pembelian: lots.length,
    lots,
  };
}

export const bahanRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const auth = c.get("auth");
    // ?arsip=1 — bahan TERARSIP (nonaktif) untuk tab Arsip halaman Resep;
    // hanya owner/admin. Bentuk ringkas (tanpa supplier/rak) — cukup untuk
    // daftar arsip + tombol Pulihkan.
    if (c.req.query("arsip") === "1") {
      if (auth.role !== "owner" && auth.role !== "admin") {
        throw new HTTPException(403, { message: "Hanya owner/admin" });
      }
      const arsipRows = await db
        .select()
        .from(ingredients)
        .where(and(eq(ingredients.companyId, auth.company_id!), eq(ingredients.isActive, false)))
        .orderBy(asc(ingredients.nama));
      return c.json(arsipRows.map((r) => toDto(r, undefined, [], [])));
    }
    const rows = await db
      .select()
      .from(ingredients)
      .where(and(eq(ingredients.companyId, auth.company_id!), eq(ingredients.isActive, true)))
      .orderBy(asc(ingredients.nama));
    // ?ringkas=1 — varian ringan untuk halaman picker/editor yang tidak
    // menampilkan supplier maupun rak: lewati dua agregasi terberatnya.
    // produsen tetap dimuat (filter picker kitchen butuh produksi_branch_ids).
    // Bentuk DTO tetap sama: supplier_utama null, jumlah_supplier 0, rak [].
    if (c.req.query("ringkas") === "1") {
      const produsen = await produsenByBahan(auth.company_id!);
      return c.json(rows.map((r) => toDto(r, undefined, [], produsen.get(r.id) ?? [])));
    }
    const [sup, rak, produsen] = await Promise.all([
      infoSupplier(auth.company_id!),
      rakLokasiByBahan(auth.company_id!),
      produsenByBahan(auth.company_id!),
    ]);
    return c.json(
      rows.map((r) => toDto(r, sup.get(r.id), rak.get(r.id) ?? [], produsen.get(r.id) ?? [])),
    );
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
    // cabang produsen hanya relevan saat produksi_di = "cabang"
    const produsenIds =
      body.produksi_di === "cabang"
        ? await pastikanCabangProdusen(auth.company_id!, body.produksi_branch_ids)
        : [];
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
          produksiDi: body.produksi_di,
        divisiProduksi: body.divisi_produksi,
          catatan: body.catatan ?? null,
          isPackaging: body.is_packaging,
          isComplement: body.is_complement,
          bolehEceran: body.boleh_eceran,
          minBeli: body.min_beli,
          masaSimpanHari: body.masa_simpan_hari,
          leadTimeHari: body.lead_time_hari,
          fotoHasilUrl: body.foto_hasil_url ?? null,
          fotoPackingUrl: body.foto_packing_url ?? null,
          updatedAt: new Date(),
        })
        .where(and(eq(ingredients.id, existing.id), eq(ingredients.companyId, auth.company_id!)))
        .returning();
      await simpanCabangProdusen(row.id, produsenIds);
      return c.json(toDto(row, undefined, [], produsenIds), 200);
    }
    const kode = await resolveKodeBahan(db, auth.company_id!, body.kode, body.nama);
    /*
     * Pra-cek slug di atas punya jeda sebelum tulisannya; yang benar-benar
     * menjaga keunikan `ingredients_company_slug_uq`. Dua owner yang menambahkan
     * bahan bernama sama pada saat bersamaan membuat yang KALAH menabrak indeks
     * itu — 23505 mentah alias 500. Terukur, empat permintaan serentak:
     * 201, 409, 409, dan 500.
     *
     * Pesannya sengaja TANPA petunjuk lokasi `(ada di daftar Bahan Baku)` yang
     * dipakai jalur berurutan: petunjuk itu diturunkan dari `existing.pengadaan`,
     * dan di jalur balapan barisnya baru saja ditulis proses lain — membacanya
     * ulang hanya untuk memperindah pesan menambah kueri pada jalur galat tanpa
     * mengubah apa yang harus dilakukan pemakainya (pilih nama lain).
     */
    const [row] = await tanpaBentrok(
      `Bahan "${body.nama}" sudah ada`,
      () =>
        db
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
            produksiDi: body.produksi_di,
            divisiProduksi: body.divisi_produksi,
            catatan: body.catatan ?? null,
            isPackaging: body.is_packaging,
            isComplement: body.is_complement,
            bolehEceran: body.boleh_eceran,
            minBeli: body.min_beli,
            masaSimpanHari: body.masa_simpan_hari,
            leadTimeHari: body.lead_time_hari,
            fotoHasilUrl: body.foto_hasil_url ?? null,
            fotoPackingUrl: body.foto_packing_url ?? null,
          })
          .returning(),
      "ingredients_company_slug_uq",
    );
    await simpanCabangProdusen(row.id, produsenIds);
    return c.json(toDto(row, undefined, [], produsenIds), 201);
  })
  /**
   * Tambah banyak bahan baku sekaligus (halaman "Tambah Bahan Baku" multi-baris).
   * Selalu jalur BELI. Kode & slug dibuat unik lintas-baris + existing (suffix
   * bila bentrok) agar satu baris bermasalah tak menggagalkan seluruh batch.
   */
  .post("/bulk", requireRole("owner", "admin"), zValidator("json", BahanBulkBody), async (c) => {
    const auth = c.get("auth");
    const { items } = c.req.valid("json");
    const companyId = auth.company_id!;
    /*
     * SELURUHNYA di dalam satu transaksi, dan KUNCI diambil lebih dulu.
     *
     * `slugUnik` bukan pemeriksa, melainkan PENGALOKASI: ia membaca slug yang
     * terpakai lalu memilih yang berikutnya bebas ("kecap manis" dipakai →
     * "kecap manis 2"). Membaca-lalu-mengalokasi hanya benar bila tak ada yang
     * menyisip di antaranya — dan sebelum ini tak ada yang mencegah itu.
     *
     * Dua impor massal serentak yang memuat nama sama sama-sama membaca
     * "belum terpakai", sama-sama memilih slug yang sama, lalu yang kalah
     * menabrak `ingredients_company_slug_uq`. Terukur, empat permintaan
     * serentak: 201, 201, 500, 500 — sama di tiga ronde berturut-turut.
     *
     * Kerugiannya bukan cuma kode status. Berurutan, keempatnya SEHARUSNYA
     * berhasil dengan slug "x", "x 2", "x 3", "x 4"; yang terjadi dua impor
     * gagal seluruhnya. Menerjemahkan 23505 jadi 409 tak menolong di sini —
     * jawaban yang benar bukan "sudah ada", melainkan nama berikutnya.
     *
     * Karena itu kuncinya diambil atas NAMA aturan ("alokasi slug bahan milik
     * perusahaan ini"), bukan atas nama baris: baris yang diperebutkan belum
     * ada saat dibaca, jadi tak ada yang bisa dipegang `FOR UPDATE`.
     * INSERT-nya satu pernyataan, jadi transaksinya tetap pendek.
     */
    const rows = await db.transaction(async (tx) => {
      await kunciAntrean(tx, "bahan-slug", companyId);
      const existing = await tx
        .select({ slug: ingredients.slug })
        .from(ingredients)
        .where(eq(ingredients.companyId, companyId));
      const slugDipakai = new Set(existing.map((r) => r.slug.toLowerCase()));
      const slugUnik = (nama: string): string => {
        const base = nama.toLowerCase().trim().replace(/\s+/g, " ") || "bahan";
        let s = base;
        let n = 2;
        while (slugDipakai.has(s.toLowerCase())) s = `${base} ${n++}`;
        slugDipakai.add(s.toLowerCase());
        return s;
      };
      const kodes = await resolveKodeBahanBatch(tx, companyId, items);
      const kmap = await kategoriKanonikMap(tx, companyId);
      return tx
        .insert(ingredients)
        .values(
          items.map((b, i) => ({
            companyId,
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
            minBeli: b.min_beli,
            masaSimpanHari: b.masa_simpan_hari,
            leadTimeHari: b.lead_time_hari,
            isPackaging: b.is_packaging,
            isComplement: b.is_complement,
            catatan: b.catatan ?? null,
          })),
        )
        .returning();
    });
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
   *
   * "Diperbarui" berarti KOLOM YANG DIKIRIM saja. Field yang tak ada di badan
   * permintaan dibiarkan apa adanya — lihat `BahanImportRowBody`. Berkas CSV
   * yang hanya memuat sebagian kolom adalah bentuk yang paling lazim (daftar
   * harga dari supplier: `nama,harga_beli`), dan menafsirkan kolom yang absen
   * sebagai "nol/mati" menghapus data yang tak pernah disebut berkas itu.
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

    /*
     * Satu rumah untuk "terapkan baris CSV ke bahan yang SUDAH ada". Dipakai
     * dua kali: oleh gelung perbarui/pulihkan di bawah, dan oleh jalur balapan
     * di gelung sisip — baris yang ternyata sudah diciptakan proses lain.
     * Disatukan supaya kolom yang kelak ditambahkan ke impor tak bisa terpasang
     * di satu jalur saja.
     */
    const terapkanKeBarisAda = async (
      id: string,
      b: (typeof items)[number],
      pulih: boolean,
    ): Promise<void> => {
      await db
        .update(ingredients)
        .set({
          nama: b.nama,
          // Hanya kolom yang BENAR-BENAR dikirim yang ditulis. `undefined`
          // di sini bukan "kosongkan", melainkan "berkas ini tak bicara
          // soal kolom itu" — lihat komentar `BahanImportRowBody`.
          ...(b.kategori !== undefined && { kategori: kanonikKategori(kmap, b.kategori) }),
          ...(b.harga_beli !== undefined && { hargaBeli: b.harga_beli }),
          ...(b.isi !== undefined && { isi: b.isi }),
          ...(b.satuan !== undefined && { satuan: b.satuan }),
          ...(b.satuan_beli !== undefined && { satuanBeli: b.satuan_beli ?? null }),
          ...(b.stok_minimum !== undefined && { stokMinimum: b.stok_minimum }),
          ...(b.min_beli !== undefined && { minBeli: b.min_beli }),
          ...(b.masa_simpan_hari !== undefined && { masaSimpanHari: b.masa_simpan_hari }),
          ...(b.lead_time_hari !== undefined && { leadTimeHari: b.lead_time_hari }),
          ...(b.boleh_eceran !== undefined && { bolehEceran: b.boleh_eceran }),
          ...(b.lacak_stok !== undefined && { trackStok: b.lacak_stok }),
          ...(b.kemasan !== undefined && { isPackaging: b.kemasan }),
          ...(b.complement !== undefined && { isComplement: b.complement }),
          ...(b.catatan !== undefined && { catatan: b.catatan ?? null }),
          // baris pulih: aktifkan kembali dari Tempat Sampah
          ...(pulih && { isActive: true }),
          updatedAt: new Date(),
        })
        .where(and(eq(ingredients.id, id), eq(ingredients.companyId, companyId)));
    };

    for (const u of updateBaris) {
      try {
        await terapkanKeBarisAda(u.id, u.item, u.pulih);
        if (u.pulih) dipulihkan++;
        else diperbarui++;
      } catch (e) {
        gagal.push({ nama: u.item.nama, alasan: alasanGagalBaris(e, "gagal diperbarui") });
      }
    }
    for (let i = 0; i < insertBaris.length; i++) {
      const { item: b, slug } = insertBaris[i];
      try {
        // Bahan BARU: di sinilah default dipakai — tak ada nilai lama untuk
        // dibiarkan. Ditulis eksplisit karena `BahanImportRowBody` sengaja
        // tak lagi memasangnya lewat `.default()`.
        await db.insert(ingredients).values({
          companyId,
          slug,
          kode: kodes[i],
          nama: b.nama,
          hargaBeli: b.harga_beli ?? 0,
          isi: b.isi ?? 1,
          satuan: b.satuan ?? "pcs",
          satuanBeli: b.satuan_beli ?? null,
          trackStok: b.lacak_stok ?? true,
          stokMinimum: b.stok_minimum ?? 0,
          minBeli: b.min_beli ?? 0,
          masaSimpanHari: b.masa_simpan_hari ?? 0,
          leadTimeHari: b.lead_time_hari ?? 0,
          kategori: kanonikKategori(kmap, b.kategori ?? "lain"),
          pengadaan: b.jenis ?? "beli",
          bolehEceran: b.boleh_eceran ?? false,
          isPackaging: b.kemasan ?? false,
          isComplement: b.complement ?? false,
          catatan: b.catatan ?? null,
        });
        ditambah++;
      } catch (e) {
        /*
         * Klasifikasi di atas ("baris ini belum ada → sisipkan") dibaca sebelum
         * gelung ini menulis, jadi ia bisa BASI: impor lain yang berjalan
         * bersamaan sudah menciptakan slug yang sama di sela itu.
         *
         * Sebelum ini, akibatnya dilaporkan sebagai KEGAGALAN — dan pesannya
         * `(e as Error).message` mentah dari driver, yaitu seluruh teks kueri
         * INSERT beserta daftar kolomnya, dikirim apa adanya ke klien. Yang
         * mengimpor daftar harga supplier melihat dump SQL, bukan "sudah ada".
         *
         * CATATAN untuk pembaca berikutnya: perbaikan itu dulu hanya menutup
         * cabang 23505 di bawah — TIGA jalur galat lain di blok ini masih
         * membuang pesan mentah, dan komentar ini sempat membuatnya tampak
         * seperti sudah beres. Kebocorannya baru benar-benar tertutup sejak
         * semuanya lewat `alasanGagalBaris`, yang tak pernah memulangkan teks
         * driver. Terukur: `harga_beli: 1e15` pada kolom `numeric(14,2)`
         * memulangkan INSERT lengkap 30 kolom + uuid perusahaan ke klien.
         *
         * Yang benar bukan melaporkan gagal, melainkan mengklasifikasi ULANG
         * baris itu dengan data yang kini benar — persis yang akan terjadi
         * seandainya kedua impor berjalan berurutan:
         *   · mode "tambah"   → baris yang sudah ada memang DILEWATI;
         *   · mode "perbarui" → nilainya diterapkan ke baris yang sudah ada.
         * Tanpa cabang kedua itu, satu baris CSV hilang tanpa jejak di mode
         * yang justru dipakai untuk memperbarui harga.
         */
        if (bentrokUnikPada(e, "ingredients_company_slug_uq")) {
          const [kini] = await db
            .select({ id: ingredients.id, isActive: ingredients.isActive })
            .from(ingredients)
            .where(and(eq(ingredients.companyId, companyId), eq(ingredients.slug, slug)));
          if (kini) {
            if (mode === "tambah") {
              dilewati++;
              continue;
            }
            try {
              await terapkanKeBarisAda(kini.id, b, !kini.isActive);
              if (kini.isActive) diperbarui++;
              else dipulihkan++;
              continue;
            } catch (e2) {
              gagal.push({ nama: b.nama, alasan: alasanGagalBaris(e2, "gagal diperbarui") });
              continue;
            }
          }
        }
        gagal.push({ nama: b.nama, alasan: alasanGagalBaris(e, "gagal ditambah") });
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
        .select({
          isi: ingredients.isi,
          pengadaan: ingredients.pengadaan,
          produksiDi: ingredients.produksiDi,
          divisiProduksi: ingredients.divisiProduksi,
        })
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
          ...(body.produksi_di !== undefined && { produksiDi: body.produksi_di }),
          ...(body.divisi_produksi !== undefined && { divisiProduksi: body.divisi_produksi }),
          ...(body.catatan !== undefined && { catatan: body.catatan }),
          ...(body.is_packaging !== undefined && { isPackaging: body.is_packaging }),
          ...(body.is_complement !== undefined && { isComplement: body.is_complement }),
          ...(body.boleh_eceran !== undefined && { bolehEceran: body.boleh_eceran }),
          ...(body.min_beli !== undefined && { minBeli: body.min_beli }),
          ...(body.masa_simpan_hari !== undefined && { masaSimpanHari: body.masa_simpan_hari }),
          ...(body.lead_time_hari !== undefined && { leadTimeHari: body.lead_time_hari }),
          ...(body.foto_hasil_url !== undefined && { fotoHasilUrl: body.foto_hasil_url ?? null }),
          ...(body.foto_packing_url !== undefined && {
            fotoPackingUrl: body.foto_packing_url ?? null,
          }),
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
      // Daftar cabang produsen: ganti bila dikirim; bukan produksi-cabang lagi
      // → daftar tak relevan, bersihkan sisa (kosong = semua cabang).
      let produsenIds: string[];
      if (row.produksiDi !== "cabang") {
        if (lama.produksiDi === "cabang") await simpanCabangProdusen(row.id, []);
        produsenIds = [];
      } else if (body.produksi_branch_ids !== undefined) {
        produsenIds = await pastikanCabangProdusen(
          auth.company_id!,
          body.produksi_branch_ids,
        );
        await simpanCabangProdusen(row.id, produsenIds);
      } else {
        produsenIds = (
          await db
            .select({ branchId: ingredientProduksiBranches.branchId })
            .from(ingredientProduksiBranches)
            .where(eq(ingredientProduksiBranches.ingredientId, row.id))
        ).map((r) => r.branchId);
      }
      const sup = await infoSupplier(auth.company_id!, [row.id]);
      return c.json(toDto(row, sup.get(row.id), [], produsenIds));
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
        /*
         * KUNCI BARIS INDUKNYA, dan itu yang menyerialkan penulisan ini.
         *
         * "Ganti seluruh daftar" = HAPUS lalu SISIP. Saat daftarnya masih
         * kosong, HAPUS tak memegang baris apa pun — jadi dua permintaan
         * bersamaan sama-sama lolos ke SISIP dan menabrak
         * `ingredient_suppliers_pair_uq` (juga `..._utama_uq`). Yang kalah
         * menerima 23505 mentah alias 500. Terukur, empat PUT serentak
         * BERBADAN SAMA: 200, 200, 500, 500 — tiga ronde berturut-turut.
         *
         * Perhatikan permintaannya IDEMPOTEN: badan yang sama persis. Yang
         * memicunya di lapangan bukan dua admin, cukup satu klik ganda pada
         * tombol Simpan.
         *
         * Kenapa `FOR UPDATE` dan bukan kunci antrean: di sini ADA baris induk
         * yang nyata untuk dipegang, dan mengunci per-bahan tak menghalangi
         * bahan lain. (Bandingkan `petugas-tempat`, yang ditulis dari dua arah
         * tegak lurus sehingga tak punya induk bersama.) Ini juga idiom yang
         * sudah dipakai `PUT /bahan/:id/resep` di berkas yang sama.
         *
         * Sekalian menutup TOCTOU-nya: `pengadaan` diperiksa di luar transaksi,
         * dan `PUT /bahan/:id` bisa membaliknya ke "produksi" di sela itu —
         * meninggalkan baris supplier pada bahan yang tak boleh punya supplier.
         * Pemeriksaan yang sama di jalur resep memakai arah sebaliknya.
         */
        const [indukTx] = await tx
          .select({ pengadaan: ingredients.pengadaan })
          .from(ingredients)
          .where(and(eq(ingredients.id, id), eq(ingredients.companyId, auth.company_id!)))
          .for("update");
        if (indukTx?.pengadaan === "produksi") {
          throw new HTTPException(409, {
            message: "Jenis pengadaan bahan berubah — muat ulang lalu coba lagi",
          });
        }
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
   * DETAIL PRODUK satu bahan: DTO lengkap (supplier utama + rak + produsen) +
   * metode HPP perusahaan + sebaran saldo per cabang. Terbuka semua peran —
   * data yang sama dengan daftar Bahan Baku, difokuskan satu item.
   */
  .get("/:id/detail", async (c) => {
    const auth = c.get("auth");
    const [ing] = await db
      .select()
      .from(ingredients)
      .where(
        and(
          eq(ingredients.id, c.req.param("id")),
          eq(ingredients.companyId, auth.company_id!),
          eq(ingredients.isActive, true),
        ),
      );
    if (!ing) throw new HTTPException(404, { message: "Bahan tidak ditemukan" });
    const [sup, rak, produsen, [co], saldoCabang] = await Promise.all([
      infoSupplier(auth.company_id!),
      rakLokasiByBahan(auth.company_id!),
      produsenByBahan(auth.company_id!),
      db
        .select({ metodeHpp: companies.metodeHpp })
        .from(companies)
        .where(eq(companies.id, auth.company_id!)),
      saldoBahanPerCabang(auth.company_id!, c.req.param("id")),
    ]);
    const hasil: BahanDetailDto = {
      bahan: toDto(ing, sup.get(ing.id), rak.get(ing.id) ?? [], produsen.get(ing.id) ?? []),
      metode_hpp: co?.metodeHpp ?? "average",
      total_saldo: saldoCabang.reduce((t, r) => t + r.saldo, 0),
      saldo_cabang: saldoCabang,
    };
    return c.json(hasil);
  })
  /**
   * RIWAYAT HARGA beli bahan: daftar lot pembelian + harga terkini & rata-rata
   * tertimbang (fondasi HPP FIFO/average). Terbuka semua peran (info harga).
   */
  .get("/:id/pembelian", async (c) => {
    const auth = c.get("auth");
    const [ing] = await db
      .select()
      .from(ingredients)
      .where(and(eq(ingredients.id, c.req.param("id")), eq(ingredients.companyId, auth.company_id!)));
    if (!ing) throw new HTTPException(404, { message: "Bahan tidak ditemukan" });
    return c.json(await riwayatHargaBahan(auth.company_id!, ing));
  })
  /**
   * CATAT HARGA bahan (dari kartu Riwayat Harga): perbarui harga beli acuan per
   * satuan → dipakai estimasi RAB & HPP berikutnya. owner/admin.
   */
  .post(
    "/:id/harga",
    requireRole("owner", "admin"),
    zValidator(
      "json",
      z.object({
        /*
         * Per SATUAN KERJA (gram/ml/pcs), bukan per kemasan — dikalikan `isi`
         * di bawah. Kontrak itu hanya hidup di satu baris klien
         * (`RiwayatHargaModal.tsx`, yang membagi dengan `isi` sebelum
         * mengirim), jadi klien lain yang mengirim harga per KEMASAN akan
         * menyimpan `harga_beli` 1000× lipat untuk bahan gram/kg — dan HPP
         * seluruh menu yang memakainya ikut melonjak, diam-diam.
         *
         * Batas atas ini pagar, bukan penyembuh: ia menahan salah-satuan yang
         * ekstrem dan salah ketik, tapi tidak bisa membedakan 15.000/kg dari
         * 15.000/gram. Yang benar-benar menutupnya adalah field `basis`
         * eksplisit di badan permintaan — perubahan kontrak API, sengaja
         * ditinggalkan sebagai pekerjaan tersendiri. Angkanya menyamai batas
         * rupiah yang sudah dipakai jalur faktur (`produksi/routes.ts`).
         */
        harga_per_unit: z.number().nonnegative().max(1_000_000_000_000),
      }),
    ),
    async (c) => {
      const auth = c.get("auth");
      const { harga_per_unit } = c.req.valid("json");
      const [ing] = await db
        .select()
        .from(ingredients)
        .where(
          and(eq(ingredients.id, c.req.param("id")), eq(ingredients.companyId, auth.company_id!)),
        );
      if (!ing) throw new HTTPException(404, { message: "Bahan tidak ditemukan" });
      // harga_beli disimpan per KEMASAN (isi) — konversi dari harga per satuan
      const hargaBeli = Math.round(harga_per_unit * ing.isi);
      const [row] = await db
        .update(ingredients)
        .set({ hargaBeli, updatedAt: new Date() })
        .where(and(eq(ingredients.id, ing.id), eq(ingredients.companyId, auth.company_id!)))
        .returning();
      return c.json(await riwayatHargaBahan(auth.company_id!, row));
    },
  )
  /**
   * Ringkasan resep SEMUA bahan produksi sekaligus: peta ingredient_id →
   * jumlah bahan mentah. Satu query GROUP BY — menggantikan satu request
   * per bahan (N+1) dari daftar Resep di web. Bahan tanpa komponen tidak
   * muncul di peta (klien memperlakukan absen = 0).
   */
  .get("/resep-ringkas", async (c) => {
    const auth = c.get("auth");
    const rows = await db
      .select({
        ingredientId: ingredientComponents.ingredientId,
        jumlah: sql<number>`count(*)::int`,
      })
      .from(ingredientComponents)
      .innerJoin(ingredients, eq(ingredients.id, ingredientComponents.ingredientId))
      .where(and(eq(ingredients.companyId, auth.company_id!), eq(ingredients.isActive, true)))
      .groupBy(ingredientComponents.ingredientId);
    const peta: Record<string, number> = {};
    for (const r of rows) peta[r.ingredientId] = r.jumlah;
    return c.json(peta);
  })
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
      const atur = body.atur;
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
        /*
         * PINTU KEDUA ke masalah yang sama seperti `isi`.
         *
         * `catatKonsumsiProduksi` membaca resep LIVE saat produksi selesai,
         * bukan snapshot saat fakturnya dibuat. `PUT /bahan/:id` sudah menolak
         * perubahan `isi` selagi ada produksi berjalan justru karena itu — tapi
         * resepnya sendiri masih bisa ditulis ulang lewat sini, dan akibatnya
         * sama persis: faktur yang RAB-nya dihitung dengan satu resep dieksekusi
         * dengan resep yang lain. Bahan yang dikeluarkan dari resep berhenti
         * dipotong sama sekali; yang ditambahkan dipotong tanpa pernah masuk
         * perhitungan biaya. Stok bahan mentah melenceng tanpa satu pun baris
         * yang menerangkannya.
         *
         * Jendelanya persis sama dengan penjaga `isi`: 'rencana' dan
         * 'dikerjakan'. Baris yang sudah 'menunggu' konsumsinya SUDAH tercatat
         * (transisinya yang memanggil `catatKonsumsiProduksi`), jadi resep baru
         * tak lagi menyentuhnya — dan melarang edit di situ hanya akan
         * menghalangi tanpa melindungi apa pun.
         *
         * Di dalam transaksi & sesudah `FOR UPDATE` di atas: memeriksanya di
         * luar menyisakan jendela untuk faktur yang lahir di sela pemeriksaan
         * dan penulisan.
         */
        const [produksiBerjalan] = await tx
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
        if (produksiBerjalan) {
          throw new HTTPException(409, {
            message:
              "Resep tidak bisa diubah saat masih ada produksi berjalan — selesaikan produksinya dulu",
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
        // Takaran batch ikut DI DALAM transaksi ini — itu seluruh maksudnya.
        // Ditulis SESUDAH komponennya supaya keduanya berbagi satu nasib:
        // kalau baris ini gagal, penghapusan & penulisan komponen di atas ikut
        // dibatalkan, dan resep lama tetap utuh bersama takaran lamanya.
        const setAtur = {
          ...(atur?.isi !== undefined && { isi: atur.isi }),
          ...(atur?.overhead_x !== undefined && { overheadX: atur.overhead_x }),
          ...(atur?.harga_beli !== undefined && { hargaBeli: atur.harga_beli }),
        };
        if (Object.keys(setAtur).length > 0) {
          await tx
            .update(ingredients)
            .set({ ...setAtur, updatedAt: new Date() })
            .where(and(eq(ingredients.id, id), eq(ingredients.companyId, auth.company_id!)));
        }
      });
      return c.json({ ok: true, jumlah: inputIds.length });
    },
  )
  // Langkah CARA MASAK bahan produksi: teks berurutan + foto proses opsional.
  // BACA terbuka utk semua role (kitchen/bar/tim CK butuh saat memproduksi);
  // TULIS owner/admin, replace-whole-list — urutan array = urutan langkah.
  .get("/:id/langkah", async (c) => {
    const auth = c.get("auth");
    const id = c.req.param("id");
    const [milik] = await db
      .select({ id: ingredients.id })
      .from(ingredients)
      .where(and(eq(ingredients.id, id), eq(ingredients.companyId, auth.company_id!)));
    if (!milik) throw new HTTPException(404, { message: "Bahan tidak ditemukan" });
    return c.json(await listLangkah(id));
  })
  .put(
    "/:id/langkah",
    requireRole("owner", "admin"),
    zValidator("json", LangkahBody),
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
          message: "Cara masak hanya untuk bahan berjenis produksi",
        });
      }
      await db.transaction(async (tx) => {
        // Re-cek dalam transaksi (FOR UPDATE): PUT /bahan bisa flip pengadaan
        // ke "beli" di sela validasi — tanpa ini langkah yatim tertulis.
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
        await tx.delete(ingredientSteps).where(eq(ingredientSteps.ingredientId, id));
        if (body.langkah.length > 0) {
          await tx.insert(ingredientSteps).values(
            body.langkah.map((l, i) => ({
              ingredientId: id,
              sortOrder: i,
              teks: l.teks,
              fotoUrl: l.foto_url ?? null,
            })),
          );
        }
      });
      return c.json(await listLangkah(id));
    },
  )
  // Pulihkan bahan terarsip (kebalikan DELETE): aktif kembali di semua daftar.
  // Slug aman dari duplikat — POST /bahan me-reuse baris nonaktif ber-slug sama,
  // jadi tidak pernah ada dua baris (aktif+arsip) dengan slug identik.
  .post("/:id/pulihkan", requireRole("owner", "admin"), async (c) => {
    const auth = c.get("auth");
    const id = c.req.param("id");
    const [row] = await db
      .update(ingredients)
      .set({ isActive: true, updatedAt: new Date() })
      .where(
        and(
          eq(ingredients.id, id),
          eq(ingredients.companyId, auth.company_id!),
          eq(ingredients.isActive, false),
        ),
      )
      .returning();
    if (!row) throw new HTTPException(404, { message: "Bahan arsip tidak ditemukan" });
    return c.json({ ok: true });
  })
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
    /**
     * BLOKIR BILA MENJUAL MENU AKTIF MANA PUN MASIH MEMAKAN BAHAN INI.
     *
     * "Dipakai" harus berarti hal yang sama di sini dan di kasir. Penjaga ini
     * dulu hanya melihat menu yang komponennya memuat bahan ini DAN aktif
     * sendiri — sementara `komponenEfektif` (yang benar-benar memotong stok
     * saat menjual) memulangkan komponen menu ITU SENDIRI **ditambah** komponen
     * MENU DASARNYA bila ia paket. Satu tingkat yang tak ikut terlihat, dan
     * tepat di situ lubangnya:
     *
     *   paket P (aktif) → menu dasar A (DIARSIPKAN) → bahan B
     *
     * A diarsipkan tidak merusak apa pun — `loadKatalog` sengaja memuat menu
     * nonaktif justru supaya paket tetap utuh, dan itu terbukti: sesudah A
     * diarsip, HPP P tetap dan sisa porsinya tetap terhitung dari saldo B.
     * Yang merusak adalah langkah BERIKUTNYA: karena A tak lagi aktif,
     * penjaga ini meloloskan penghapusan B.
     *
     * Sesudah itu tak ada satu pun galat, dan tiga hal salah sekaligus:
     *
     *   1. B lenyap dari SETIAP layar stok (`hitungSaldoCabang` menyaring
     *      `is_active`) — tak bisa dilihat, tak bisa di-opname, tak bisa
     *      dibelanjakan.
     *   2. Sisa porsi P berubah dari angka menjadi `null`. `bahanPembatas`
     *      sengaja melewati bahan tanpa saldo ("nonaktif … diabaikan"), dan
     *      bila B satu-satunya pembatas, P jadi tak punya pembatas sama
     *      sekali — layar membacanya "tidak dibatasi bahan", yaitu boleh
     *      dijual sebanyak apa pun.
     *   3. Menjual P TETAP mengonsumsi B, karena jalur penjualan memang tak
     *      menyaring bahan nonaktif.
     *
     * Terukur: stok 100 pcs, kasir menjual 60 paket (butuh 120) — LOLOS, dan
     * saldo B mendarat di −20 yang tak muncul di mana pun.
     *
     * Maka syaratnya disamakan dengan kenyataan penjualan: menu yang memuat
     * bahan ini menghalangi penghapusan bila ia aktif ATAU ia menjadi dasar
     * sebuah paket yang aktif.
     */
    const paket = alias(menus, "paket_aktif");
    const used = await db
      .select({ nama: menus.nama, aktif: menus.isActive, paket: paket.nama })
      .from(menuComponents)
      .innerJoin(menus, eq(menuComponents.menuId, menus.id))
      .leftJoin(
        paket,
        and(
          eq(paket.baseMenuId, menus.id),
          eq(paket.tipe, "paket"),
          eq(paket.isActive, true),
        ),
      )
      .where(
        and(
          eq(menuComponents.ingredientId, id),
          or(eq(menus.isActive, true), isNotNull(paket.id)),
        ),
      )
      .limit(5);
    if (used.length > 0) {
      // Yang disebut adalah menu yang benar-benar HIDUP. Menyebut menu dasar
      // yang sudah diarsipkan membuat penolakan ini terbaca mustahil: yang
      // membacanya membuka daftar menu, tak menemukannya, lalu menyimpulkan
      // sistemnya salah.
      const dipakai = used.map((u) =>
        !u.aktif && u.paket ? `${u.paket} (lewat menu dasarnya "${u.nama}")` : u.nama,
      );
      throw new HTTPException(409, {
        message: `Bahan masih dipakai menu aktif: ${[...new Set(dipakai)].join(", ")}`,
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

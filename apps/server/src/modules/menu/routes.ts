import { zValidator } from "../../lib/validator";
import { tanpaBentrok } from "../../lib/pg-galat";
import { BATAS_FAKTOR, BATAS_HARGA, BATAS_QTY_RESEP, BATAS_QTY_STOK, BATAS_URUTAN } from "../../lib/batas-angka";
import { and, desc, eq, inArray, isNotNull, isNull, max, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  PANDUAN_MARKUP,
  type AnalisisHargaRow,
  type MenuPriceLogRow,
  type PenyumbangHpp,
  type SebabHargaMenu,
  type TerapkanSaranHasil,
} from "@kakarut/shared";
import { db, type Tx } from "../../db/client";
import {
  branches,
  companies,
  ingredients,
  menuBranches,
  menuComponents,
  menuPriceLogs,
  menus,
  productions,
  users,
} from "../../db/schema";
import { requireRole, resolveBranchId, terikatCabang, type AppEnv, cabangDariQuery} from "../../middleware/auth";
import {
  ketersediaanMenu,
  komponenEfektif,
  loadKatalog,
  resolveKode,
  tampilDiCabang,
  toMenuDto,
} from "./service";

const KomponenBody = z.object({
  ingredient_id: z.string().uuid(),
  // Kolomnya `menu_components.qty` = numeric(12,4), BUKAN numeric(16,6) milik
  // stok. Batas stok di sini meloloskan nilai yang mustahil disimpan.
  qty: z.number().positive().max(BATAS_QTY_RESEP),
});

const MenuCreateBody = z.object({
  nama: z.string().trim().min(1),
  kode: z.string().trim().max(20).nullish(),
  /** isi menu untuk PEMBELI (bukan resep) — "" disimpan sebagai null */
  deskripsi: z.string().trim().max(500).nullish(),
  category_id: z.string().uuid(),
  tipe: z.enum(["regular", "paket"]).default("regular"),
  mult: z.number().nonnegative().max(BATAS_FAKTOR).nullish(),
  base_menu_id: z.string().uuid().nullish(),
  base_mult: z.number().nonnegative().max(BATAS_FAKTOR).nullish(),
  harga_jual: z.number().nonnegative().max(BATAS_HARGA),
  image_url: z.string().nullish(),
  /**
   * Target waktu penyajian (DETIK). null = tak ditetapkan → laporan durasi
   * tak menilai menu ini. Batas atasnya 24 jam: target yang lebih panjang
   * dari sehari pasti salah satuan, dan salah satuan di sini menghasilkan
   * laporan yang selamanya berkata "aman".
   */
  target_durasi_detik: z.number().int().min(1).max(86_400).nullish(),
  komponen: z.array(KomponenBody).max(200).default([]),
  is_active: z.boolean().default(true),
  /** pembatasan lokasi (mode Pro) — null/[] = tampil di semua cabang */
  branch_ids: z.array(z.string().uuid()).max(100).nullish(),
}).strict();

/**
 * PUT = PERBARUI SEBAGIAN. Field yang tidak dikirim DIPERTAHANKAN apa adanya.
 *
 * Dulu PUT memakai skema yang sama dengan POST, lengkap dengan `.default()`.
 * Akibatnya klien yang hanya ingin mengganti harga — misalnya aplikasi mobile
 * yang tak menyimpan resep — ikut MENGHAPUS seluruh resep menu (`komponen`
 * default `[]`), menghapus foto (`image_url` tak dikirim → null), dan
 * MENGAKTIFKAN ULANG menu yang sudah diarsipkan (`is_active` default `true`).
 * Sekarang tak ada satu pun `.default()` di sini: `undefined` berarti "jangan
 * sentuh", sedangkan `null`/`[]` tetap berarti "kosongkan" — pola yang memang
 * sudah dipakai `branch_ids` sejak awal.
 *
 * Klien lama yang mengirim body penuh berperilaku persis sama seperti dulu.
 */
const MenuUpdateBody = z.object({
  nama: z.string().trim().min(1).optional(),
  /** undefined = pertahankan kode lama; ""/null = generate ulang dari nama */
  kode: z.string().trim().max(20).nullish(),
  /** undefined = deskripsi lama tetap; ""/null = kosongkan */
  deskripsi: z.string().trim().max(500).nullish(),
  category_id: z.string().uuid().optional(),
  tipe: z.enum(["regular", "paket"]).optional(),
  mult: z.number().nonnegative().max(BATAS_FAKTOR).nullish(),
  base_menu_id: z.string().uuid().nullish(),
  base_mult: z.number().nonnegative().max(BATAS_FAKTOR).nullish(),
  harga_jual: z.number().nonnegative().max(BATAS_HARGA).optional(),
  /** undefined = foto lama tetap; null = hapus foto */
  image_url: z.string().nullish(),
  /** undefined = target lama tetap; null = hapus target */
  target_durasi_detik: z.number().int().min(1).max(86_400).nullish(),
  /** undefined = resep lama tetap; [] = kosongkan resep */
  komponen: z.array(KomponenBody).max(200).optional(),
  is_active: z.boolean().optional(),
  /** undefined = pembatasan lama tetap; null/[] = tampil di semua cabang */
  branch_ids: z.array(z.string().uuid()).max(100).nullish(),
}).strict();

/** Nilai menu setelah body PUT digabung dengan baris lama (POST: body apa adanya). */
type MenuEfektif = z.infer<typeof MenuCreateBody>;

const UrutanBody = z.object({
  items: z.array(z.object({ id: z.string().uuid(), sort_order: z.number().int().max(BATAS_URUTAN) })).max(2000),
}).strict();

/**
 * Teks opsional → null bila kosong. Tanpa ini, klien yang mengirim `""` untuk
 * "hapus deskripsi" akan menyimpan string kosong, dan setiap pembaca harus
 * memeriksa dua bentuk "tidak ada" (null DAN "").
 */
function teksAtauNull(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

function validatePaket(body: MenuEfektif) {
  if (body.tipe === "paket" && (!body.base_menu_id || body.base_mult == null)) {
    throw new HTTPException(400, {
      message: "Menu paket wajib punya menu dasar (base_menu_id) dan base_mult",
    });
  }
  if (body.tipe === "regular" && body.mult == null) {
    throw new HTTPException(400, { message: "Menu reguler wajib punya mult (markup)" });
  }
}

/** Semua referensi (bahan komponen, menu dasar) harus milik perusahaan pemanggil. */
async function validateRefs(
  companyId: string,
  body: MenuEfektif,
  selfId?: string,
) {
  const ids = [...new Set(body.komponen.map((k) => k.ingredient_id))];
  if (ids.length > 0) {
    const rows = await db
      .select({ id: ingredients.id })
      .from(ingredients)
      .where(and(eq(ingredients.companyId, companyId), inArray(ingredients.id, ids)));
    if (rows.length !== ids.length) {
      throw new HTTPException(400, { message: "Ada bahan yang tidak valid" });
    }
  }
  const branchIds = [...new Set(body.branch_ids ?? [])];
  if (branchIds.length > 0) {
    const rows = await db
      .select({ id: branches.id, tipe: branches.tipe })
      .from(branches)
      .where(and(eq(branches.companyId, companyId), inArray(branches.id, branchIds)));
    if (rows.length !== branchIds.length) {
      throw new HTTPException(400, { message: "Ada cabang yang tidak valid" });
    }
    // Hanya cabang STORE yang punya kasir/POS. Central kitchen (dapur produksi)
    // & kantor bukan tempat menjual menu → tak boleh jadi lokasi tampil menu.
    const bukanStore = rows.filter((r) => r.tipe !== "store");
    if (bukanStore.length > 0) {
      throw new HTTPException(400, {
        message: "Hanya cabang store (kasir/POS) yang bisa jadi lokasi menu",
      });
    }
  }
  if (body.tipe === "paket" && body.base_menu_id) {
    if (selfId && body.base_menu_id === selfId) {
      throw new HTTPException(400, { message: "Menu dasar tidak boleh menu itu sendiri" });
    }
    const [base] = await db
      .select({ id: menus.id, tipe: menus.tipe })
      .from(menus)
      .where(and(eq(menus.id, body.base_menu_id), eq(menus.companyId, companyId)));
    if (!base || base.tipe !== "regular") {
      throw new HTTPException(400, {
        message: "Menu dasar harus menu reguler milik perusahaan Anda",
      });
    }
    /*
     * SISI SEBALIKNYA DARI ATURAN YANG SAMA — dan sisi inilah yang dulu bolong.
     *
     * "Menu dasar harus reguler" dijaga pada menu yang SEDANG disunting, tapi
     * tidak pada menu-menu yang MENUNJUK ke sana. Jadi rantai dua tingkat bisa
     * dibuat dari arah lain: buat paket P berdasar A (A masih reguler → lolos),
     * lalu ubah A sendiri jadi paket berdasar B (yang diperiksa cuma B, dan B
     * reguler → lolos juga). Hasilnya P → A → B.
     *
     * Yang membuatnya mahal: perhitungan paket SATU TINGKAT. `komponenEfektif`
     * memulangkan komponen sendiri + komponen dasarnya, berhenti di situ. Jadi
     * P kehilangan seluruh resep B — DIAM-DIAM, di dua tempat sekaligus:
     *
     *   HPP  : terukur 6.250 padahal dasarnya sudah 10.139 (38% terlalu rendah)
     *   STOK : bahan resep B tak pernah dikonsumsi saat P terjual
     *
     * Tak ada galat di titik mana pun; yang terjadi cuma stok yang terlihat
     * lebih banyak daripada isi rak, dan laba yang terlihat lebih besar
     * daripada yang benar-benar didapat.
     *
     * Pilihan perbaikannya menolak transisinya, bukan membuat perhitungannya
     * rekursif: satu tingkat itu keputusan yang disengaja (lihat
     * `komponenEfektif`), dan yang bolong hanya penegakannya.
     */
  }
  if (selfId && body.tipe === "paket") {
    const [dipakai] = await db
      .select({ nama: menus.nama })
      .from(menus)
      .where(
        and(
          eq(menus.companyId, companyId),
          eq(menus.baseMenuId, selfId),
          eq(menus.tipe, "paket"),
        ),
      )
      .limit(1);
    if (dipakai) {
      throw new HTTPException(400, {
        message: `Menu ini dipakai sebagai menu dasar paket "${dipakai.nama}" — ubah paket itu dulu sebelum menjadikan menu ini paket`,
      });
    }
  }
}

async function replaceKomponen(
  tx: Tx,
  menuId: string,
  komponen: { ingredient_id: string; qty: number }[],
) {
  await tx.delete(menuComponents).where(eq(menuComponents.menuId, menuId));
  if (komponen.length > 0) {
    // gabungkan bahan duplikat dengan menjumlah qty
    const byIngredient = new Map<string, number>();
    for (const k of komponen) {
      byIngredient.set(k.ingredient_id, (byIngredient.get(k.ingredient_id) ?? 0) + k.qty);
    }
    await tx.insert(menuComponents).values(
      [...byIngredient].map(([ingredientId, qty]) => ({ menuId, ingredientId, qty })),
    );
  }
}

/** Ganti-set pembatasan lokasi menu (null/[] = hapus semua = tampil di semua). */
async function replaceBranches(tx: Tx, menuId: string, branchIds: string[] | null | undefined) {
  await tx.delete(menuBranches).where(eq(menuBranches.menuId, menuId));
  const ids = [...new Set(branchIds ?? [])];
  if (ids.length > 0) {
    await tx.insert(menuBranches).values(ids.map((branchId) => ({ menuId, branchId })));
  }
}

/** Markup efektif sebuah menu: reguler pakai `mult`, paket pakai `base_mult`. */
function multEfektif(m: { tipe: string; mult: number | null; baseMult: number | null }) {
  return m.tipe === "paket" ? m.baseMult : m.mult;
}

/**
 * Catat perubahan harga jual menu. HPP bergerak sendiri mengikuti harga bahan,
 * jadi tanpa jejak ini tak ada cara membedakan "food cost naik karena bahan
 * mahal" dari "ada yang menurunkan harga jual" — persis pertanyaan yang sulit
 * dijawab saat food cost tiba-tiba melonjak serempak.
 */
async function catatHargaMenu(
  tx: Tx,
  row: {
    companyId: string;
    menuId: string;
    hargaLama: number | null;
    hargaBaru: number;
    multLama: number | null;
    multBaru: number | null;
    sebab: SebabHargaMenu;
    olehUserId: string | null;
  },
) {
  await tx.insert(menuPriceLogs).values(row);
}

export const menuRoutes = new Hono<AppEnv>()
  /**
   * KEBIJAKAN MARKUP perusahaan — persen per jenis kategori.
   *
   * Terukur 2026-08-26 dengan token peran `bar`: 200, dan seluruh tabelnya
   * terbaca. Rute ini punya **NOL konsumen**: web (`MenuFormPage`) dan ponsel
   * sama-sama mengimpor konstanta `PANDUAN_MARKUP` dari `@kakarut/shared`
   * secara langsung, tak satu pun lewat HTTP. Jadi menutupnya tak bisa
   * mematahkan layar mana pun — dan yang tersisa hanya keuntungannya:
   * kebijakan harga tak lagi terbaca peran mana pun yang punya token.
   */
  .get("/panduan-markup", requireRole("owner", "admin"), (c) => c.json(PANDUAN_MARKUP))
  .get("/", async (c) => {
    const auth = c.get("auth");
    const katalog = await loadKatalog(db, auth.company_id!);
    const kategoriFilter = c.req.query("kategori_id");
    const includeInactive = c.req.query("semua") === "true";
    // Kasir SELALU dibatasi menu cabangnya; owner/admin bisa memfilter via
    // ?branch_id= (tanpa param = katalog penuh untuk halaman manajemen).
    const branchFilter = terikatCabang(auth.role)
      ? auth.branch_id
      : await cabangDariQuery(c);
    const dtos = katalog.rows
      .filter((r) => (includeInactive ? true : r.isActive))
      .filter((r) => (kategoriFilter ? r.categoryId === kategoriFilter : true))
      .filter((r) => (branchFilter ? tampilDiCabang(katalog, r.id, branchFilter) : true))
      .map((r) => toMenuDto(r, katalog));
    return c.json(dtos);
  })
  // Sisa porsi tiap menu di cabang aktif (untuk info kasir "sisa 2 lagi").
  // Branch-scoped: kasir → cabangnya; owner/admin bisa pilih via ?branch_id.
  // Didaftarkan sebelum "/:id" agar tak tertangkap sebagai id.
  .get("/ketersediaan", async (c) => {
    const auth = c.get("auth");
    const branchId = await resolveBranchId(c);
    const rows = await ketersediaanMenu(auth.company_id!, branchId);
    return c.json(rows);
  })
  /**
   * ANALISIS HARGA — menjawab "kenapa food cost menu naik padahal harga jualnya
   * tidak pernah saya ubah".
   *
   * HPP TIDAK PERNAH DISIMPAN: tiap request dihitung ulang dari
   * `ingredients.harga_beli ÷ isi` saat itu juga. Karena
   * `food_cost = hpp ÷ harga_jual`, food cost bisa melonjak serempak di semua
   * menu tanpa satu pun menu disimpan ulang. Endpoint ini menyandingkan
   * `menus.updated_at` (kapan harga jual terakhir disentuh manusia) dengan
   * `ingredients.updated_at` + `MAX(productions.laporan_harga_at)` tiap bahan
   * penyumbang HPP terbesar, sehingga sumber pergerakannya kelihatan.
   *
   * Didaftarkan sebelum "/:id" agar tak tertangkap sebagai id. owner/admin.
   */
  .get("/analisis-harga", requireRole("owner", "admin"), async (c) => {
    const auth = c.get("auth");
    const includeInactive = c.req.query("semua") === "true";
    const [katalog, perusahaan, bahanRows, laporanRows] = await Promise.all([
      loadKatalog(db, auth.company_id!),
      db
        .select({ foodCostMaks: companies.foodCostMaks })
        .from(companies)
        .where(eq(companies.id, auth.company_id!)),
      db
        .select({ id: ingredients.id, updatedAt: ingredients.updatedAt })
        .from(ingredients)
        .where(eq(ingredients.companyId, auth.company_id!)),
      db
        .select({
          ingredientId: productions.ingredientId,
          terakhir: max(productions.laporanHargaAt),
        })
        .from(productions)
        .where(
          and(
            eq(productions.companyId, auth.company_id!),
            eq(productions.tipe, "beli"),
            isNotNull(productions.laporanHargaAt),
            isNull(productions.deletedAt),
          ),
        )
        .groupBy(productions.ingredientId),
    ]);
    const foodCostMaks = perusahaan[0]?.foodCostMaks ?? 40;
    const bahanDiperbarui = new Map(bahanRows.map((b) => [b.id, b.updatedAt]));
    const dilaporkanPada = new Map(laporanRows.map((r) => [r.ingredientId, r.terakhir]));

    const rows: AnalisisHargaRow[] = katalog.rows
      .filter((r) => (includeInactive ? true : r.isActive))
      .map((r) => {
        const dto = toMenuDto(r, katalog);
        // Penyumbang = komponen menu ini + (paket) komponen menu dasarnya,
        // digabung per bahan — persis himpunan yang dijumlah `hitungHargaMenu`.
        const semua = komponenEfektif(katalog, r);
        const gabung = new Map<string, PenyumbangHpp>();
        for (const k of semua) {
          const ada = gabung.get(k.ingredient_id);
          const qty = (ada?.qty ?? 0) + k.qty;
          gabung.set(k.ingredient_id, {
            ingredient_id: k.ingredient_id,
            nama: k.nama,
            qty,
            satuan: k.satuan,
            harga_per_unit: k.harga_per_unit,
            kontribusi: qty * k.harga_per_unit,
            persen_hpp: 0,
            bahan_diperbarui: (bahanDiperbarui.get(k.ingredient_id) ?? new Date()).toISOString(),
            harga_dilaporkan_pada: dilaporkanPada.get(k.ingredient_id)?.toISOString() ?? null,
          });
        }
        const penyumbang = [...gabung.values()]
          .map((p) => ({
            ...p,
            persen_hpp: dto.hpp > 0 ? (p.kontribusi / dto.hpp) * 100 : 0,
          }))
          .sort((a, b) => b.kontribusi - a.kontribusi)
          .slice(0, 5);
        return {
          ...dto,
          menu_diperbarui: r.updatedAt.toISOString(),
          food_cost_maks: foodCostMaks,
          penyumbang,
        };
      })
      // Food cost tertinggi dulu — yang paling perlu dijelaskan ada di atas.
      .sort((a, b) => b.food_cost_persen - a.food_cost_persen);
    return c.json(rows);
  })
  /**
   * Samakan harga jual sejumlah menu dengan HARGA SARAN BULAT-nya. Angka saran
   * dihitung ulang di server dari HPP terkini — nilai kiriman klien sengaja
   * tidak dipercaya, karena ini mengubah harga yang ditagih ke pembeli.
   * owner/admin.
   */
  .post(
    "/terapkan-saran",
    requireRole("owner", "admin"),
    zValidator("json", z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }).strict()),
    async (c) => {
      const auth = c.get("auth");
      const { ids } = c.req.valid("json");
      const katalog = await loadKatalog(db, auth.company_id!);
      const diminta = new Set(ids);
      const sasaran = katalog.rows.filter((r) => diminta.has(r.id));
      if (sasaran.length === 0) throw new HTTPException(404, { message: "Menu tidak ditemukan" });

      const rincian: TerapkanSaranHasil["rincian"] = [];
      await db.transaction(async (tx) => {
        for (const r of sasaran) {
          const dto = toMenuDto(r, katalog);
          const hargaBaru = dto.harga_jual_bulat;
          // Saran 0 = resep kosong / HPP nol; menurunkan harga jual ke 0 di situ
          // hampir pasti bukan yang dimaui — lewati, dan laporkan apa adanya.
          const berubah = hargaBaru > 0 && hargaBaru !== r.hargaJual;
          if (berubah) {
            await tx
              .update(menus)
              .set({ hargaJual: hargaBaru, updatedAt: new Date() })
              .where(and(eq(menus.id, r.id), eq(menus.companyId, auth.company_id!)));
            await catatHargaMenu(tx, {
              companyId: auth.company_id!,
              menuId: r.id,
              hargaLama: r.hargaJual,
              hargaBaru,
              multLama: multEfektif(r),
              multBaru: multEfektif(r),
              sebab: "terapkan_saran",
              olehUserId: auth.sub,
            });
          }
          rincian.push({
            menu_id: r.id,
            nama: r.nama,
            harga_lama: r.hargaJual,
            harga_baru: berubah ? hargaBaru : r.hargaJual,
            diperbarui: berubah,
          });
        }
      });
      const hasil: TerapkanSaranHasil = {
        diperbarui: rincian.filter((x) => x.diperbarui).length,
        dilewati: rincian.filter((x) => !x.diperbarui).length,
        rincian,
      };
      return c.json(hasil);
    },
  )
  .get("/:id", async (c) => {
    const auth = c.get("auth");
    const katalog = await loadKatalog(db, auth.company_id!);
    const row = katalog.rows.find((r) => r.id === c.req.param("id"));
    if (!row) throw new HTTPException(404, { message: "Menu tidak ditemukan" });
    return c.json(toMenuDto(row, katalog));
  })
  /** Riwayat perubahan harga jual satu menu (terbaru dulu). owner/admin. */
  .get("/:id/riwayat-harga", requireRole("owner", "admin"), async (c) => {
    const auth = c.get("auth");
    const rows = await db
      .select({
        id: menuPriceLogs.id,
        menu_id: menuPriceLogs.menuId,
        harga_lama: menuPriceLogs.hargaLama,
        harga_baru: menuPriceLogs.hargaBaru,
        mult_lama: menuPriceLogs.multLama,
        mult_baru: menuPriceLogs.multBaru,
        sebab: menuPriceLogs.sebab,
        oleh: users.nama,
        created_at: menuPriceLogs.createdAt,
      })
      .from(menuPriceLogs)
      .leftJoin(users, eq(users.id, menuPriceLogs.olehUserId))
      .where(
        and(
          eq(menuPriceLogs.companyId, auth.company_id!),
          eq(menuPriceLogs.menuId, c.req.param("id")),
        ),
      )
      .orderBy(desc(menuPriceLogs.createdAt))
      .limit(50);
    const hasil: MenuPriceLogRow[] = rows.map((r) => ({
      ...r,
      sebab: r.sebab as SebabHargaMenu,
      created_at: r.created_at.toISOString(),
    }));
    return c.json(hasil);
  })
  // Atur urutan/posisi menu (untuk tampilan kasir & cetak daftar menu).
  // Boleh diakses semua peran (termasuk kasir); company-scoped di WHERE.
  .put("/urutan", zValidator("json", UrutanBody), async (c) => {
    const auth = c.get("auth");
    const { items } = c.req.valid("json");
    if (items.length === 0) return c.json({ ok: true });
    /*
     * SATU pernyataan untuk seluruh baris, bukan satu UPDATE per baris.
     *
     * `db` adalah pg.Pool bawaan: 10 koneksi, penunggu antre selamanya.
     * Bentuk lamanya membungkus loop `for` di dalam `db.transaction`, jadi
     * satu permintaan menahan satu dari sepuluh koneksi selama N round-trip
     * berurutan — dan N ditentukan PENGIRIM. Rute ini boleh diakses semua peran
     * termasuk kasir.
     *
     * TERUKUR, 2.000 baris terhadap Postgres yang sama:
     *   2.000 UPDATE berurutan : 289 ms
     *   satu UPDATE + unnest   :  11 ms   (26×, dan cuma 3 parameter ikat)
     * dan pada sepuluh permintaan serentak, `GET /menu` yang tadinya melompat
     * ke 1,47 dtk kembali ke ukuran normalnya.
     *
     * `unnest` DUA larik, bukan daftar VALUES: jumlah parameternya tetap tiga
     * berapa pun N-nya, jadi ia tak bisa menabrak batas 65.535 parameter ikat
     * Postgres — batas yang sudah membuat `POST /penjualan` membalas 500.
     *
     * `sql.param(...)` WAJIB di sekeliling lariknya. Tanpa itu drizzle
     * memecah larik JS jadi TUPLE `($1, $2, …)` — bentuk yang berguna untuk
     * `IN (…)` tapi mustahil dicast ke `uuid[]`. Versi pertama tanpa
     * pembungkus itu membalas 500 dengan "cannot cast type record to uuid[]",
     * dan itu baru terlihat saat ditembak lewat HTTP: probe `pg` mentahnya
     * lolos, sebab di sana lariknya memang satu parameter.
     *
     * TRANSAKSINYA DIBUANG, dan itu bukan kelalaian: satu pernyataan sudah
     * atomik dengan sendirinya. Membungkusnya di transaksi hanya menambah dua
     * round-trip (BEGIN/COMMIT) tanpa menjamin apa pun yang belum dijamin.
     *
     * Pengurungan perusahaan tetap di WHERE — diuji: memakai company lain
     * menyentuh NOL baris.
     */
    await db.execute(sql`
      UPDATE ${menus}
      SET sort_order = v.so
      FROM (
        SELECT unnest(${sql.param(items.map((i) => i.id))}::uuid[]) AS id,
               unnest(${sql.param(items.map((i) => i.sort_order))}::int[]) AS so
      ) AS v
      WHERE ${menus.id} = v.id AND ${menus.companyId} = ${auth.company_id!}
    `);
    return c.json({ ok: true });
  })
  .post("/", requireRole("owner", "admin"), zValidator("json", MenuCreateBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    validatePaket(body);
    await validateRefs(auth.company_id!, body);
    const row = await db.transaction(async (tx) => {
      // kode: manual bila diisi; kosong → generate otomatis dari nama (unik)
      const kode = await resolveKode(tx, auth.company_id!, body.kode, body.nama);
      const [menu] = await tx
        .insert(menus)
        .values({
          companyId: auth.company_id!,
          categoryId: body.category_id,
          nama: body.nama,
          kode,
          deskripsi: teksAtauNull(body.deskripsi),
          tipe: body.tipe,
          mult: body.tipe === "regular" ? body.mult : null,
          baseMenuId: body.tipe === "paket" ? body.base_menu_id : null,
          baseMult: body.tipe === "paket" ? body.base_mult : null,
          hargaJual: body.harga_jual,
          imageUrl: body.image_url ?? null,
          targetDurasiDetik: body.target_durasi_detik ?? null,
          isActive: body.is_active,
        })
        .onConflictDoNothing()
        .returning();
      if (!menu) throw new HTTPException(409, { message: `Menu "${body.nama}" sudah ada` });
      await replaceKomponen(tx, menu.id, body.komponen);
      await replaceBranches(tx, menu.id, body.branch_ids);
      // Baris pembuka riwayat harga (harga_lama null) — supaya nanti terlihat
      // apakah harga jual pernah bergerak sama sekali sejak menu dibuat.
      await catatHargaMenu(tx, {
        companyId: auth.company_id!,
        menuId: menu.id,
        hargaLama: null,
        hargaBaru: menu.hargaJual,
        multLama: null,
        multBaru: multEfektif(menu),
        sebab: "buat",
        olehUserId: auth.sub,
      });
      return menu;
    });
    const katalog = await loadKatalog(db, auth.company_id!);
    return c.json(toMenuDto(katalog.rows.find((r) => r.id === row.id)!, katalog), 201);
  })
  .put(
    "/:id",
    requireRole("owner", "admin"),
    zValidator("json", MenuUpdateBody),
    async (c) => {
      const auth = c.get("auth");
      const body = c.req.valid("json");
      const id = c.req.param("id");
      const row = await db.transaction(async (tx) => {
        // Nilai SEBELUM diubah. Dipakai dua hal: (1) mengisi field yang tidak
        // dikirim klien, (2) memutuskan apakah perlu mencatat riwayat harga
        // (menyimpan ulang foto/resep saja bukan perubahan harga).
        const [lama] = await tx
          .select({
            nama: menus.nama,
            kode: menus.kode,
            deskripsi: menus.deskripsi,
            categoryId: menus.categoryId,
            tipe: menus.tipe,
            hargaJual: menus.hargaJual,
            mult: menus.mult,
            baseMenuId: menus.baseMenuId,
            baseMult: menus.baseMult,
            imageUrl: menus.imageUrl,
            targetDurasiDetik: menus.targetDurasiDetik,
            isActive: menus.isActive,
          })
          .from(menus)
          .where(and(eq(menus.id, id), eq(menus.companyId, auth.company_id!)));
        if (!lama) throw new HTTPException(404, { message: "Menu tidak ditemukan" });

        // `??` sengaja dipakai (bukan `||`): harga_jual 0 dan is_active false
        // adalah nilai sah yang harus lolos, hanya undefined yang jatuh ke lama.
        const efektif: MenuEfektif = {
          nama: body.nama ?? lama.nama,
          kode: body.kode === undefined ? lama.kode : body.kode,
          deskripsi: body.deskripsi === undefined ? lama.deskripsi : body.deskripsi,
          category_id: body.category_id ?? lama.categoryId,
          tipe: body.tipe ?? (lama.tipe as MenuEfektif["tipe"]),
          mult: body.mult === undefined ? lama.mult : body.mult,
          base_menu_id: body.base_menu_id === undefined ? lama.baseMenuId : body.base_menu_id,
          base_mult: body.base_mult === undefined ? lama.baseMult : body.base_mult,
          harga_jual: body.harga_jual ?? lama.hargaJual,
          image_url: body.image_url === undefined ? lama.imageUrl : body.image_url,
          target_durasi_detik:
            body.target_durasi_detik === undefined
              ? lama.targetDurasiDetik
              : body.target_durasi_detik,
          // hanya resep yang dikirim yang perlu divalidasi; resep lama sudah
          // tervalidasi saat disimpan dan tidak ikut ditulis ulang di bawah
          komponen: body.komponen ?? [],
          is_active: body.is_active ?? lama.isActive,
          branch_ids: body.branch_ids,
        };
        validatePaket(efektif);
        await validateRefs(auth.company_id!, efektif, id);

        // kode: manual bila diisi; kosong → generate otomatis dari nama (unik)
        const kode = await resolveKode(tx, auth.company_id!, efektif.kode, efektif.nama, id);
        // Pintu SAUDARANYA (POST /, delapan puluh baris di atas) sudah dijaga
        // `onConflictDoNothing` + 409 "Menu sudah ada" — pintu ganti-nama ini
        // tidak. Terukur lewat HTTP: mengganti nama menu B menjadi nama menu A
        // — dua permintaan BERURUTAN, tanpa balapan — dibalas 500 "Terjadi
        // kesalahan pada server" dari 23505 `menus_company_nama_uq`.
        const [menu] = await tanpaBentrok(`Menu "${efektif.nama}" sudah ada`, () =>
          tx
          .update(menus)
          .set({
            categoryId: efektif.category_id,
            nama: efektif.nama,
            kode,
            deskripsi: teksAtauNull(efektif.deskripsi),
            tipe: efektif.tipe,
            mult: efektif.tipe === "regular" ? efektif.mult : null,
            baseMenuId: efektif.tipe === "paket" ? efektif.base_menu_id : null,
            baseMult: efektif.tipe === "paket" ? efektif.base_mult : null,
            hargaJual: efektif.harga_jual,
            imageUrl: efektif.image_url ?? null,
            targetDurasiDetik: efektif.target_durasi_detik ?? null,
            isActive: efektif.is_active,
            updatedAt: new Date(),
          })
          .where(and(eq(menus.id, id), eq(menus.companyId, auth.company_id!)))
          .returning(),
        );
        if (!menu) throw new HTTPException(404, { message: "Menu tidak ditemukan" });
        if (lama.hargaJual !== menu.hargaJual || multEfektif(lama) !== multEfektif(menu)) {
          await catatHargaMenu(tx, {
            companyId: auth.company_id!,
            menuId: menu.id,
            hargaLama: lama.hargaJual,
            hargaBaru: menu.hargaJual,
            multLama: multEfektif(lama),
            multBaru: multEfektif(menu),
            sebab: "manual",
            olehUserId: auth.sub,
          });
        }
        // undefined = tidak dikirim → pertahankan resep lama; [] = kosongkan
        if (body.komponen !== undefined) {
          await replaceKomponen(tx, menu.id, body.komponen);
        }
        // undefined = tidak dikirim → pertahankan pembatasan lama; null/[] = buka semua
        if (body.branch_ids !== undefined) {
          await replaceBranches(tx, menu.id, body.branch_ids);
        }
        return menu;
      });
      const katalog = await loadKatalog(db, auth.company_id!);
      return c.json(toMenuDto(katalog.rows.find((r) => r.id === row.id)!, katalog));
    },
  )
  .delete("/:id", requireRole("owner", "admin"), async (c) => {
    const auth = c.get("auth");
    // Soft delete — histori penjualan tetap merujuk menu ini
    const [row] = await db
      .update(menus)
      .set({ isActive: false, updatedAt: new Date() })
      .where(
        and(eq(menus.id, c.req.param("id")), eq(menus.companyId, auth.company_id!)),
      )
      .returning();
    if (!row) throw new HTTPException(404, { message: "Menu tidak ditemukan" });
    return c.json({ ok: true });
  });

import { and, asc, eq, inArray } from "drizzle-orm";
import {
  bahanPembatas,
  validasiPilihanAddon,
  foodCostPersen,
  hargaSaranBulat,
  hargaSaranFoodCost,
  hargaPerUnit,
  hitungHpp,
  qtyBahanPerPorsi,
  qtyEfektif,
  type GrupAturan,
  type KomponenDtoPenuh,
  type MenuAddonGroupDto,
  type MenuDtoPenuh,
  type MenuStokDto,
  type PilihanAddon,
} from "@kakarut/shared";
import { db, type Db, type Tx } from "../../db/client";
import {
  companies,
  ingredients,
  menuAddonGroups,
  menuAddons,
  menuBranches,
  menuCategories,
  menuComponents,
  menus,
} from "../../db/schema";
import { kunciBackfillKode } from "../../lib/kunci";
import { hitungSaldoCabang } from "../stok/service";

type MenuRow = typeof menus.$inferSelect;

export interface KatalogMenu {
  rows: MenuRow[];
  categoryNameById: Map<string, string>;
  /** komponen per menu, lengkap dengan info bahan */
  komponenByMenu: Map<string, KomponenDtoPenuh[]>;
  /** pembatasan lokasi per menu — TANPA entri/kosong = tampil di semua cabang */
  branchIdsByMenu: Map<string, string[]>;
  /**
   * Grup add-on per menu, TERMASUK yang sudah dihapus (bertanda `terhapus`):
   * penjualan offline yang disusulkan & bill lama masih bisa merujuknya.
   * DTO menyaring yang terhapus.
   */
  addonGroupsByMenu: Map<string, GrupKatalog[]>;
  /** info bahan yang ditautkan add-on — banyak yang TIDAK ada di resep menu */
  bahanAddon: Map<string, BahanKatalog>;
  /** `companies.food_cost_maks` (%) — patokan harga saran (`hargaSaranFoodCost`) */
  ambangFoodCost: number;
}

export interface BahanKatalog {
  nama: string;
  satuan: string;
  harga_per_unit: number;
  track_stok: boolean;
  is_packaging: boolean;
  is_complement: boolean;
}

export interface AddonKatalog {
  id: string;
  nama: string;
  harga: number;
  maks_jumlah: number | null;
  ingredient_id: string | null;
  qty_bahan: number | null;
  is_active: boolean;
  terhapus: boolean;
}

export interface GrupKatalog extends GrupAturan {
  terhapus: boolean;
  addons: AddonKatalog[];
}

/**
 * Add-on yang MENEMPEL pada satu baris — bentuk yang cukup untuk menghitung
 * harga, HPP, dan bahan. Sumbernya bisa konfigurasi hari ini (baris baru) atau
 * SNAPSHOT (`sale_item_addons`/`open_bill_item_addons`) saat menghitung ulang.
 */
export interface AddonSnap {
  ingredientId: string | null;
  qtyBahan: number | null;
  harga: number;
  jumlah: number;
}

/** Snapshot lengkap yang ditulis ke tabel `*_item_addons`. */
export interface AddonSnapBaris extends AddonSnap {
  /** null = add-on aslinya sudah tak ada (snapshot lama) */
  addonId: string | null;
  grupNama: string;
  nama: string;
  sortOrder: number;
}

/**
 * Komponen yang BENAR-BENAR dipakai sebuah menu: komponennya sendiri, plus —
 * untuk menu paket — komponen menu dasarnya.
 *
 * Gabungan ini dulu ditulis ulang identik di lima tempat (penjualan,
 * rekalkulasi biaya, dua endpoint menu, perencanaan stok). Satu salinan yang
 * lupa menyertakan resep dasar akan diam-diam melewatkan seluruh bahan menu
 * dasar sebuah paket — HPP dan konsumsi stoknya jadi terlalu kecil tanpa galat
 * apa pun. Cukup satu fungsi.
 */
export function komponenEfektif(katalog: KatalogMenu, menu: MenuRow): KomponenDtoPenuh[] {
  return [
    ...(katalog.komponenByMenu.get(menu.id) ?? []),
    ...(menu.tipe === "paket" && menu.baseMenuId
      ? katalog.komponenByMenu.get(menu.baseMenuId) ?? []
      : []),
  ];
}

/**
 * Takaran bahan untuk SATU porsi sebuah baris: resep efektif, lalu delta
 * add-on (`qty_bahan × jumlah`), DILANTAI 0 per bahan. "Tanpa mie" −100 g pada
 * resep 80 g memakai 0 g — bukan −20 g yang diam-diam menambah stok.
 *
 * Satu rumus untuk konsumsi stok, gerbang cek stok, dan HPP baris. Delta
 * add-on tak bisa digabung lintas keranjang lebih dulu (lantainya per baris),
 * jadi pemanggil menggabungkan HASIL fungsi ini, bukan masukannya.
 *
 * Termasuk bahan tak terlacak (HPP tetap membutuhkannya); bahan add-on yang
 * info katalognya tak ditemukan dilewati.
 */
export function kebutuhanPorsi(
  katalog: KatalogMenu,
  menu: MenuRow,
  dineIn: boolean,
  addons: readonly AddonSnap[] = [],
): Map<string, { qty: number; resep: number; info: BahanKatalog }> {
  const out = new Map<string, { qty: number; resep: number; info: BahanKatalog }>();
  for (const k of komponenEfektif(katalog, menu)) {
    const qty = qtyEfektif({ qty: k.qty, isPackaging: k.is_packaging, isComplement: k.is_complement }, dineIn);
    const ada = out.get(k.ingredient_id);
    if (ada) {
      ada.qty += qty;
      ada.resep += qty;
    } else {
      out.set(k.ingredient_id, {
        qty,
        resep: qty,
        info: {
          nama: k.nama,
          satuan: k.satuan,
          harga_per_unit: k.harga_per_unit,
          track_stok: k.track_stok,
          is_packaging: k.is_packaging,
          is_complement: k.is_complement,
        },
      });
    }
  }
  for (const a of addons) {
    if (!a.ingredientId || a.qtyBahan === null) continue;
    const ada = out.get(a.ingredientId);
    const info = ada?.info ?? katalog.bahanAddon.get(a.ingredientId);
    if (!info) continue;
    const delta = qtyEfektif(
      { qty: a.qtyBahan * a.jumlah, isPackaging: info.is_packaging, isComplement: info.is_complement },
      dineIn,
    );
    if (ada) ada.qty += delta;
    else out.set(a.ingredientId, { qty: delta, resep: 0, info });
  }
  for (const v of out.values()) if (v.qty < 0) v.qty = 0;
  return out;
}

/**
 * Kebutuhan bahan TERLACAK untuk sejumlah porsi satu BARIS (menu + add-on-nya),
 * ditambahkan ke `keranjang`. Satu-satunya tempat aturan "resep → bahan yang
 * dipotong stok" ditulis, dipakai baik saat MENCATAT konsumsi (createSale)
 * maupun saat MEMERIKSA kecukupan stok sebelum pesanan diterima (open bill &
 * penjualan).
 *
 * Kalau pemeriksaan memakai aturan yang berbeda dari pencatatan, gerbangnya
 * akan menolak pesanan yang sebenarnya cukup — atau meloloskan yang tidak —
 * dan tak ada yang bisa menjelaskan sebabnya kepada kasir.
 *
 * `dineIn` di sini adalah BASIS BIAYA baris itu (bukan tempat makannya):
 * kemasan take-away tak terpakai saat dine-in, complement dipakai setengah.
 */
export function tambahKebutuhanBaris(
  keranjang: Map<string, number>,
  katalog: KatalogMenu,
  menu: MenuRow,
  porsi: number,
  dineIn: boolean,
  addons: readonly AddonSnap[] = [],
): Map<string, number> {
  for (const [ingredientId, b] of kebutuhanPorsi(katalog, menu, dineIn, addons)) {
    // bahan yang tidak dilacak stoknya: tetap masuk HPP, tapi tidak
    // menghasilkan catatan konsumsi
    if (!b.info.track_stok) continue;
    const qty = b.qty * porsi;
    if (qty <= 0) continue;
    keranjang.set(ingredientId, (keranjang.get(ingredientId) ?? 0) + qty);
  }
  return keranjang;
}

/**
 * HPP per porsi sebuah BARIS: HPP resep + selisih bahan karena add-on ×
 * harga per unit. Tanpa add-on hasilnya PERSIS `hitungHargaMenu` (jalur yang
 * sama, urutan penjumlahan yang sama) — baris lama tak bergeser satu sen pun.
 */
export function hppBaris(
  menu: MenuRow,
  katalog: KatalogMenu,
  dineIn: boolean,
  addons: readonly AddonSnap[] = [],
): number {
  const dasar = hitungHargaMenu(menu, katalog, dineIn);
  if (!addons.some((a) => a.ingredientId && a.qtyBahan !== null)) return dasar;
  let selisih = 0;
  for (const b of kebutuhanPorsi(katalog, menu, dineIn, addons).values()) {
    selisih += (b.qty - b.resep) * b.info.harga_per_unit;
  }
  return dasar + selisih;
}

/**
 * Pilihan → bentuk hitung, TANPA mengadili (untuk RAMALAN stok: cek-stok).
 * Id yang tak dikenal dilewati — yang menolaknya validasi di pintu tulis.
 */
export function snapDariPilihan(
  katalog: KatalogMenu,
  menuId: string,
  pilihan: readonly PilihanAddon[] | undefined,
): AddonSnap[] {
  if (!pilihan || pilihan.length === 0) return [];
  const byId = new Map<string, AddonKatalog>();
  for (const g of katalog.addonGroupsByMenu.get(menuId) ?? []) for (const a of g.addons) byId.set(a.id, a);
  return pilihan.flatMap((p) => {
    const a = byId.get(p.id);
    return a ? [{ ingredientId: a.ingredient_id, qtyBahan: a.qty_bahan, harga: a.harga, jumlah: p.jumlah }] : [];
  });
}

/**
 * Pilihan kasir → snapshot add-on baris, setelah divalidasi terhadap grup
 * menu ini. `lenien` untuk penjualan offline yang disusulkan (lihat
 * `validasiPilihanAddon`). Urutan snapshot mengikuti urutan grup & add-on di
 * form menu, bukan urutan klik — tiket dapur jadi konsisten.
 */
export function resolusiAddon(
  katalog: KatalogMenu,
  menuId: string,
  pilihan: readonly PilihanAddon[],
  opsi: { lenien?: boolean } = {},
): { ok: true; addons: AddonSnapBaris[] } | { ok: false; pesan: string } {
  const grup = katalog.addonGroupsByMenu.get(menuId) ?? [];
  if (pilihan.length === 0 && grup.length === 0) return { ok: true, addons: [] };
  const v = validasiPilihanAddon(grup, [...pilihan], opsi);
  if (!v.ok) return v;
  const jumlahById = new Map(pilihan.map((p) => [p.id, p.jumlah]));
  const addons: AddonSnapBaris[] = [];
  for (const g of grup) {
    for (const a of g.addons) {
      const jumlah = jumlahById.get(a.id);
      if (jumlah === undefined) continue;
      addons.push({
        addonId: a.id,
        grupNama: g.nama,
        nama: a.nama,
        harga: a.harga,
        jumlah,
        ingredientId: a.ingredient_id,
        qtyBahan: a.qty_bahan,
        sortOrder: addons.length,
      });
    }
  }
  return { ok: true, addons };
}

/** Apakah menu tampil di cabang ini? (tanpa pembatasan = semua cabang) */
export function tampilDiCabang(
  katalog: KatalogMenu,
  menuId: string,
  branchId: string,
): boolean {
  const ids = katalog.branchIdsByMenu.get(menuId);
  return !ids || ids.length === 0 || ids.includes(branchId);
}

/**
 * Muat seluruh katalog menu perusahaan (termasuk nonaktif — dibutuhkan
 * sebagai basis paket & penjualan historis) beserta komponennya.
 */
export async function loadKatalog(dbx: Db | Tx, companyId: string): Promise<KatalogMenu> {
  // Tiebreak `id` bukan kosmetik: tanpa itu dua menu ber-sortOrder+nama sama
  // bisa bertukar urutan antar-query (Postgres tak menjanjikan urutan pada
  // kunci yang seri), dan ETag /menu ikut berubah walau datanya sama.
  const rows = await dbx
    .select()
    .from(menus)
    .where(eq(menus.companyId, companyId))
    .orderBy(asc(menus.sortOrder), asc(menus.nama), asc(menus.id));

  const cats = await dbx
    .select()
    .from(menuCategories)
    .where(eq(menuCategories.companyId, companyId));
  const categoryNameById = new Map(cats.map((c) => [c.id, c.nama]));

  const branchIdsByMenu = new Map<string, string[]>();
  const komponenByMenu = new Map<string, KomponenDtoPenuh[]>();
  if (rows.length > 0) {
    const batasan = await dbx
      .select({ menuId: menuBranches.menuId, branchId: menuBranches.branchId })
      .from(menuBranches)
      .where(
        inArray(
          menuBranches.menuId,
          rows.map((r) => r.id),
        ),
      )
      // Tanpa ORDER BY, isi `branch_ids` ikut urutan baris yang dikembalikan
      // Postgres — bisa berubah karena ganti rencana query atau update HOT,
      // walau himpunannya persis sama.
      .orderBy(asc(menuBranches.branchId));
    for (const b of batasan) {
      const list = branchIdsByMenu.get(b.menuId) ?? [];
      list.push(b.branchId);
      branchIdsByMenu.set(b.menuId, list);
    }
  }
  if (rows.length > 0) {
    const comps = await dbx
      .select({
        menuId: menuComponents.menuId,
        ingredientId: menuComponents.ingredientId,
        qty: menuComponents.qty,
        slug: ingredients.slug,
        nama: ingredients.nama,
        hargaBeli: ingredients.hargaBeli,
        isi: ingredients.isi,
        satuan: ingredients.satuan,
        trackStok: ingredients.trackStok,
        isPackaging: ingredients.isPackaging,
        isComplement: ingredients.isComplement,
      })
      .from(menuComponents)
      .innerJoin(ingredients, eq(menuComponents.ingredientId, ingredients.id))
      .where(
        inArray(
          menuComponents.menuId,
          rows.map((r) => r.id),
        ),
      )
      // Sama seperti branch_ids: urutan `komponen` harus stabil. Urut nama agar
      // tampilan editor resep juga rapi, dengan id sebagai pemutus seri.
      .orderBy(asc(ingredients.nama), asc(menuComponents.ingredientId));
    for (const comp of comps) {
      const list = komponenByMenu.get(comp.menuId) ?? [];
      list.push({
        ingredient_id: comp.ingredientId,
        slug: comp.slug,
        nama: comp.nama,
        qty: comp.qty,
        satuan: comp.satuan,
        track_stok: comp.trackStok,
        harga_per_unit: hargaPerUnit(comp.hargaBeli, comp.isi),
        is_packaging: comp.isPackaging,
        is_complement: comp.isComplement,
      });
      komponenByMenu.set(comp.menuId, list);
    }
  }

  const addonGroupsByMenu = new Map<string, GrupKatalog[]>();
  const bahanAddon = new Map<string, BahanKatalog>();
  if (rows.length > 0) {
    // Urutan stabil (sort_order, nama, id) — isinya ikut ETag /menu.
    const grupRows = await dbx
      .select()
      .from(menuAddonGroups)
      .where(eq(menuAddonGroups.companyId, companyId))
      .orderBy(asc(menuAddonGroups.sortOrder), asc(menuAddonGroups.nama), asc(menuAddonGroups.id));
    const grupById = new Map<string, GrupKatalog>();
    for (const g of grupRows) {
      const grup: GrupKatalog = {
        id: g.id,
        nama: g.nama,
        min_pilih: g.minPilih,
        maks_pilih: g.maksPilih,
        terhapus: g.deletedAt !== null,
        addons: [],
      };
      grupById.set(g.id, grup);
      const list = addonGroupsByMenu.get(g.menuId) ?? [];
      list.push(grup);
      addonGroupsByMenu.set(g.menuId, list);
    }
    if (grupRows.length > 0) {
      const addonRows = await dbx
        .select({
          addon: menuAddons,
          bahanNama: ingredients.nama,
          bahanSatuan: ingredients.satuan,
          hargaBeli: ingredients.hargaBeli,
          isi: ingredients.isi,
          trackStok: ingredients.trackStok,
          isPackaging: ingredients.isPackaging,
          isComplement: ingredients.isComplement,
        })
        .from(menuAddons)
        .leftJoin(ingredients, eq(menuAddons.ingredientId, ingredients.id))
        .where(eq(menuAddons.companyId, companyId))
        .orderBy(asc(menuAddons.sortOrder), asc(menuAddons.nama), asc(menuAddons.id));
      for (const r of addonRows) {
        const a = r.addon;
        grupById.get(a.groupId)?.addons.push({
          id: a.id,
          nama: a.nama,
          harga: a.harga,
          maks_jumlah: a.maksJumlah,
          ingredient_id: a.ingredientId,
          qty_bahan: a.qtyBahan,
          is_active: a.isActive,
          terhapus: a.deletedAt !== null,
        });
        if (a.ingredientId && r.bahanNama !== null && !bahanAddon.has(a.ingredientId)) {
          bahanAddon.set(a.ingredientId, {
            nama: r.bahanNama,
            satuan: r.bahanSatuan!,
            harga_per_unit: hargaPerUnit(r.hargaBeli!, r.isi!),
            track_stok: r.trackStok!,
            is_packaging: r.isPackaging!,
            is_complement: r.isComplement!,
          });
        }
      }
    }
  }

  const [co] = await dbx
    .select({ foodCostMaks: companies.foodCostMaks })
    .from(companies)
    .where(eq(companies.id, companyId));
  const ambangFoodCost = co?.foodCostMaks ?? 40;

  return {
    rows,
    categoryNameById,
    komponenByMenu,
    branchIdsByMenu,
    addonGroupsByMenu,
    bahanAddon,
    ambangFoodCost,
  };
}

/**
 * Lengkapi `bahanAddon` dengan bahan yang dirujuk SNAPSHOT tapi tak lagi
 * ditautkan add-on mana pun (admin mengganti bahannya sesudah penjualan).
 * Dipakai saat menghitung ulang dari snapshot — tanpa ini delta bahannya
 * diam-diam hilang dari HPP & konsumsi.
 */
export async function lengkapiBahanAddon(
  dbx: Db | Tx,
  companyId: string,
  katalog: KatalogMenu,
  ingredientIds: Iterable<string>,
): Promise<void> {
  const kurang = [...new Set(ingredientIds)].filter((id) => !katalog.bahanAddon.has(id));
  if (kurang.length === 0) return;
  const rows = await dbx
    .select()
    .from(ingredients)
    .where(and(eq(ingredients.companyId, companyId), inArray(ingredients.id, kurang)));
  for (const r of rows) {
    katalog.bahanAddon.set(r.id, {
      nama: r.nama,
      satuan: r.satuan,
      harga_per_unit: hargaPerUnit(r.hargaBeli, r.isi),
      track_stok: r.trackStok,
      is_packaging: r.isPackaging,
      is_complement: r.isComplement,
    });
  }
}

/**
 * Salinan katalog dengan harga sebagian bahan DIGANTI — untuk mengintip
 * "kalau harga acuan bahan ini jadi sekian, HPP & food cost menu jadi berapa"
 * tanpa menulis apa pun ke basis data. Baris asli tidak disentuh (salin dangkal
 * per komponen), jadi katalog sumber tetap bisa dipakai sebagai pembanding.
 */
export function katalogDenganHarga(
  katalog: KatalogMenu,
  hargaPerUnitBaru: Map<string, number>,
): KatalogMenu {
  const komponenByMenu = new Map<string, KomponenDtoPenuh[]>();
  for (const [menuId, list] of katalog.komponenByMenu) {
    komponenByMenu.set(
      menuId,
      list.map((k) =>
        hargaPerUnitBaru.has(k.ingredient_id)
          ? { ...k, harga_per_unit: hargaPerUnitBaru.get(k.ingredient_id)! }
          : k,
      ),
    );
  }
  const bahanAddon = new Map(
    [...katalog.bahanAddon].map(([id, b]) =>
      hargaPerUnitBaru.has(id) ? [id, { ...b, harga_per_unit: hargaPerUnitBaru.get(id)! }] : [id, b],
    ),
  );
  return { ...katalog, komponenByMenu, bahanAddon };
}

/**
 * Menu mana saja yang HPP-nya bergantung pada bahan-bahan ini — termasuk lewat
 * MENU DASAR (paket ikut terdampak bila bahan itu ada di resep dasarnya).
 */
export function menuMemakaiBahan(katalog: KatalogMenu, ingredientId: string): string[] {
  const langsung = new Set(
    katalog.rows
      .filter((m) =>
        (katalog.komponenByMenu.get(m.id) ?? []).some((k) => k.ingredient_id === ingredientId),
      )
      .map((m) => m.id),
  );
  for (const m of katalog.rows) {
    if (m.tipe === "paket" && m.baseMenuId && langsung.has(m.baseMenuId)) langsung.add(m.id);
  }
  return [...langsung];
}

function toKomponenHpp(list: KomponenDtoPenuh[]) {
  return list.map((k) => ({
    qty: k.qty,
    hargaPerUnit: k.harga_per_unit,
    isPackaging: k.is_packaging,
    isComplement: k.is_complement,
  }));
}

/**
 * Hitung HPP & harga sebuah menu (live).
 * - regular : HPP = Σ komponen; saran = HPP × mult
 * - paket   : HPP = HPP(dasar) + topping; saran = HPP(dasar) × base_mult + topping
 */
export function hitungHargaMenu(
  menu: MenuRow,
  katalog: KatalogMenu,
  dineIn = false,
): number {
  const own = toKomponenHpp(katalog.komponenByMenu.get(menu.id) ?? []);
  if (menu.tipe === "paket" && menu.baseMenuId) {
    const base = toKomponenHpp(katalog.komponenByMenu.get(menu.baseMenuId) ?? []);
    // topping paket (baso) tidak terpengaruh dine-in, tapi tetap lewat aturan umum
    return hitungHpp(base, dineIn) + hitungHpp(own, dineIn);
  }
  return hitungHpp(own, dineIn);
}

/**
 * Buat kode ringkas dari nama menu:
 *  - Bila nama memuat singkatan dalam kurung (mis. "… (PBA)"), pakai singkatan
 *    itu → "PBA".
 *  - Selain itu, inisial tiap kata, mis. "Mie Kuah Rebus" → "MKR".
 * Fallback "M" bila nama tak berhuruf.
 */
export function kodeDariNama(nama: string): string {
  const kurung = nama.match(/\(([^)]+)\)/);
  if (kurung) {
    const kode = kurung[1].replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    if (kode) return kode.slice(0, 6);
  }
  const inisial = nama
    .replace(/\([^)]*\)/g, " ") // abaikan bagian dalam kurung
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  return (inisial || "M").slice(0, 4);
}

/** Kode unik berikutnya dari basis + himpunan kode terpakai (mis. PBA, PBA2…). */
export function kodeUnik(base: string, dipakai: Set<string>): string {
  let kode = base;
  let n = 2;
  while (dipakai.has(kode.toUpperCase())) {
    kode = `${base}${n}`;
    n += 1;
  }
  return kode;
}

/**
 * Tentukan kode final sebuah menu: pakai kode manual bila diisi; bila kosong,
 * generate dari nama. Dijamin unik dalam perusahaan (kode = ID cepat di kasir),
 * menambah angka bila bentrok.
 */
export async function resolveKode(
  dbx: Db | Tx,
  companyId: string,
  desired: string | null | undefined,
  nama: string,
  selfId?: string,
): Promise<string> {
  const rows = await dbx
    .select({ id: menus.id, kode: menus.kode })
    .from(menus)
    .where(eq(menus.companyId, companyId));
  const dipakai = new Set(
    rows.filter((r) => r.kode && r.id !== selfId).map((r) => r.kode!.toUpperCase()),
  );
  const manual = desired?.trim();
  const base = manual && manual.length > 0 ? manual : kodeDariNama(nama);
  return kodeUnik(base, dipakai);
}

type BackfillRow = { id: string; companyId: string; nama: string; kode: string | null };

/**
 * Isi kode untuk menu lama yang belum punya (dipanggil saat boot & seed).
 * Idempotent: hanya menyentuh baris kode NULL. Kode digenerate dari nama &
 * unik per perusahaan.
 *
 * Bentuk yang sama persis dengan `backfillKodeBahan`, termasuk kelemahannya:
 * keunikannya dijamin Set di dalam SATU proses, dan `menus.kode` tak punya
 * indeks unik. Dijalankan dalam transaksi + advisory lock — lihat
 * `lib/kunci.ts` untuk angka yang mengukurnya.
 */
export async function backfillKodeMenu(dbx: Db | Tx): Promise<number> {
  return dbx.transaction(async (tx) => backfillKodeMenuTx(tx));
}

async function backfillKodeMenuTx(dbx: Tx): Promise<number> {
  await kunciBackfillKode(dbx, "menu");
  const rows: BackfillRow[] = await dbx
    .select({ id: menus.id, companyId: menus.companyId, nama: menus.nama, kode: menus.kode })
    .from(menus)
    .orderBy(asc(menus.sortOrder), asc(menus.nama));
  const perusahaan = new Map<string, { dipakai: Set<string>; kosong: BackfillRow[] }>();
  for (const r of rows) {
    const g = perusahaan.get(r.companyId) ?? { dipakai: new Set<string>(), kosong: [] };
    if (r.kode) g.dipakai.add(r.kode.toUpperCase());
    else g.kosong.push(r);
    perusahaan.set(r.companyId, g);
  }
  let terisi = 0;
  for (const [, g] of perusahaan) {
    for (const r of g.kosong) {
      const kode = kodeUnik(kodeDariNama(r.nama), g.dipakai);
      g.dipakai.add(kode.toUpperCase());
      await dbx.update(menus).set({ kode }).where(eq(menus.id, r.id));
      terisi += 1;
    }
  }
  return terisi;
}

/**
 * Sisa porsi tiap menu di satu cabang — untuk info kasir ("sisa 2 lagi").
 * porsi = ⌊min bahan pembatas (saldo ÷ qty per porsi)⌋, di mana qty per porsi
 * mengagregasi komponen menu sendiri + (untuk paket) komponen menu dasar, sama
 * seperti pengurangan stok saat penjualan. Bahan tak-terlacak diabaikan; menu
 * tanpa bahan pembatas → null (tak terbatas).
 *
 * Memakai qty PENUH tiap komponen (setara bawa pulang), yaitu skenario yang
 * mengonsumsi paling banyak: kemasan dipakai penuh dan complement tanpa
 * potongan dine-in. Termasuk KEMASAN terlacak — bila stok kemasan (mis. box/
 * plastik) menipis, itu pembatas nyata untuk penjualan bawa pulang. Dengan
 * begitu sisa yang ditampilkan tak pernah melebihi kemampuan sebenarnya
 * (aman dari over-janji), sekalipun untuk dine-in bisa sedikit konservatif.
 */
export async function ketersediaanMenu(
  companyId: string,
  branchId: string,
): Promise<MenuStokDto[]> {
  const [katalog, saldoRows] = await Promise.all([
    loadKatalog(db, companyId),
    hitungSaldoCabang(companyId, branchId),
  ]);
  const saldoByIngredient = new Map(saldoRows.map((r) => [r.ingredient_id, r.saldo]));
  const bahanById = new Map(saldoRows.map((r) => [r.ingredient_id, r]));

  return katalog.rows
    .filter((menu) => tampilDiCabang(katalog, menu.id, branchId))
    .map((menu) => {
    // qty bahan terlacak per porsi = komponen sendiri + (paket) komponen menu
    // dasar, digabung per bahan (persis logika konsumsi bawa-pulang).
    const qtyPerPorsi = qtyBahanPerPorsi(komponenEfektif(katalog, menu));
    const ketat = bahanPembatas(qtyPerPorsi, saldoByIngredient);
    const bahan = ketat ? bahanById.get(ketat.ingredient_id) : undefined;
    return {
      menu_id: menu.id,
      porsi: ketat?.porsi ?? null,
      pembatas:
        ketat && bahan
          ? {
              ingredient_id: ketat.ingredient_id,
              nama: bahan.nama,
              saldo: bahan.saldo,
              satuan: bahan.satuan,
              qty_per_porsi: qtyPerPorsi.get(ketat.ingredient_id) ?? 0,
            }
          : null,
    };
  });
}

export function toMenuDto(menu: MenuRow, katalog: KatalogMenu): MenuDtoPenuh {
  const hpp = hitungHargaMenu(menu, katalog);
  const hppDineIn = hitungHargaMenu(menu, katalog, true);

  // Saran = HPP ÷ ambang food cost perusahaan (paket: HPP total paket).
  // `mult`/`base_mult` lama tak lagi menentukan saran (laporan uji 31 Okt 2026).
  const saran = hargaSaranFoodCost(hpp, katalog.ambangFoodCost);

  const baseMenu = menu.baseMenuId
    ? katalog.rows.find((r) => r.id === menu.baseMenuId)
    : null;

  return {
    id: menu.id,
    nama: menu.nama,
    kode: menu.kode,
    deskripsi: menu.deskripsi,
    tipe: menu.tipe,
    category_id: menu.categoryId,
    kategori: katalog.categoryNameById.get(menu.categoryId) ?? "",
    mult: menu.mult,
    base_menu_id: menu.baseMenuId,
    base_menu_nama: baseMenu?.nama ?? null,
    base_mult: menu.baseMult,
    harga_jual: menu.hargaJual,
    image_url: menu.imageUrl,
    target_durasi_detik: menu.targetDurasiDetik,
    is_active: menu.isActive,
    sort_order: menu.sortOrder,
    branch_ids: katalog.branchIdsByMenu.get(menu.id) ?? [],
    komponen: katalog.komponenByMenu.get(menu.id) ?? [],
    hpp,
    hpp_dine_in: hppDineIn,
    harga_saran: saran,
    harga_jual_bulat: hargaSaranBulat(saran),
    food_cost_persen: foodCostPersen(hpp, menu.hargaJual),
    addon_groups: addonGroupsDto(menu, katalog, hpp),
  };
}

/**
 * Grup add-on untuk DTO — yang terhapus disaring. `hpp_delta` = perubahan HPP
 * (basis bawa pulang, sama dengan `hpp`) untuk SATU kali pilih.
 */
function addonGroupsDto(menu: MenuRow, katalog: KatalogMenu, hpp: number): MenuAddonGroupDto[] {
  return (katalog.addonGroupsByMenu.get(menu.id) ?? [])
    .filter((g) => !g.terhapus)
    .map((g) => ({
      id: g.id,
      nama: g.nama,
      min_pilih: g.min_pilih,
      maks_pilih: g.maks_pilih,
      addons: g.addons
        .filter((a) => !a.terhapus)
        .map((a) => {
          const bahan = a.ingredient_id ? katalog.bahanAddon.get(a.ingredient_id) : undefined;
          return {
            id: a.id,
            nama: a.nama,
            harga: a.harga,
            maks_jumlah: a.maks_jumlah,
            ingredient_id: a.ingredient_id,
            ingredient_nama: bahan?.nama ?? null,
            satuan: bahan?.satuan ?? null,
            qty_bahan: a.qty_bahan,
            is_active: a.is_active,
            hpp_delta: a.ingredient_id
              ? hppBaris(menu, katalog, false, [
                  { ingredientId: a.ingredient_id, qtyBahan: a.qty_bahan, harga: a.harga, jumlah: 1 },
                ]) - hpp
              : 0,
          };
        }),
    }));
}

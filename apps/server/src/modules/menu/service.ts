import { asc, eq, inArray } from "drizzle-orm";
import {
  bahanPembatas,
  foodCostPersen,
  hargaJualBulat,
  hargaPerUnit,
  hargaSaran,
  hargaSaranPaket,
  hitungHpp,
  qtyBahanPerPorsi,
  qtyEfektif,
  type KomponenDtoPenuh,
  type MenuDtoPenuh,
  type MenuStokDto,
} from "@kakarut/shared";
import { db, type Db, type Tx } from "../../db/client";
import { ingredients, menuBranches, menuCategories, menuComponents, menus } from "../../db/schema";
import { hitungSaldoCabang } from "../stok/service";

type MenuRow = typeof menus.$inferSelect;

export interface KatalogMenu {
  rows: MenuRow[];
  categoryNameById: Map<string, string>;
  /** komponen per menu, lengkap dengan info bahan */
  komponenByMenu: Map<string, KomponenDtoPenuh[]>;
  /** pembatasan lokasi per menu — TANPA entri/kosong = tampil di semua cabang */
  branchIdsByMenu: Map<string, string[]>;
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
 * Kebutuhan bahan TERLACAK untuk sejumlah porsi satu menu, ditambahkan ke
 * `keranjang`. Satu-satunya tempat aturan "resep → bahan yang dipotong stok"
 * ditulis, dipakai baik saat MENCATAT konsumsi (createSale) maupun saat
 * MEMERIKSA kecukupan stok sebelum pesanan diterima (open bill & penjualan).
 *
 * Kalau pemeriksaan memakai aturan yang berbeda dari pencatatan, gerbangnya
 * akan menolak pesanan yang sebenarnya cukup — atau meloloskan yang tidak —
 * dan tak ada yang bisa menjelaskan sebabnya kepada kasir.
 *
 * `dineIn` di sini adalah BASIS BIAYA baris itu (bukan tempat makannya):
 * kemasan take-away tak terpakai saat dine-in, complement dipakai setengah.
 */
export function tambahKebutuhanBahan(
  keranjang: Map<string, number>,
  katalog: KatalogMenu,
  menu: MenuRow,
  porsi: number,
  dineIn: boolean,
): Map<string, number> {
  for (const k of komponenEfektif(katalog, menu)) {
    // bahan yang tidak dilacak stoknya: tetap masuk HPP, tapi tidak
    // menghasilkan catatan konsumsi
    if (!k.track_stok) continue;
    const qty =
      qtyEfektif({ qty: k.qty, isPackaging: k.is_packaging, isComplement: k.is_complement }, dineIn) *
      porsi;
    if (qty <= 0) continue;
    keranjang.set(k.ingredient_id, (keranjang.get(k.ingredient_id) ?? 0) + qty);
  }
  return keranjang;
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

  return { rows, categoryNameById, komponenByMenu, branchIdsByMenu };
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
  return { ...katalog, komponenByMenu };
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
 * dijamin unik per perusahaan.
 */
export async function backfillKodeMenu(dbx: Db | Tx): Promise<number> {
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

  let saran: number;
  if (menu.tipe === "paket" && menu.baseMenuId) {
    const base = toKomponenHpp(katalog.komponenByMenu.get(menu.baseMenuId) ?? []);
    const topping = toKomponenHpp(katalog.komponenByMenu.get(menu.id) ?? []);
    saran = hargaSaranPaket(hitungHpp(base), menu.baseMult ?? 1, hitungHpp(topping));
  } else {
    saran = hargaSaran(hpp, menu.mult ?? 1);
  }

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
    harga_jual_bulat: hargaJualBulat(saran),
    food_cost_persen: foodCostPersen(hpp, menu.hargaJual),
  };
}

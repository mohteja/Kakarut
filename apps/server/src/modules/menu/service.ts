import { asc, eq, inArray } from "drizzle-orm";
import {
  foodCostPersen,
  hargaJualBulat,
  hargaPerUnit,
  hargaSaran,
  hargaSaranPaket,
  hitungHpp,
  type KomponenDto,
  type MenuDto,
} from "@kakarut/shared";
import type { Db, Tx } from "../../db/client";
import { ingredients, menuCategories, menuComponents, menus } from "../../db/schema";

type MenuRow = typeof menus.$inferSelect;

export interface KatalogMenu {
  rows: MenuRow[];
  categoryNameById: Map<string, string>;
  /** komponen per menu, lengkap dengan info bahan */
  komponenByMenu: Map<string, KomponenDto[]>;
}

/**
 * Muat seluruh katalog menu perusahaan (termasuk nonaktif — dibutuhkan
 * sebagai basis paket & penjualan historis) beserta komponennya.
 */
export async function loadKatalog(dbx: Db | Tx, companyId: string): Promise<KatalogMenu> {
  const rows = await dbx
    .select()
    .from(menus)
    .where(eq(menus.companyId, companyId))
    .orderBy(asc(menus.sortOrder), asc(menus.nama));

  const cats = await dbx
    .select()
    .from(menuCategories)
    .where(eq(menuCategories.companyId, companyId));
  const categoryNameById = new Map(cats.map((c) => [c.id, c.nama]));

  const komponenByMenu = new Map<string, KomponenDto[]>();
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
      );
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

  return { rows, categoryNameById, komponenByMenu };
}

function toKomponenHpp(list: KomponenDto[]) {
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

export function toMenuDto(menu: MenuRow, katalog: KatalogMenu): MenuDto {
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
    tipe: menu.tipe,
    category_id: menu.categoryId,
    kategori: katalog.categoryNameById.get(menu.categoryId) ?? "",
    mult: menu.mult,
    base_menu_id: menu.baseMenuId,
    base_menu_nama: baseMenu?.nama ?? null,
    base_mult: menu.baseMult,
    harga_jual: menu.hargaJual,
    image_url: menu.imageUrl,
    is_active: menu.isActive,
    sort_order: menu.sortOrder,
    komponen: katalog.komponenByMenu.get(menu.id) ?? [],
    hpp,
    hpp_dine_in: hppDineIn,
    harga_saran: saran,
    harga_jual_bulat: hargaJualBulat(saran),
    food_cost_persen: foodCostPersen(hpp, menu.hargaJual),
  };
}

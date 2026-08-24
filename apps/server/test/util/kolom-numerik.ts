import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * RUMAH BERSAMA untuk pemetaan kolom numeric — dipakai DUA gerbang:
 * `batas-ikut-presisi-kolom.test.ts` (batas masukan cocok dengan kolomnya) dan
 * `luapan-turunan.test.ts` (kolom yang TIDAK diisi medan masukan).
 *
 * Ditaruh di `test/util/` dan bukan diimpor lintas berkas uji: mengimpor
 * berkas `.test.ts` membuat seluruh `describe`-nya IKUT BERJALAN di berkas
 * pengimpor, jadi 7 uji terhitung dua kali dan waktunya terbayar dua kali.
 * Dan menyalin pembaca skemanya ke berkas kedua akan membuat dua daftar yang
 * pelan-pelan berbeda — bentuk yang sudah dibayar sesi ini lebih dari sekali.
 */
const SRC = fileURLToPath(new URL("../../src", import.meta.url));

/**
 * Kapasitas tiap kolom `numeric(p, s)`, dibaca dari `schema.ts`.
 *
 * Yang dipulangkan BILANGAN BULAT TERBESAR yang muat: `10^(p−s) − 1`.
 * Kapasitas sebenarnya `10^(p−s) − 10^(−s)` (mis. 9999,999 untuk `numeric(7,3)`),
 * tapi seluruh konstanta di `batas-angka.ts` sengaja bulat — batas pecahan
 * membuat pesan galatnya tak terbaca orang. Dihitung dengan BigInt: `10 ** 12`
 * masih tepat di float64, `10 ** 16` sudah tidak.
 */
export function kapasitasKolom(): Map<string, { p: number; s: number; maks: number }> {
  const sk = readFileSync(join(SRC, "db/schema.ts"), "utf8");
  const tabel = [...sk.matchAll(/export const \w+\s*=\s*pgTable\(\s*\n?\s*"([^"]+)"/g)].map((m) => ({
    pos: m.index!,
    nama: m[1],
  }));
  const keluar = new Map<string, { p: number; s: number; maks: number }>();
  for (const m of sk.matchAll(/\w+:\s*numeric\("([^"]+)",\s*\{\s*precision:\s*(\d+),\s*scale:\s*(\d+)/g)) {
    const t = tabel.filter((x) => x.pos < m.index!).at(-1)?.nama ?? "?";
    const p = Number(m[2]);
    const s = Number(m[3]);
    keluar.set(`${t}.${m[1]}`, { p, s, maks: Number(10n ** BigInt(p - s) - 1n) });
  }
  return keluar;
}

/**
 * MEDAN → KOLOM, satu entri per (berkas, nama medan).
 *
 * Kuncinya bukan nomor baris: nomor baris bergeser tiap kali ada yang menyunting
 * berkasnya, dan peta yang basi tiap minggu akan dihapus orang. Dalam satu
 * berkas, satu nama medan selalu bermuara ke kolom yang sama — kalau suatu saat
 * tidak, uji KELENGKAPAN di bawah yang menagihnya.
 */
export const PETA: Record<string, string> = {
  "modules/bahan/routes.ts|harga_beli": "ingredients.harga_beli",
  "modules/bahan/routes.ts|isi": "ingredients.isi",
  "modules/bahan/routes.ts|min_beli": "ingredients.min_beli",
  "modules/bahan/routes.ts|overhead_x": "ingredients.overhead_x",
  "modules/bahan/routes.ts|qty": "ingredient_components.qty",
  "modules/bahan/routes.ts|stok_minimum": "ingredients.stok_minimum",
  "modules/bahan/routes.ts|stok_minimum_toko": "ingredients.stok_minimum_toko",
  "modules/branches/routes.ts|latitude": "branches.latitude",
  "modules/branches/routes.ts|longitude": "branches.longitude",
  "modules/company/routes.ts|diskon_maks_persen": "companies.diskon_maks_persen",
  "modules/company/routes.ts|food_cost_maks": "companies.food_cost_maks",
  "modules/company/routes.ts|pb1_rate": "companies.pb1_rate",
  "modules/company/routes.ts|target_penjualan": "companies.target_penjualan",
  "modules/menu/routes.ts|base_mult": "menus.base_mult",
  "modules/menu/routes.ts|harga_jual": "menus.harga_jual",
  "modules/menu/routes.ts|mult": "menus.mult",
  "modules/menu/routes.ts|qty": "menu_components.qty",
  "modules/open-bill/routes.ts|qty": "open_bill_items.qty",
  "modules/penjualan/routes.ts|qty": "sale_items.qty",
  "modules/penjualan/routes.ts|uang_diterima": "sales.uang_diterima",
  "modules/perlengkapan/routes.ts|harga_beli": "supplies.harga_beli",
  "modules/perlengkapan/routes.ts|qty": "supply_mutations.qty",
  "modules/perlengkapan/routes.ts|qty_fisik": "supply_mutations.qty_fisik",
  "modules/perlengkapan/routes.ts|stok_minimum": "supplies.stok_minimum",
  "modules/perlengkapan/routes.ts|total_harga": "supply_mutations.total_harga",
  "modules/produksi/routes.ts|qty": "productions.qty",
  "modules/produksi/routes.ts|total_harga": "productions.total_harga",
  "modules/shift/routes.ts|modal_awal": "shifts.modal_awal",
  "modules/shift/routes.ts|uang_fisik": "shifts.uang_fisik",
  "modules/stok/routes.ts|qty": "stock_opnames.qty",
  "modules/sync/routes.ts|modal_awal": "shifts.modal_awal",
  "modules/transfer/routes.ts|qty": "productions.qty",
};


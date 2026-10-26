import { and, eq, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  BATAS_JUMLAH_ADDON,
  tandaAddon,
  type AddonBarisDto,
  type PilihanAddon,
  type SaleItemAddonRow,
  type SebabAddonTidakValid,
} from "@kakarut/shared";
import type { Db, Tx } from "../../db/client";
import { openBillItemAddons, saleItemAddons } from "../../db/schema";
import { resolusiAddon, type AddonSnapBaris, type KatalogMenu } from "./service";

/**
 * Pilihan add-on satu baris di badan permintaan (penjualan, cek stok, open
 * bill, dan — lewat `SaleBody` — sinkron offline). Jumlah di luar 1–20 bukan
 * keluaran kasir yang jujur, jadi cukup ditolak zod; aturan GRUP (wajib,
 * maks pilih, nonaktif) diadili `pastikanAddon` dengan sebab terstruktur.
 */
export const PilihanAddonBody = z
  .array(
    z
      .object({
        id: z.string().uuid(),
        jumlah: z.number().int().min(1).max(BATAS_JUMLAH_ADDON),
      })
      .strict(),
  )
  .max(50);

/**
 * 400 dengan `sebab: "addon_tidak_valid"` — pesan manusianya menyebut add-on
 * atau grupnya ("Pilih satu di grup "Level pedas""), jadi kasir tahu apa yang
 * harus dipilih ulang. `sebab` diteruskan `app.onError` & item gagal `/sync`.
 */
export class AddonTidakValid extends HTTPException {
  readonly sebab: SebabAddonTidakValid = "addon_tidak_valid";
  constructor(message: string) {
    super(400, { message });
  }
}

/** Pilihan → snapshot; melempar `AddonTidakValid` bila tak sah. */
export function pastikanAddon(
  katalog: KatalogMenu,
  menu: { id: string; nama: string },
  pilihan: readonly PilihanAddon[] | undefined,
  opsi: { lenien?: boolean } = {},
): AddonSnapBaris[] {
  const h = resolusiAddon(katalog, menu.id, pilihan ?? [], opsi);
  if (!h.ok) throw new AddonTidakValid(`${menu.nama}: ${h.pesan}`);
  return h.addons;
}

/**
 * Baris yang add-on-nya sudah TERKUNCI (baris open bill tersimpan): kiriman
 * yang berbeda dari snapshot ditolak, kiriman yang tak menyebut `addons`
 * (klien lama) memakai snapshot apa adanya.
 */
export function pastikanAddonSama(
  menuNama: string,
  snapshot: readonly { addonId: string | null; jumlah: number }[],
  kiriman: readonly PilihanAddon[] | undefined,
): void {
  if (kiriman === undefined) return;
  const lama = tandaAddon(snapshot.map((a) => ({ id: a.addonId, jumlah: a.jumlah })));
  if (lama !== tandaAddon(kiriman)) {
    throw new AddonTidakValid(
      `${menuNama}: add-on baris yang sudah tersimpan tidak bisa diubah — tambahkan sebagai baris baru`,
    );
  }
}

/** Baris tabel snapshot (`*_item_addons`) → bentuk hitung. Satu pemeta. */
export function snapDariBaris(a: {
  addonId: string | null;
  grupNama: string;
  nama: string;
  harga: number;
  jumlah: number;
  ingredientId: string | null;
  qtyBahan: number | null;
  sortOrder: number;
}): AddonSnapBaris {
  return {
    addonId: a.addonId,
    grupNama: a.grupNama,
    nama: a.nama,
    harga: a.harga,
    jumlah: a.jumlah,
    ingredientId: a.ingredientId,
    qtyBahan: a.qtyBahan,
    sortOrder: a.sortOrder,
  };
}

/** Baris tabel snapshot → bentuk kabel snake_case (bill, papan, slip, bon). */
export function addonBarisDto(a: {
  addonId: string | null;
  grupNama: string;
  nama: string;
  harga: number;
  jumlah: number;
}): AddonBarisDto {
  return { addon_id: a.addonId, grup_nama: a.grupNama, nama: a.nama, harga: a.harga, jumlah: a.jumlah };
}

/** Baris tabel snapshot → bentuk struk camelCase (`SaleItemRow.addons`). */
export function saleItemAddonRow(a: {
  addonId: string | null;
  grupNama: string;
  nama: string;
  harga: number;
  jumlah: number;
}): SaleItemAddonRow {
  return { addonId: a.addonId, grupNama: a.grupNama, nama: a.nama, harga: a.harga, jumlah: a.jumlah };
}

/** Kelompokkan baris snapshot per id baris induk, urut `sortOrder`. */
export function kelompokkanAddon<T extends { sortOrder: number }>(
  rows: readonly T[],
  induk: (r: T) => string,
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of [...rows].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const k = induk(r);
    const list = out.get(k) ?? [];
    list.push(r);
    out.set(k, list);
  }
  return out;
}

/** Snapshot add-on sejumlah baris penjualan (terkurung perusahaan). */
export async function muatAddonPenjualan(dbx: Db | Tx, companyId: string, saleItemIds: string[]) {
  if (saleItemIds.length === 0) return [];
  return dbx
    .select()
    .from(saleItemAddons)
    .where(and(eq(saleItemAddons.companyId, companyId), inArray(saleItemAddons.saleItemId, saleItemIds)));
}

/** Snapshot add-on sejumlah baris open bill (terkurung perusahaan). */
export async function muatAddonBill(dbx: Db | Tx, companyId: string, openBillItemIds: string[]) {
  if (openBillItemIds.length === 0) return [];
  return dbx
    .select()
    .from(openBillItemAddons)
    .where(
      and(eq(openBillItemAddons.companyId, companyId), inArray(openBillItemAddons.openBillItemId, openBillItemIds)),
    );
}

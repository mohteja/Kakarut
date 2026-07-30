import { sql } from "drizzle-orm";
import type { db } from "../../db/client";

/**
 * Backfill: baris open bill yang kasirnya SUDAH tandai take away tapi papan
 * dapurnya masih "di tempat".
 *
 * Dari SEBELUM `sajian_takeaway` diturunkan dari `dine_in_override`: kolomnya
 * dibiarkan default `false`, jadi papan menandai SEMUA baris "🍽 Di tempat"
 * meski kasir sudah menandai salah satunya take away. Tanpa backfill, bill yang
 * SEKARANG sedang terbuka tetap salah sampai kasir menyimpannya lagi — dan
 * makanannya sudah keluar di piring sebelum itu terjadi.
 *
 * Hanya menyentuh baris yang belum bertanda (`sajian_takeaway = false`), jadi
 * keputusan dapur yang sudah menekan 🥡 tak pernah ditimpa. Idempoten: setelah
 * beres tak ada lagi baris `dine_in_override = false` yang belum bertanda.
 *
 * Sengaja TIDAK menyentuh `sale_items` — di sana `createSale` sudah memakai
 * aturan yang sama sejak awal, dan penjualan lama adalah pembukuan yang sudah
 * ditutup.
 */
export async function backfillSajianTakeawayBill(database: typeof db) {
  const res = await database.execute(sql`
    UPDATE open_bill_items
    SET sajian_takeaway = true
    WHERE dine_in_override = false
      AND sajian_takeaway = false
  `);
  return res.rowCount ?? 0;
}

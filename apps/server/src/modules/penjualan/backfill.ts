import { sql } from "drizzle-orm";
import type { db as Db } from "../../db/client";

/**
 * Warisan Papan Pesanan Masuk: `sales.sajian_takeaway` lahir sebagai kolom
 * NOT NULL DEFAULT false, sehingga SELURUH transaksi lama — termasuk yang
 * dibukukan bawa pulang — terbaca "makan di tempat".
 *
 * Akibatnya dua hal salah sekaligus: papan menyuruh dapur menyajikan di piring
 * untuk pesanan yang dibawa pulang, dan Riwayat menandainya "diubah setelah
 * transaksi" padahal tak seorang pun menyentuhnya.
 *
 * Baris lama diselaraskan dengan fakta pembukuannya: penanda penyajian = bawa
 * pulang bila transaksinya memang bukan dine-in. Hanya menyentuh baris yang
 * masih memakai nilai bawaan, jadi aman diulang dan tak menimpa keputusan
 * siapa pun.
 */
export async function backfillSajianTakeaway(db: typeof Db): Promise<number> {
  const res = await db.execute(
    sql`UPDATE sales SET sajian_takeaway = true
        WHERE sajian_takeaway = false AND is_dine_in = false`,
  );
  return res.rowCount ?? 0;
}

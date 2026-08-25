/**
 * PORSI YANG DITAGIH, dalam SQL.
 *
 * Padanan `qtyDitagih()` dari `@kakarut/shared` untuk agregasi yang berjalan di
 * database. Ada karena refund sebagian TIDAK mengubah `sale_items.qty` maupun
 * `sale_items.line_total`: keduanya sengaja tetap merekam apa yang DIPESAN.
 * Yang bergerak hanya `qty_refund`, dan angka penjualan yang sah disusutkan di
 * `sales.subtotal/diskon/pb1_amount/total/total_hpp`.
 *
 * Akibatnya tiap laporan yang menjumlah `sale_items` mentah-mentah akan
 * menghitung porsi yang uangnya sudah dikembalikan sebagai porsi yang terjual —
 * dan berselisih dengan angka utama di layar yang sama, yang datang dari
 * `sales`. Selisihnya persis sebesar refundnya.
 *
 * `GREATEST(…, 0)` bukan sekadar jaga-jaga: `qtyDitagih` di shared juga
 * menjepit ke nol, dan dua sisi yang sama-sama menjepit tak bisa berbeda tanda
 * kalau suatu hari ada data yang `qty_refund`-nya melampaui `qty`.
 *
 * SEMUANYA BERAKHIR `::float8`, DAN ITU BUKAN KOSMETIK. `sql<number>` adalah
 * janji yang ditulis manusia dan tak diperiksa siapa pun: driver `pg`
 * memulangkan `numeric` — termasuk hasil `SUM()`-nya — sebagai STRING.
 * Tanpa cast, `sql<number>` bertipe `number` di TypeScript dan berisi
 * `"3000.75"` saat dijalankan; `a + b` merangkainya jadi `"3000.753000.75"`,
 * dan nilainya yang lolos ke `c.json()` melanggar kontrak API sebagai string
 * di tempat klien menunggu angka (`as num` di Dart melempar).
 *
 * Cast ini TIDAK mengubah satu angka pun: `x::float8` menghasilkan float64
 * yang bit-per-bit sama dengan `Number("x")`, yang memang sudah dipakai tiap
 * pemanggil. Yang berubah cuma di mana kebenarannya tinggal — di ekspresinya
 * sendiri, bukan pada ingatan tiap orang yang kelak memakainya.
 */
import { sql } from "drizzle-orm";
import { saleItems } from "../db/schema";

/** `qty − qty_refund`, minimal 0. */
export const qtyDitagihSql = sql<number>`GREATEST(${saleItems.qty} - ${saleItems.qtyRefund}, 0)::float8`;

/**
 * Omzet kotor baris SESUDAH refund.
 *
 * Sengaja `harga_satuan × porsi ditagih`, bukan `line_total` yang diprorata:
 * `line_total` memang lahir sebagai `harga_satuan × qty` (lihat `createSale`),
 * jadi bentuk ini identik saat belum ada refund dan tetap persis sejalan dengan
 * `sales.subtotal` sesudah refund — `hitungUangSetelahRefund` menyusunnya dari
 * penjumlahan yang sama.
 */
export const omzetDitagihSql = sql<number>`COALESCE(SUM(${saleItems.hargaSatuan} * GREATEST(${saleItems.qty} - ${saleItems.qtyRefund}, 0)), 0)::float8`;

/** Jumlah porsi yang ditagih pada satu grup agregasi. */
export const sumQtyDitagihSql = sql<number>`COALESCE(SUM(GREATEST(${saleItems.qty} - ${saleItems.qtyRefund}, 0)), 0)::float8`;

/** HPP yang ditagih: `hpp_satuan` tetap per porsi, dikalikan porsi yang jadi. */
export const hppDitagihSql = sql<number>`COALESCE(SUM(${saleItems.hppSatuan} * GREATEST(${saleItems.qty} - ${saleItems.qtyRefund}, 0)), 0)::float8`;

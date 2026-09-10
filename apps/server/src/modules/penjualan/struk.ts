import type { SaleItemRow, SaleResult, SaleRow } from "@kakarut/shared";
import { iso } from "../../lib/time";
import type { saleItems, sales } from "../../db/schema";

type BarisSale = typeof sales.$inferSelect;
type BarisSaleItem = typeof saleItems.$inferSelect;

/**
 * SATU-SATUNYA PENULIS BENTUK STRUK, dan satu-satunya gerbang biayanya.
 *
 * Tiga pintu memulangkan bentuk ini: `POST /penjualan` (201), `GET
 * /penjualan/:id` (cetak ulang), dan perintah `penjualan` di `POST /sync`.
 * Sampai 2026-09-05 hanya YANG KEDUA yang merakitnya sendiri dan menahan
 * biaya; dua lainnya menyebar baris Drizzle mentah dari `createSale`
 * (`return { sale, items, … }` → `c.json({ ...result, kasir })`).
 *
 * Akibatnya terukur lewat HTTP pada satu transaksi yang sama, 2026-09-05:
 *
 *   POST /penjualan  sebagai kasir → totalHpp 4000, hppSatuan 2000
 *   GET  /:id        sebagai kasir → totalHpp null, hppSatuan null
 *   GET  /:id        sebagai owner → totalHpp 4000, hppSatuan 2000
 *
 * Pintu yang sama, kasir yang sama, jawaban berlawanan — dan yang bocor
 * justru lewat pintu `requireRole("cashier")`, jadi TIAP kasir menerima biaya
 * pada TIAP checkout. Gerbang di `GET /:id` lahir 2026-08-26 dari pengukuran
 * yang sama persis (token `bar` dan `cashier` membaca 5662,0314); pintu POST
 * tak pernah ikut ditutup sebab bentuknya tak pernah ditulis siapa pun.
 *
 * Pemetaan di bawah KOLOM DEMI KOLOM, bukan sebar (`...`): kolom `sales` yang
 * ditambahkan besok tidak boleh ikut terkirim tanpa ada yang memutuskannya —
 * aturan yang sama dengan ATURAN A di `bentuk-balasan.test.ts`, yang
 * pemindainya berlingkup satu fungsi sehingga jalur `service.ts` → `routes.ts`
 * luput darinya.
 *
 * `lihatBiaya` DIOPER, bukan dihitung di sini: perannya milik pemanggil
 * (`bolehLihatBiaya(auth.role)`), dan menyembunyikannya di dalam sini membuat
 * pintu baru bisa lupa bahwa gerbangnya ada.
 */
export function strukPenjualan(
  sale: BarisSale,
  items: BarisSaleItem[],
  branchNama: string,
  kasir: string | null,
  lihatBiaya: boolean,
): SaleResult {
  const baris: SaleRow = {
    id: sale.id,
    companyId: sale.companyId,
    branchId: sale.branchId,
    cashierUserId: sale.cashierUserId,
    nomor: sale.nomor,
    isDineIn: sale.isDineIn,
    mejaId: sale.mejaId,
    mejaLabel: sale.mejaLabel,
    subtotal: sale.subtotal,
    diskon: sale.diskon,
    diskonPersen: sale.diskonPersen,
    pb1Amount: sale.pb1Amount,
    total: sale.total,
    subtotalAsal: sale.subtotalAsal,
    diskonAsal: sale.diskonAsal,
    pb1Asal: sale.pb1Asal,
    refundTotal: sale.refundTotal,
    totalHpp: lihatBiaya ? sale.totalHpp : null,
    catatan: sale.catatan,
    customerId: sale.customerId,
    customerNama: sale.customerNama,
    customerWa: sale.customerWa,
    metodeBayar: sale.metodeBayar,
    uangDiterima: sale.uangDiterima,
    waktu: iso(sale.waktu),
    saleDate: sale.saleDate,
    shiftId: sale.shiftId,
    asalOpenBillId: sale.asalOpenBillId,
    deletedAt: sale.deletedAt === null ? null : iso(sale.deletedAt),
    deletedBy: sale.deletedBy,
  };
  return {
    sale: baris,
    items: items.map((it): SaleItemRow => ({
      id: it.id,
      saleId: it.saleId,
      menuId: it.menuId,
      menuNama: it.menuNama,
      hargaSatuan: it.hargaSatuan,
      hppSatuan: lihatBiaya ? it.hppSatuan : null,
      qty: it.qty,
      isDineIn: it.isDineIn,
      catatan: it.catatan,
      lineTotal: it.lineTotal,
      pesananStatus: it.pesananStatus,
      pesananStatusAt: it.pesananStatusAt === null ? null : iso(it.pesananStatusAt),
      pesananStatusOleh: it.pesananStatusOleh,
      pesananMasukAt: iso(it.pesananMasukAt),
      sajianTakeaway: it.sajianTakeaway,
      qtyRefund: it.qtyRefund,
    })),
    branch_nama: branchNama,
    kasir,
  };
}


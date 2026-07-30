/**
 * Hitung ulang BIAYA sebuah penjualan yang sudah dibayar.
 *
 * Dipakai saat penanda penyajian sebuah baris diubah dari papan pesanan —
 * "pesanan ini ternyata dibawa pulang". Kemasan take away benar-benar keluar
 * dari rak saat itu, jadi `hpp_satuan`, `sales.total_hpp`, dan
 * `sale_consumptions` harus menyusul kenyataan; kalau tidak, laba-rugi memakai
 * biaya dine-in atas porsi yang dibungkus dan stok kemasan tak pernah
 * berkurang.
 *
 * SELALU hitung ULANG SELURUH transaksi, bukan selisih baris yang diubah.
 * `sale_consumptions` disimpan pra-agregat per (sale_id, ingredient_id) dan
 * TIDAK punya `sale_item_id`, jadi kontribusi satu baris tak bisa dicabut dari
 * angka gabungannya. Menghitung dari nol juga membuat operasi ini idempoten:
 * bolak-balik TA → dine-in → TA selalu mendarat di angka yang sama.
 */
import { and, eq, isNull } from "drizzle-orm";
import { qtyEfektif } from "@kakarut/shared";
import type { Tx } from "../../db/client";
import { saleConsumptions, saleItems, sales } from "../../db/schema";
import { hitungHargaMenu, komponenEfektif, loadKatalog } from "../menu/service";

export interface HasilRekalkulasi {
  hppLama: number;
  hppBaru: number;
  /** terisi bila biaya SENGAJA tidak dihitung ulang — biar bisa dicatat di log */
  alasanGagal?: string;
}

export async function hitungUlangBiayaPenjualan(
  tx: Tx,
  saleId: string,
  companyId: string,
): Promise<HasilRekalkulasi> {
  /**
   * `FOR UPDATE` bukan hiasan: dua orang membalik dua baris berbeda pada satu
   * pesanan di saat yang sama akan sama-sama menghitung dari snapshot
   * `sale_items` masing-masing, dan yang belakangan menimpa hasil yang
   * pertama. Kunci per-penjualan menjadikan hitung-ulang berurutan.
   */
  const [sale] = await tx
    .select({
      id: sales.id,
      branchId: sales.branchId,
      waktu: sales.waktu,
      totalHpp: sales.totalHpp,
    })
    .from(sales)
    .where(and(eq(sales.id, saleId), eq(sales.companyId, companyId), isNull(sales.deletedAt)))
    .for("update");
  // Penjualan di Tempat Sampah: seluruh agregasi stok & laporan sudah
  // mengabaikannya, jadi menghitung ulang biayanya tak ada artinya.
  if (!sale) return { hppLama: 0, hppBaru: 0, alasanGagal: "penjualan tidak aktif" };

  const baris = await tx
    .select({
      id: saleItems.id,
      menuId: saleItems.menuId,
      qty: saleItems.qty,
      hppSatuan: saleItems.hppSatuan,
      sajianTakeaway: saleItems.sajianTakeaway,
    })
    .from(saleItems)
    .where(eq(saleItems.saleId, saleId));
  if (baris.length === 0) return { hppLama: sale.totalHpp, hppBaru: sale.totalHpp };

  // `loadKatalog` sengaja memuat menu NONAKTIF juga, dan `DELETE /menu/:id`
  // hanya menonaktifkan — jadi menu penjualan lama praktis selalu ketemu.
  const katalog = await loadKatalog(tx, companyId);
  const menuById = new Map(katalog.rows.map((r) => [r.id, r]));
  // Bila toh ada yang hilang: JANGAN membukukan sebagian. Konsumsi ditulis
  // ulang sebagai satu himpunan, jadi melewati satu baris berarti menghapus
  // pemakaian bahannya — lebih buruk daripada membiarkan angka lama.
  if (baris.some((b) => !menuById.has(b.menuId))) {
    return {
      hppLama: sale.totalHpp,
      hppBaru: sale.totalHpp,
      alasanGagal: "menu sudah tidak ada",
    };
  }

  let totalHpp = 0;
  const konsumsi = new Map<string, number>(); // ingredientId -> qty
  for (const b of baris) {
    const menu = menuById.get(b.menuId)!;
    // BASIS BIAYA = penyajiannya. Aturan yang sama dengan `createSale`.
    const dasarDineIn = !b.sajianTakeaway;
    const hppSatuan = hitungHargaMenu(menu, katalog, dasarDineIn);
    totalHpp += hppSatuan * b.qty;
    if (hppSatuan !== b.hppSatuan) {
      await tx.update(saleItems).set({ hppSatuan }).where(eq(saleItems.id, b.id));
    }
    for (const k of komponenEfektif(katalog, menu)) {
      if (!k.track_stok) continue;
      const qty =
        qtyEfektif(
          { qty: k.qty, isPackaging: k.is_packaging, isComplement: k.is_complement },
          dasarDineIn,
        ) * b.qty;
      if (qty <= 0) continue;
      konsumsi.set(k.ingredient_id, (konsumsi.get(k.ingredient_id) ?? 0) + qty);
    }
  }

  if (totalHpp !== sale.totalHpp) {
    await tx.update(sales).set({ totalHpp }).where(eq(sales.id, saleId));
  }

  /**
   * Hapus lalu tulis ulang. Bahan yang qty-nya jadi 0 (mis. kemasan saat
   * dikembalikan ke dine-in) memang harus LENYAP, bukan tersimpan sebagai
   * nol — kelima pembaca `sale_consumptions` menjumlah apa adanya.
   *
   * `waktu` WAJIB tetap `sale.waktu`, JANGAN `now()`. Saldo stok mem-window-kan
   * `sc.waktu > baseline_opname.created_at`; memakai waktu sekarang akan
   * memindahkan konsumsi lama ke seberang garis opname dan stoknya berkurang
   * dua kali di pembukuan yang sudah ditutup.
   */
  await tx.delete(saleConsumptions).where(eq(saleConsumptions.saleId, saleId));
  if (konsumsi.size > 0) {
    await tx.insert(saleConsumptions).values(
      [...konsumsi].map(([ingredientId, qty]) => ({
        saleId,
        companyId,
        branchId: sale.branchId,
        ingredientId,
        qty,
        waktu: sale.waktu,
      })),
    );
  }

  return { hppLama: sale.totalHpp, hppBaru: totalHpp };
}

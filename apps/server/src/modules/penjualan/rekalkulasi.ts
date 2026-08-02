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
 * KONSUMSI selalu disusun ULANG untuk SELURUH transaksi, bukan selisih baris
 * yang diubah: `sale_consumptions` disimpan pra-agregat per
 * (sale_id, ingredient_id) dan TIDAK punya `sale_item_id`, jadi kontribusi satu
 * baris tak bisa dicabut dari angka gabungannya.
 *
 * UANG tidak. `hpp_satuan` adalah fakta historis dan `laporan` menjumlahnya
 * sebagai harga pokok penjualan periode itu, sementara harga bahan bergerak
 * sendiri di luar transaksi ini — jadi yang diterapkan hanya SELISIH basis
 * penyajian, atas baris yang basisnya memang berubah (`basisBerubah`). Lihat
 * `hppSatuanBaru`; sifat idempotennya tetap terjaga.
 */
import { and, eq, isNull } from "drizzle-orm";
import { qtyDitagih, qtyEfektif } from "@kakarut/shared";
import type { Tx } from "../../db/client";
import { saleConsumptions, saleItems, sales } from "../../db/schema";
import { hitungHargaMenu, komponenEfektif, loadKatalog } from "../menu/service";

export interface HasilRekalkulasi {
  hppLama: number;
  hppBaru: number;
  /** terisi bila biaya SENGAJA tidak dihitung ulang — biar bisa dicatat di log */
  alasanGagal?: string;
}

/**
 * `sale_items.id` yang penyajiannya BENAR-BENAR BERPINDAH pada operasi ini —
 * nilainya berubah, bukan sekadar ikut ditulis.
 *
 * Bedanya bukan main-main, dan pernah salah persis di sini. Endpoint `/sajian`
 * menyetel penanda SELURUH baris tanpa memeriksa nilai lamanya, jadi "semua
 * baris ditulis" tidak sama dengan "semua baris berubah". Baris yang sudah
 * bawa pulang lalu ditandai bawa pulang lagi tidak berpindah basis — dan
 * memasukkannya ke sini membuat `hppSatuanBaru` memakai `!dasarDineIn` sebagai
 * basis lamanya, padahal basis lamanya sama dengan yang baru. Kemasannya
 * ditambahkan untuk KEDUA kalinya.
 *
 * Karena itu tak ada lagi varian `"semua"`: pemanggil wajib menyodorkan
 * himpunan yang ia buktikan sendiri dengan membandingkan nilai lama dan baru.
 * SENGAJA tanpa nilai bawaan — yang lupa ketahuan typecheck, bukan diam-diam
 * menulis ulang pembukuan yang sudah tutup.
 */
export type BasisBerubah = ReadonlySet<string>;

/** Tidak ada penyajian yang berubah — dipakai jalur refund. */
export const TANPA_UBAH_BASIS: ReadonlySet<string> = new Set<string>();

/**
 * Baris mana yang BERPINDAH bila penyajiannya disetel ke `takeaway`.
 *
 * Satu-satunya cara sah menyusun `BasisBerubah` dari endpoint `/sajian`:
 * bandingkan nilai lama tiap baris dengan nilai yang diminta. Baris yang sudah
 * berada di nilai itu tidak berpindah, dan pesanan CAMPUR — satu porsi sudah
 * dibungkus kasir, sisanya belum — adalah kasus normal, bukan kasus pinggir.
 */
export function barisBerpindah(
  baris: readonly { id: string; sajianTakeaway: boolean }[],
  takeaway: boolean,
): ReadonlySet<string> {
  return new Set(baris.filter((b) => b.sajianTakeaway !== takeaway).map((b) => b.id));
}

/**
 * Harga pokok satu porsi SESUDAH operasi ini.
 *
 * `hpp_satuan` adalah FAKTA HISTORIS: biaya satu porsi memakai harga bahan pada
 * hari transaksi. `laporan` menjumlah `sales.total_hpp` apa adanya, jadi angka
 * itu adalah harga pokok penjualan periode tersebut — bukan taksiran hari ini.
 *
 * Yang dulu terjadi: hitung-ulang selalu memakai `hitungHargaMenu` atas katalog
 * HARI INI untuk SETIAP baris. Padahal `ingredients.harga_beli` bergerak sendiri
 * — Laporan Harga menyetelnya ke median riwayat pembelian tiap kali belanja
 * dilaporkan. Akibatnya satu refund sebagian pada transaksi bulan lalu menulis
 * ulang seluruh HPP transaksi itu dengan harga bulan ini, dan laba-rugi bulan
 * lalu ikut berubah — diam-diam, tanpa ada yang menyentuh transaksinya.
 * Transaksi yang tak pernah direfund tetap beku pada harga saat dijual, jadi
 * satu laporan berisi dua dasar harga sekaligus.
 *
 * Karena itu yang diterapkan adalah SELISIH BASIS, bukan hitung dari nol:
 * hanya bagian yang benar-benar berubah (kemasan take away + separuh pelengkap)
 * yang ditambahkan/dikurangkan, dengan harga hari ini karena harga lamanya
 * memang tak tersimpan. Tingkat historisnya utuh.
 *
 * Sifatnya ikut terjaga:
 *  - baris yang tak disentuh → angkanya tak bergerak sama sekali;
 *  - menekan tombol yang sama dua kali → selisihnya nol, angkanya tetap;
 *  - TA → dine-in → TA → kembali PERSIS ke angka semula.
 */
export function hppSatuanBaru(p: {
  /** `sale_items.hpp_satuan` yang tersimpan — biaya historis satu porsi */
  hppLama: number;
  /** basis penyajian baris INI berubah pada operasi ini? */
  basisBerubah: boolean;
  /** biaya satu porsi pada basis BARU, harga hari ini */
  hppBasisBaru: number;
  /** biaya satu porsi pada basis LAMA, harga hari ini */
  hppBasisLama: number;
}): number {
  if (!p.basisBerubah) return p.hppLama;
  // Dijaga tak negatif: harga kemasan hari ini bisa saja melampaui seluruh HPP
  // historis sebuah porsi, dan biaya negatif akan jadi "laba" palsu di laporan.
  return Math.max(0, p.hppLama + (p.hppBasisBaru - p.hppBasisLama));
}

export async function hitungUlangBiayaPenjualan(
  tx: Tx,
  saleId: string,
  companyId: string,
  basisBerubah: BasisBerubah,
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
      qtyRefund: saleItems.qtyRefund,
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
    const hppSatuan = hppSatuanBaru({
      hppLama: b.hppSatuan,
      basisBerubah: basisBerubah.has(b.id),
      hppBasisBaru: hitungHargaMenu(menu, katalog, dasarDineIn),
      hppBasisLama: hitungHargaMenu(menu, katalog, !dasarDineIn),
    });
    /*
     * PORSI YANG DITAGIH, bukan porsi yang dipesan.
     *
     * Sajian yang direfund (bahan ternyata habis) tak pernah dibuat: bahannya
     * tak jadi terpakai dan biayanya tak jadi keluar. Memakai `qty` mentah di
     * sini akan membuat laba-rugi menanggung HPP makanan yang tak ada, dan
     * stok bahannya tetap tercatat berkurang selamanya.
     *
     * `hpp_satuan` tetap disimpan PER PORSI (bukan dikalikan) — ia harga
     * pokok satu porsi, dan itu tidak berubah karena sebagian dikembalikan.
     */
    const qtyBayar = qtyDitagih(b);
    totalHpp += hppSatuan * qtyBayar;
    if (hppSatuan !== b.hppSatuan) {
      await tx.update(saleItems).set({ hppSatuan }).where(eq(saleItems.id, b.id));
    }
    /*
     * Konsumsi memang disusun ulang dari resep HARI INI untuk seluruh baris,
     * termasuk baris yang penyajiannya tak berubah — takaran resep saat
     * transaksi terjadi tak tersimpan di mana pun, dan `sale_consumptions`
     * pra-agregat per (sale_id, ingredient_id) tanpa `sale_item_id` sehingga
     * kontribusi satu baris tak bisa dicabut sendiri. Yang bisa dijaga adalah
     * UANG-nya (lihat `hppSatuanBaru`); resep jarang diubah, harga bahan
     * bergerak tiap kali belanja dilaporkan.
     */
    for (const k of komponenEfektif(katalog, menu)) {
      if (!k.track_stok) continue;
      const qty =
        qtyEfektif(
          { qty: k.qty, isPackaging: k.is_packaging, isComplement: k.is_complement },
          dasarDineIn,
        ) * qtyBayar;
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

import type { BahanKurangDto } from "@kakarut/shared";
import { formatAngkaId } from "@kakarut/shared";
import { tambahKebutuhanBahan, type KatalogMenu } from "../menu/service";

/**
 * SATU-SATUNYA PENULIS kalimat penolakan "stok tak cukup", dan satu-satunya
 * perakit kebutuhan bahan dari sebuah KERANJANG.
 *
 * Kalimat ini dibaca kasir yang sedang berdiri di depan tamu, dan sampai
 * 2026-09-06 ia dirakit di DUA tempat — `penjualan/service.ts` (gerbang saat
 * Bayar) dan `open-bill/routes.ts` (gerbang saat pesanan masuk) — dengan
 * potongan `.map(...).join("; ")` yang diketik ulang. Dua salinan yang hari ini
 * sama persis adalah dua salinan yang besok bisa tidak, tanpa suara: kelas yang
 * sama dengan `strukPenjualan` (vena #97) dan `companyRow` (#99).
 *
 * Sejak putaran ini pemakainya TIGA — dua gerbang di atas plus
 * `POST /penjualan/cek-stok`, yang memulangkan kalimat ini SEBELUM Bayar
 * ditekan. Justru pemakai ketiga itulah yang membuat satu penulis jadi wajib:
 * pracek yang mengarang kalimatnya sendiri akan menjanjikan sesuatu yang
 * berbeda dari yang benar-benar diterima kasir semenit kemudian.
 */
export function pesanStokKurang(kurang: BahanKurangDto[]): string {
  return `Stok tidak cukup: ${kurang
    .map((k) => `${k.nama} (sisa ${formatAngkaId(k.saldo)} ${k.satuan}, butuh ${formatAngkaId(k.butuh)})`)
    .join("; ")}`;
}

/** Satu baris keranjang, sejauh yang dibutuhkan untuk menghitung bahan. */
export interface BarisKeranjang {
  menu_id: string;
  qty: number;
  /** dine-in per baris; mengalahkan tipe transaksi bila diisi */
  is_dine_in?: boolean | null;
}

/**
 * Kebutuhan bahan TERLACAK untuk seluruh keranjang, ditumpuk per bahan.
 *
 * INI yang membedakannya dari `GET /menu/ketersediaan`, dan bedanya bukan
 * kosmetik. Ketersediaan menjawab PER MENU ("menu ini bisa dibuat berapa porsi
 * lagi"); pertanyaan yang sebenarnya dihadapi kasir adalah "keranjang INI
 * muat atau tidak", dan keduanya berbeda persis saat dua baris memperebutkan
 * satu bahan. Terukur lewat HTTP pada DB gerbang 2026-09-06: dari 57 menu, 38
 * berbagi bahan pembatas dengan menu lain (12 kelompok) — keranjang 20 "Premium
 * Basooopa B" (sisa porsi 26) + 20 "Favorit Set 1" (sisa porsi 40) melewati
 * KEDUA peringatan per-menu tanpa suara, lalu ditolak server dengan
 * "Stok tidak cukup: Baso aci jando (sisa 80 butir, butuh 100)".
 *
 * `dineInDasar` adalah BASIS BIAYA barisnya, bukan tempat makannya: kemasan
 * take-away tak terpakai saat dine-in, complement dipakai setengah. Untuk
 * penjualan langsung ia sama dengan `is_dine_in` baris (lihat `dasarDineIn` di
 * `createSale`, yang lewat `penandaSajian` menyederhana jadi `dineIn` selama
 * tak ada warisan penanda 🥡 dari open bill). Baris yang MEWARISI penanda itu
 * hanya ada pada jalur open bill — dan di jalur itu gerbangnya memang tak
 * berlaku (`gerbangBerlaku` di bawah), jadi pracek tak pernah memakai basis
 * yang salah untuk keputusan yang benar-benar diambil.
 */
export function kebutuhanKeranjang(
  katalog: KatalogMenu,
  items: BarisKeranjang[],
  dineInDasar: boolean,
): Map<string, number> {
  const butuh = new Map<string, number>();
  const menuById = new Map(katalog.rows.map((m) => [m.id, m]));
  for (const it of items) {
    const menu = menuById.get(it.menu_id);
    // Menu yang tak dikenal dilewati, bukan dianggap kurang: yang menolak
    // menu asing adalah validasi rutenya, dan menuduhnya di sini akan
    // memulangkan "stok tak cukup" untuk masalah yang sama sekali lain.
    if (!menu) continue;
    tambahKebutuhanBahan(butuh, katalog, menu, it.qty, it.is_dine_in ?? dineInDasar);
  }
  return butuh;
}

/**
 * APAKAH GERBANG "tolak pesanan melebihi stok" BERLAKU untuk transaksi ini?
 *
 * Predikat ini ada supaya `createSale` dan `POST /penjualan/cek-stok` tak
 * pernah berbeda pendapat. Pracek yang menjawab dari `kurang.length > 0` saja
 * akan MENJANJIKAN PENOLAKAN YANG TAK AKAN TERJADI pada dua jalur yang
 * gerbangnya sengaja lewati — dan peringatan yang meleset ke arah itu justru
 * yang paling mahal: kasir menolak pesanan yang sebenarnya boleh dilayani.
 *
 * Kedua pengecualian di bawah bukan kelalaian; alasannya ditulis panjang di
 * `createSale` dan tetap berlaku:
 *
 *   · `openBillId` — bill yang sedang DIBAYAR. Barangnya dipesan dan dimasak
 *     saat bill dibuat; gerbangnya berlaku DI SANA (`pastikanStokCukup`).
 *     Menolak di kasir berarti tamu yang sudah makan tak bisa membayar.
 *   · `transaksiSusulan` — sinkron offline. Menolaknya menghapus penjualan
 *     sungguhan dari pembukuan, permanen.
 */
export function gerbangBerlaku(p: {
  blokirJualMinus: boolean;
  openBillId?: string | null;
  transaksiSusulan?: boolean;
}): boolean {
  return p.blokirJualMinus && !p.openBillId && !p.transaksiSusulan;
}

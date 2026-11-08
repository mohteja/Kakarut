import type { BahanKurangDto, PilihanAddon } from "@kakarut/shared";
import { formatAngkaId } from "@kakarut/shared";
import { and, eq, isNull, ne } from "drizzle-orm";
import type { Db, Tx } from "../../db/client";
import { meja, openBillItems, openBills } from "../../db/schema";
import { muatAddonBill } from "../menu/addon";
import { snapDariPilihan, tambahKebutuhanBaris, type KatalogMenu } from "../menu/service";

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
  /** pilihan add-on (dari kasir) — dipetakan lewat katalog */
  addons?: readonly PilihanAddon[];
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
    // Delta add-on dilantai PER BARIS sebelum ditumpuk — "Tanpa mie" di satu
    // baris tak boleh mengurangi mie baris lain.
    tambahKebutuhanBaris(
      butuh,
      katalog,
      menu,
      it.qty,
      it.is_dine_in ?? dineInDasar,
      snapDariPilihan(katalog, menu.id, it.addons),
    );
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

/**
 * BAHAN YANG SUDAH DIPESAN OPEN BILL — cadangan per bahan dari semua bill
 * yang masih berjalan di cabang ini.
 *
 * Permintaan pemilik (2026-11-08): "open bill langsung kurangi stok saat
 * disimpan". Saldo FISIK tak diubah — barangnya baru benar-benar tercatat
 * keluar saat bill dibayar (`sale_consumptions`, lengkap dengan HPP-nya) —
 * tapi bahan untuk pesanan yang sudah masuk dapur tak boleh lagi dijanjikan
 * kepada pesanan lain. Karena itu cadangan ini dikurangkan dari saldo di
 * gerbang "stok tak cukup", pracek kasir, dan sisa porsi menu.
 *
 * TURUNAN, bukan catatan: dihitung dari baris bill saat ini, jadi tak bisa
 * basi. Bill yang dibayar atau dibatalkan (`closed_at` terisi) otomatis
 * berhenti memesan — tanpa langkah "lepaskan cadangan" yang bisa terlupa,
 * dan tanpa potongan ganda saat penjualannya menulis konsumsi sungguhan.
 * Baris yang dibatalkan dapur/kasir (`batal`) tak memesan apa pun.
 *
 * Basis dine-in per baris sama dengan saat dibayar: penanda bawa pulang di
 * papan (`sajian_takeaway`) atau pilihan per baris, lalu tipe meja bill.
 *
 * `kecualiBillId` — bill yang sedang dibayar/dipracek: bahannya untuk
 * pesanan itu sendiri, jadi tak boleh menghalangi dirinya.
 */
export async function cadanganOpenBill(
  exec: Db | Tx,
  companyId: string,
  branchId: string,
  katalog: KatalogMenu,
  kecualiBillId?: string | null,
): Promise<Map<string, number>> {
  const rows = await exec
    .select({
      id: openBillItems.id,
      menuId: openBillItems.menuId,
      qty: openBillItems.qty,
      dineInOverride: openBillItems.dineInOverride,
      sajianTakeaway: openBillItems.sajianTakeaway,
      mejaTipe: meja.tipe,
    })
    .from(openBillItems)
    .innerJoin(
      openBills,
      and(eq(openBills.id, openBillItems.billId), eq(openBills.companyId, companyId)),
    )
    .leftJoin(meja, and(eq(meja.id, openBills.mejaId), eq(meja.companyId, companyId)))
    .where(
      and(
        eq(openBills.companyId, companyId),
        eq(openBills.branchId, branchId),
        isNull(openBills.closedAt),
        ne(openBillItems.pesananStatus, "batal"),
        ...(kecualiBillId ? [ne(openBills.id, kecualiBillId)] : []),
      ),
    );
  if (rows.length === 0) return new Map();
  const addonPerBaris = new Map<string, PilihanAddon[]>();
  for (const a of await muatAddonBill(exec, companyId, rows.map((r) => r.id))) {
    if (!a.addonId) continue;
    const arr = addonPerBaris.get(a.openBillItemId) ?? [];
    arr.push({ id: a.addonId, jumlah: a.jumlah });
    addonPerBaris.set(a.openBillItemId, arr);
  }
  return kebutuhanKeranjang(
    katalog,
    rows.map((r) => ({
      menu_id: r.menuId,
      qty: r.qty,
      is_dine_in: r.sajianTakeaway ? false : (r.dineInOverride ?? r.mejaTipe === "dine_in"),
      addons: addonPerBaris.get(r.id),
    })),
    true,
  );
}

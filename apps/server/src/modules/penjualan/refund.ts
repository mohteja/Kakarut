/**
 * REFUND SEBAGIAN PER SAJIAN.
 *
 * Satu kasus nyata: pembeli sudah membayar, lalu ketahuan bahan salah satu
 * sajian habis sehingga sajian itu tak jadi dibuat. Uang untuk sajian itu — dan
 * hanya sajian itu — dikembalikan.
 *
 * Kasir boleh melakukannya sendiri, karena pembelinya sedang berdiri di depan
 * kasir dan memanggil owner berarti menahan antrean. Wewenang itu ditukar
 * dengan JEJAK: tiap refund menyimpan siapa, kapan, berapa, dan alasannya.
 *
 * Yang berubah saat refund:
 *   1. `sale_items.qty_refund` bertambah (KUMULATIF; `qty` tak disentuh —
 *      berapa yang dipesan dan berapa yang dikembalikan adalah dua fakta).
 *   2. `sales.subtotal/diskon/pb1_amount/total` disusutkan proporsional
 *      (`hitungUangSetelahRefund` di `@kakarut/shared`, teruji terpisah).
 *   3. `sales.*_asal` diisi SEKALI sebagai jangkar refund berikutnya.
 *   4. `uang_diterima` ikut turun sebanyak uang yang dikembalikan, supaya
 *      "kembalian" di struk tetap angka yang benar-benar terjadi.
 *   5. `hitungUlangBiayaPenjualan` menyusutkan HPP dan MENGEMBALIKAN STOK
 *      bahan — sajian yang tak dibuat tak memakai bahan.
 *   6. Satu baris `sale_refunds` sebagai riwayat.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { hitungUangSetelahRefund, nominalRefund, qtyDitagih } from "@kakarut/shared";
import type { Tx } from "../../db/client";
import { saleItems, saleRefunds, sales, shifts } from "../../db/schema";
import { hitungUlangBiayaPenjualan, TANPA_UBAH_BASIS } from "./rekalkulasi";

export interface PermintaanRefund {
  saleItemId: string;
  qty: number;
}

export interface HasilRefund {
  nominal: number;
  totalLama: number;
  totalBaru: number;
}

export async function refundSajian(
  tx: Tx,
  params: {
    saleId: string;
    companyId: string;
    userId: string;
    alasan?: string | null;
    items: PermintaanRefund[];
  },
): Promise<HasilRefund> {
  /**
   * `FOR UPDATE` sama alasannya dengan hitung-ulang penyajian: dua orang
   * merefund dua sajian berbeda pada satu transaksi di saat yang sama akan
   * sama-sama menghitung dari snapshot masing-masing, dan yang belakangan
   * menimpa hasil yang pertama — uang yang dikembalikan jadi salah.
   */
  const [sale] = await tx
    .select({
      id: sales.id,
      branchId: sales.branchId,
      subtotal: sales.subtotal,
      diskon: sales.diskon,
      pb1Amount: sales.pb1Amount,
      total: sales.total,
      subtotalAsal: sales.subtotalAsal,
      diskonAsal: sales.diskonAsal,
      pb1Asal: sales.pb1Asal,
      refundTotal: sales.refundTotal,
      uangDiterima: sales.uangDiterima,
      metodeBayar: sales.metodeBayar,
    })
    .from(sales)
    .where(and(eq(sales.id, params.saleId), eq(sales.companyId, params.companyId), isNull(sales.deletedAt)))
    .for("update");
  // Penjualan di Tempat Sampah sudah diabaikan seluruh laporan; merefundnya
  // tak punya arti dan hanya menghasilkan angka yang tak dibaca siapa pun.
  if (!sale) throw new HTTPException(404, { message: "Transaksi tidak ditemukan" });

  const baris = await tx
    .select({
      id: saleItems.id,
      menuNama: saleItems.menuNama,
      hargaSatuan: saleItems.hargaSatuan,
      qty: saleItems.qty,
      qtyRefund: saleItems.qtyRefund,
    })
    .from(saleItems)
    .where(eq(saleItems.saleId, params.saleId));
  const byId = new Map(baris.map((b) => [b.id, b]));

  // Validasi SELURUH permintaan dulu, baru menulis. Menolak di tengah akan
  // meninggalkan sebagian refund tertulis dengan uang yang tak pernah
  // diserahkan.
  const tambahan = new Map<string, number>();
  for (const it of params.items) {
    const b = byId.get(it.saleItemId);
    if (!b) throw new HTTPException(400, { message: "Sajian tidak ada di transaksi ini" });
    if (!(it.qty > 0)) {
      throw new HTTPException(400, { message: `Jumlah refund ${b.menuNama} harus lebih dari 0` });
    }
    const sudah = tambahan.get(it.saleItemId) ?? 0;
    const sisa = qtyDitagih(b) - sudah;
    if (it.qty > sisa + 1e-9) {
      throw new HTTPException(400, {
        message:
          sisa <= 0
            ? `${b.menuNama} sudah dikembalikan seluruhnya`
            : `${b.menuNama} hanya bisa dikembalikan ${sisa} porsi lagi`,
      });
    }
    tambahan.set(it.saleItemId, sudah + it.qty);
  }

  /**
   * JANGKAR. `subtotal_asal` diisi hanya sekali — nilai terkini pada penjualan
   * yang belum pernah direfund MEMANG nilai asalnya. Kalau ikut ditimpa tiap
   * refund, refund kedua akan menghitung diskon dari angka yang sudah
   * menyusut, dan potongannya tergerus dua kali.
   */
  const asal = {
    subtotal: sale.subtotalAsal ?? sale.subtotal,
    diskon: sale.diskonAsal ?? sale.diskon,
    pb1: sale.pb1Asal ?? sale.pb1Amount,
  };

  const barisBaru = baris.map((b) => ({
    hargaSatuan: b.hargaSatuan,
    qty: b.qty,
    qtyRefund: b.qtyRefund + (tambahan.get(b.id) ?? 0),
  }));
  const sesudah = hitungUangSetelahRefund(barisBaru, asal);
  const nominal = nominalRefund({ ...asal, total: sale.total }, sesudah);

  /**
   * Shift yang MENANGGUNG refund ini — laci tempat uangnya keluar.
   *
   * Tanpa penautan ini, rekap mencocokkan refund ke shift MURNI lewat jendela
   * waktu, dan refund yang dibuat saat tak ada shift terbuka (owner/admin
   * meninjau di luar jam buka — jalur yang memang disengaja) jatuh di luar
   * jendela shift mana pun: uang tunai keluar laci tapi kas harapan tak pernah
   * turun, jadi selisihnya tak pernah terangkat di tutup kasir.
   *
   * NULL di sini berarti tegas "tak ada shift terbuka saat itu", dan rekap
   * menyapunya ke shift BERIKUTNYA yang dibuka di cabang ini.
   */
  const [shiftAktif] = await tx
    .select({ id: shifts.id })
    .from(shifts)
    .where(
      and(
        eq(shifts.companyId, params.companyId),
        eq(shifts.branchId, sale.branchId),
        isNull(shifts.closedAt),
      ),
    )
    .limit(1);

  for (const [saleItemId, qty] of tambahan) {
    await tx
      .update(saleItems)
      .set({ qtyRefund: sql`${saleItems.qtyRefund} + ${qty}` })
      .where(eq(saleItems.id, saleItemId));
    await tx.insert(saleRefunds).values({
      companyId: params.companyId,
      branchId: sale.branchId,
      saleId: params.saleId,
      saleItemId,
      qty,
      // Nominal per baris dibiarkan proporsional terhadap kontribusinya pada
      // total refund kejadian ini — jumlah seluruh barisnya = `nominal`.
      nominal: bagianNominal(nominal, tambahan, byId, saleItemId),
      alasan: params.alasan?.trim() || null,
      userId: params.userId,
      shiftId: shiftAktif?.id ?? null,
    });
  }

  await tx
    .update(sales)
    .set({
      subtotal: sesudah.subtotal,
      diskon: sesudah.diskon,
      pb1Amount: sesudah.pb1,
      total: sesudah.total,
      subtotalAsal: asal.subtotal,
      diskonAsal: asal.diskon,
      pb1Asal: asal.pb1,
      refundTotal: sale.refundTotal + nominal,
      // Uang tunai yang benar-benar tinggal di laci = yang diterima dikurangi
      // yang dikembalikan. Tanpa ini, "kembalian" di struk (uang_diterima −
      // total) membengkak sebesar refund — angka yang tak pernah diserahkan.
      ...(sale.metodeBayar === "tunai" && sale.uangDiterima != null
        ? { uangDiterima: Math.max(sesudah.total, sale.uangDiterima - nominal) }
        : {}),
    })
    .where(eq(sales.id, params.saleId));

  // HPP & stok menyusul kenyataan: sajian yang tak dibuat tak memakai bahan.
  // `TANPA_UBAH_BASIS`: refund tidak mengubah cara penyajian satu baris pun,
  // jadi harga pokok per porsi harus tetap angka historisnya — yang menyusut
  // cuma jumlah porsi yang ditagih. Tanpa ini, merefund satu porsi menulis
  // ulang HPP seluruh transaksi dengan harga bahan hari ini dan menggeser
  // laba-rugi periode yang sudah lewat.
  await hitungUlangBiayaPenjualan(tx, params.saleId, params.companyId, TANPA_UBAH_BASIS);

  return { nominal, totalLama: sale.total, totalBaru: sesudah.total };
}

/**
 * Membagi nominal refund kejadian ini ke tiap baris, sebanding nilai kotornya.
 *
 * Dipakai HANYA untuk riwayat `sale_refunds` — angka penjualan yang sah tetap
 * datang dari `hitungUangSetelahRefund`. Baris terakhir menyerap sisa
 * pembulatan supaya jumlah seluruh barisnya persis sama dengan yang diserahkan
 * ke pembeli; kalau tidak, laporan refund akan meleset beberapa rupiah dari kas.
 */
function bagianNominal(
  nominal: number,
  tambahan: Map<string, number>,
  byId: Map<string, { hargaSatuan: number }>,
  saleItemId: string,
): number {
  const entri = [...tambahan];
  const kotor = (id: string, qty: number) => (byId.get(id)?.hargaSatuan ?? 0) * qty;
  const totalKotor = entri.reduce((a, [id, qty]) => a + kotor(id, qty), 0);
  if (totalKotor <= 0) return 0;
  const terakhir = entri[entri.length - 1][0];
  if (saleItemId !== terakhir) {
    return Math.round((nominal * kotor(saleItemId, tambahan.get(saleItemId)!)) / totalKotor);
  }
  const lain = entri
    .slice(0, -1)
    .reduce((a, [id, qty]) => a + Math.round((nominal * kotor(id, qty)) / totalKotor), 0);
  return nominal - lain;
}

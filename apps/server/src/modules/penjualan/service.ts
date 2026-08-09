import { and, desc, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import {
  hitungPb1,
  penandaSajian,
  qtyEfektif,
  type SaleItemInput,
  type SebabPenjualanGagal,
} from "@kakarut/shared";
import { db } from "../../db/client";
import {
  branches,
  companies,
  meja,
  openBillItems,
  openBills,
  saleConsumptions,
  saleItems,
  sales,
} from "../../db/schema";
import { kodeCabang, tanggalDi } from "../../lib/time";
import { upsertCustomer } from "../customer/service";
import { hitungHargaMenu, komponenEfektif, loadKatalog, tampilDiCabang } from "../menu/service";

/**
 * Penolakan penjualan yang membawa SEBAB terstruktur, bukan cuma teks.
 *
 * Klien offline harus memutuskan nasib perintah di antreannya: dibuang (karena
 * transaksinya SUDAH tercatat) atau ditampilkan ke kasir (karena TIDAK). Teks
 * pesan tak boleh jadi dasar keputusan itu — ia berubah kapan saja dan tak
 * bisa diuji. `sebab` ikut ke badan respons lewat `app.onError` (jalur online)
 * maupun lewat item gagal `POST /api/sync` (jalur antrean).
 */
export class PenjualanGagal extends HTTPException {
  constructor(
    status: 409,
    message: string,
    readonly sebab: SebabPenjualanGagal,
  ) {
    super(status, { message });
  }
}

export interface CreateSaleParams {
  companyId: string;
  branchId: string;
  cashierUserId: string;
  isDineIn: boolean;
  /** meja terpilih — bila ada, tipe meja jadi sumber kebenaran dine-in transaksi */
  mejaId?: string | null;
  catatan?: string | null;
  /** diskon per transaksi: "persen" (nilai 0–100) atau "nominal" (Rp) */
  diskonTipe?: "persen" | "nominal";
  diskonNilai?: number;
  /** identitas konsumen/member (opsional) — WA jadi kunci member */
  customerNama?: string | null;
  customerWa?: string | null;
  /** pembayaran: metode + uang tunai diterima (untuk kembalian) */
  metodeBayar?: "tunai" | "qris" | "transfer";
  uangDiterima?: number | null;
  /**
   * Waktu kejadian transaksi (sinkron offline). Bila diisi: dipakai sebagai
   * timestamp struk + tanggal bisnis (untuk nomor & rekap/shift). Bila kosong:
   * waktu server saat ini (jalur online biasa).
   */
  waktu?: Date;
  /**
   * Shift kasir tempat transaksi dibukukan (jalur sinkron offline). Diisi agar
   * transaksi susulan tetap masuk rekap shift yang benar meski `waktu`-nya
   * jatuh setelah shift ditutup. Jalur online biasa membiarkannya kosong —
   * penautan lewat jendela waktu sudah cukup.
   */
  shiftId?: string | null;
  /**
   * Open bill yang sedang dibayar. Bila diisi, baris ber-`open_bill_item_id`
   * ditagih memakai harga yang dikunci di bill saat dipesan.
   */
  openBillId?: string | null;
  items: SaleItemInput[];
}

/**
 * Buat transaksi penjualan — SATU transaksi database:
 * struk + item (snapshot harga & HPP) + konsumsi bahan (snapshot, dengan
 * aturan dine-in: kemasan tidak dikonsumsi, complement × 0.5).
 */
export async function createSale(params: CreateSaleParams) {
  if (params.items.length === 0) {
    throw new HTTPException(400, { message: "Transaksi tanpa item" });
  }

  return db.transaction(async (tx) => {
    // Lock baris cabang → nomor struk berurutan aman dari race
    const [branch] = await tx
      .select()
      .from(branches)
      .where(and(eq(branches.id, params.branchId), eq(branches.companyId, params.companyId)))
      .for("update");
    if (!branch) throw new HTTPException(404, { message: "Cabang tidak ditemukan" });

    const [company] = await tx
      .select()
      .from(companies)
      .where(eq(companies.id, params.companyId));
    if (!company) throw new HTTPException(404, { message: "Perusahaan tidak ditemukan" });

    // Meja terpilih menentukan mode transaksi: meja "takeaway" (Ruang Tunggu)
    // → seluruh pesanan bawa pulang; meja biasa → dine-in (tiap item masih bisa
    // di-override jadi bawa pulang). mejaLabel disnapshot agar struk/riwayat tetap
    // benar meski meja kelak diganti nama/dihapus.
    let isDineIn = params.isDineIn;
    let mejaId: string | null = null;
    let mejaLabel: string | null = null;
    if (params.mejaId) {
      const [m] = await tx
        .select()
        .from(meja)
        .where(
          and(
            eq(meja.id, params.mejaId),
            eq(meja.companyId, params.companyId),
            eq(meja.branchId, branch.id),
          ),
        );
      if (!m) throw new HTTPException(404, { message: "Meja tidak ditemukan" });
      mejaId = m.id;
      mejaLabel = m.nama;
      isDineIn = m.tipe === "dine_in";
    }

    const katalog = await loadKatalog(tx, params.companyId);
    const menuById = new Map(katalog.rows.map((r) => [r.id, r]));

    // HARGA TERKUNCI OPEN BILL: pembeli ditagih harga saat memesan, bukan harga
    // menu hari pembayaran. Baris bill dimuat di sini (dalam transaksi yang
    // sama) dan divalidasi milik bill, perusahaan, dan cabang yang benar —
    // tanpa itu kasir bisa menunjuk baris bill mana pun untuk menekan harga.
    const hargaBill = new Map<string, number>();
    /**
     * Status pengerjaan & penanda penyajian DIWARISI dari baris open bill,
     * PER BARIS. Dapur mungkin sudah menyelesaikan sebagian pesanan ini sebelum
     * pelanggan membayar; tanpa pewarisan, pembayaran memunculkannya lagi
     * sebagai pekerjaan yang belum tersentuh — dan yang paling merugikan,
     * pekerjaan yang SUDAH selesai ikut kembali ke antrean.
     */
    const warisBill = new Map<
      string,
      {
        pesananStatus: "dikerjakan" | "selesai" | "batal";
        pesananStatusAt: Date | null;
        pesananStatusOleh: string | null;
        sajianTakeaway: boolean;
      }
    >();
    if (params.openBillId) {
      const [bill] = await tx
        .select({
          id: openBills.id,
          branchId: openBills.branchId,
          closedAt: openBills.closedAt,
          saleId: openBills.saleId,
        })
        .from(openBills)
        .where(
          and(
            eq(openBills.id, params.openBillId),
            eq(openBills.companyId, params.companyId),
            eq(openBills.branchId, branch.id),
          ),
        )
        /*
         * `FOR UPDATE` — alasannya sama persis dengan refund sajian, dan tanpa
         * ini penjaga `closedAt` di bawah cuma menangkap kasus BERURUTAN.
         *
         * Dua kasir menekan "bayar" pada bill yang sama di saat yang sama akan
         * sama-sama membaca `closed_at` masih kosong (READ COMMITTED tak
         * memperlihatkan tulisan yang belum di-commit), sama-sama lolos
         * penjaganya, dan sama-sama MENERBITKAN PENJUALAN. Yang kedua lalu
         * gagal mengunci bill-nya — tapi diam-diam, sebab `UPDATE … WHERE
         * closed_at IS NULL` yang tak cocok satu baris pun bukan galat.
         * Hasilnya: satu bill, dua transaksi, tamu tertagih dua kali.
         *
         * Mengunci barisnya membuat yang kedua MENUNGGU, lalu membaca
         * `closed_at` yang sudah terisi dan ditolak 409 dengan sebab yang benar
         * — jalur yang memang sudah disiapkan untuk klien offline.
         *
         * Idempotensi `client_ref` TIDAK menutup ini: dua kasir (atau dua
         * perangkat) mengirim `client_ref` yang berbeda untuk bill yang sama.
         */
        .for("update");
      if (!bill) throw new HTTPException(404, { message: "Open bill tidak ditemukan" });
      // Bill yang sudah ditutup tak boleh dibayar lagi — tanpa penjaga ini satu
      // bill bisa jadi dua transaksi bila tombol bayar tertekan dua kali atau
      // antrean offline mengirim ulang.
      //
      // DUA SEBAB, ARTINYA BERLAWANAN, dan klien offline WAJIB bisa
      // membedakannya: `saleId` terisi = bill ini sudah jadi penjualan, jadi
      // kiriman ulangnya kembar dan aman dibuang dari antrean. `saleId` kosong
      // = bill DIBATALKAN tanpa pernah jadi penjualan, jadi membuang
      // perintahnya berarti kehilangan satu transaksi sungguhan.
      if (bill.closedAt) {
        throw bill.saleId
          ? new PenjualanGagal(409, "Open bill ini sudah dibayar", "bill_sudah_dibayar")
          : new PenjualanGagal(409, "Open bill ini sudah dibatalkan", "bill_dibatalkan");
      }
      const barisBill = await tx
        .select({
          id: openBillItems.id,
          menuId: openBillItems.menuId,
          hargaSatuan: openBillItems.hargaSatuan,
          pesananStatus: openBillItems.pesananStatus,
          pesananStatusAt: openBillItems.pesananStatusAt,
          pesananStatusOleh: openBillItems.pesananStatusOleh,
          sajianTakeaway: openBillItems.sajianTakeaway,
        })
        .from(openBillItems)
        .where(eq(openBillItems.billId, bill.id));
      const byId = new Map(barisBill.map((b) => [b.id, b]));
      for (const item of params.items) {
        if (!item.open_bill_item_id) continue;
        const baris = byId.get(item.open_bill_item_id);
        if (!baris || baris.menuId !== item.menu_id) {
          throw new HTTPException(400, {
            message: "Baris open bill tidak cocok dengan menu yang dibayar",
          });
        }
        hargaBill.set(item.open_bill_item_id, baris.hargaSatuan);
        warisBill.set(item.open_bill_item_id, {
          pesananStatus: baris.pesananStatus,
          pesananStatusAt: baris.pesananStatusAt,
          pesananStatusOleh: baris.pesananStatusOleh,
          sajianTakeaway: baris.sajianTakeaway,
        });
      }
    } else if (params.items.some((i) => i.open_bill_item_id)) {
      throw new HTTPException(400, {
        message: "open_bill_item_id butuh open_bill_id transaksi",
      });
    }

    let subtotal = 0;
    let totalHpp = 0;
    const itemRows: Omit<typeof saleItems.$inferInsert, "saleId">[] = [];
    const konsumsi = new Map<string, number>(); // ingredientId -> qty

    for (const item of params.items) {
      const menu = menuById.get(item.menu_id);
      if (!menu || !menu.isActive) {
        throw new HTTPException(400, { message: `Menu tidak ditemukan/nonaktif: ${item.menu_id}` });
      }
      // Pembatasan lokasi (mode Pro): menu yang dibatasi hanya boleh terjual
      // di cabang whitelist-nya — titik penegakan utama.
      if (!tampilDiCabang(katalog, menu.id, branch.id)) {
        throw new HTTPException(400, {
          message: `Menu "${menu.nama}" tidak tersedia di cabang ini`,
        });
      }
      if (item.qty <= 0) {
        throw new HTTPException(400, { message: `Qty tidak valid untuk ${menu.nama}` });
      }
      // FAKTA PEMBUKUAN: di mana pesanan ini dimakan. Menentukan pemisahan
      // omzet dine-in/bawa-pulang dan label meja pada struk — bukan biaya.
      const dineIn = item.is_dine_in ?? isDineIn;
      const waris = item.open_bill_item_id ? warisBill.get(item.open_bill_item_id) : undefined;
      /**
       * Penanda penyajian. Aturannya tinggal di `@kakarut/shared` karena papan
       * pesanan menyimpulkan sesuatu DARI aturan ini (lihat
       * `sajianBedaDariNota`) — dua salinan yang berbeda melahirkan tuduhan
       * palsu di layar.
       */
      const sajianTakeaway = penandaSajian({
        warisTakeaway: waris?.sajianTakeaway,
        dineIn,
      });
      /**
       * BASIS BIAYA = penyajiannya, bukan pembukuannya.
       *
       * Kemasan take away benar-benar keluar dari rak begitu sebuah porsi
       * dibawa pulang — walau transaksinya dibukukan di meja dine-in karena
       * pembeli baru berubah pikiran setelah pesan. Sebelumnya biaya diambil
       * dari `dineIn`, sehingga penanda dapur "jadikan TA" sampai ke layar
       * tapi tidak pernah sampai ke HPP maupun ke `sale_consumptions`: dusnya
       * terpakai, laba-rugi tak tahu, stok kemasan tak berkurang.
       *
       * Hari ini nilainya identik dengan `dineIn` di jalur biasa (penanda
       * lahir dari `!dineIn`); ia baru berbeda tepat pada kasus "diubah
       * menjadi TA" — dan di situlah perbedaannya memang diinginkan.
       */
      const dasarDineIn = !sajianTakeaway;
      // HPP tetap dihitung SAAT INI — biaya bahan memang biaya saat disajikan;
      // yang dikunci open bill hanyalah harga jual yang disepakati pembeli.
      const hppSatuan = hitungHargaMenu(menu, katalog, dasarDineIn);
      const hargaSatuan = item.open_bill_item_id
        ? hargaBill.get(item.open_bill_item_id) ?? menu.hargaJual
        : menu.hargaJual;
      const lineTotal = hargaSatuan * item.qty;

      subtotal += lineTotal;
      totalHpp += hppSatuan * item.qty;
      itemRows.push({
        menuId: menu.id,
        menuNama: menu.nama,
        hargaSatuan,
        hppSatuan,
        qty: item.qty,
        isDineIn: dineIn,
        catatan: item.catatan?.trim() || null,
        lineTotal,
        // Pekerjaan dapur pindah utuh dari baris bill ke baris penjualan —
        // termasuk siapa & kapan menandainya, supaya riwayatnya tidak putus
        // di titik pembayaran.
        pesananStatus: waris?.pesananStatus ?? "dikerjakan",
        pesananStatusAt: waris?.pesananStatusAt ?? null,
        pesananStatusOleh: waris?.pesananStatusOleh ?? null,
        sajianTakeaway,
      });

      for (const k of komponenEfektif(katalog, menu)) {
        // bahan yang tidak dilacak stoknya: tetap masuk HPP, tapi tidak
        // menghasilkan catatan konsumsi
        if (!k.track_stok) continue;
        const qty =
          qtyEfektif(
            { qty: k.qty, isPackaging: k.is_packaging, isComplement: k.is_complement },
            dasarDineIn,
          ) * item.qty;
        if (qty <= 0) continue;
        konsumsi.set(k.ingredient_id, (konsumsi.get(k.ingredient_id) ?? 0) + qty);
      }
    }

    // Diskon per transaksi: clamp agar diskon ∈ [0, subtotal] (total tak pernah negatif).
    // PB1 dihitung atas nilai net (subtotal − diskon).
    let diskon = 0;
    let diskonPersen: number | null = null;
    const nilai = params.diskonNilai ?? 0;
    if (params.diskonTipe === "persen" && nilai > 0) {
      const pct = Math.min(100, Math.max(0, nilai));
      diskon = Math.min(subtotal, Math.round((subtotal * pct) / 100));
      diskonPersen = pct;
    } else if (params.diskonTipe === "nominal" && nilai > 0) {
      diskon = Math.min(subtotal, Math.max(0, Math.round(nilai)));
    }
    /*
     * Batas diskon kasir. Toleransi 0,5% ada untuk PEMBULATAN — diskon nominal
     * yang dibagi subtotal jarang jatuh persis di batasnya.
     *
     * Tapi batas NOL tidak punya apa pun untuk dibulatkan. `0 + 0.5` membuat
     * "kasir tak boleh memberi diskon sama sekali" diam-diam berarti "boleh,
     * asal di bawah setengah persen" — Rp 10.000 pada nota Rp 2 juta, tiap
     * transaksi, tanpa persetujuan siapa pun dan tanpa jejak selain angka
     * diskon di nota. Maka pada nol, toleransinya juga nol.
     */
    const toleransi = company.diskonMaksPersen === 0 ? 0 : 0.5;
    if (subtotal > 0 && diskon > 0) {
      const pctEfektif = (diskon / subtotal) * 100;
      if (pctEfektif > company.diskonMaksPersen + toleransi) {
        throw new HTTPException(400, {
          message: `Diskon melebihi batas maksimal kasir (${company.diskonMaksPersen}%)`,
        });
      }
    }
    const subtotalNet = subtotal - diskon;
    const pb1Amount = company.pb1Enabled ? hitungPb1(subtotalNet, company.pb1Rate) : 0;
    const total = subtotalNet + pb1Amount;
    // Tanggal bisnis dihitung dari waktu kejadian (offline) bila diberikan.
    const saleDate = tanggalDi(company.timezone, params.waktu);

    // Pembayaran: metode + uang tunai diterima. Untuk tunai, uang (bila diisi)
    // wajib ≥ total; non-tunai → tanpa uang diterima (kembalian 0).
    const metodeBayar = params.metodeBayar ?? "tunai";
    let uangDiterima: number | null = null;
    if (metodeBayar === "tunai" && params.uangDiterima != null) {
      uangDiterima = Math.round(params.uangDiterima);
      if (uangDiterima < total) {
        throw new HTTPException(400, { message: "Uang diterima kurang dari total belanja" });
      }
    }

    // Urutan diambil dari nomor TERBESAR hari itu (bukan count) supaya void
    // (hard delete) di tengah hari tidak membuat nomor bekas terpakai lagi.
    const [last] = await tx
      .select({ nomor: sales.nomor })
      .from(sales)
      .where(and(eq(sales.branchId, branch.id), eq(sales.saleDate, saleDate)))
      .orderBy(desc(sales.nomor))
      .limit(1);
    const seq = last ? parseInt(last.nomor.slice(-4), 10) + 1 : 1;
    const nomor = `${kodeCabang(branch.nama)}-${saleDate.replaceAll("-", "")}-${String(seq).padStart(4, "0")}`;

    // Member/pelanggan: bila WA diisi → cari-atau-buat member (dedup per WA) &
    // link ke sale. Nama disnapshot (juga saat tanpa WA) agar riwayat tetap benar.
    const member = await upsertCustomer(tx, params.companyId, params.customerNama, params.customerWa);
    const customerNama = member?.nama ?? params.customerNama?.trim() ?? null;

    const [sale] = await tx
      .insert(sales)
      .values({
        companyId: params.companyId,
        branchId: branch.id,
        cashierUserId: params.cashierUserId,
        nomor,
        isDineIn,
        mejaId,
        mejaLabel,
        subtotal,
        diskon,
        diskonPersen,
        pb1Amount,
        total,
        totalHpp,
        catatan: params.catatan ?? null,
        customerId: member?.id ?? null,
        customerNama: customerNama || null,
        customerWa: member?.wa ?? null,
        metodeBayar,
        uangDiterima,
        saleDate,
        shiftId: params.shiftId ?? null,
        asalOpenBillId: params.openBillId ?? null,
        ...(params.waktu ? { waktu: params.waktu } : {}),
      })
      .returning();

    /**
     * TUTUP open bill di sini — di dalam transaksi yang sama dengan
     * pembuatan transaksinya.
     *
     * Dulu penutupan dikirim browser sebagai DELETE fire-and-forget setelah
     * bayar, dan jalur sinkron offline tak pernah mengirimnya sama sekali.
     * Akibatnya bill hantu menumpuk: pesanan yang sudah dibayar tetap
     * nongkrong di daftar bill selamanya. Begitu papan pesanan menayangkan
     * bill ke seluruh cabang, hantu itu jadi kartu ganda yang tak bisa
     * dihilangkan siapa pun.
     *
     * Barisnya tidak dihapus, hanya ditutup — jejak asal pesanan (termasuk
     * riwayat status sebelum dibayar) tetap bisa ditelusuri.
     */
    if (params.openBillId) {
      const kunci = await tx
        .update(openBills)
        .set({ closedAt: new Date(), saleId: sale.id })
        .where(and(eq(openBills.id, params.openBillId), isNull(openBills.closedAt)))
        .returning({ id: openBills.id });
      /*
       * Kunci baris di atas sudah membuat keadaan ini mustahil. Diperiksa juga
       * di sini supaya kalau kuncinya suatu saat hilang, gagalnya BERSUARA —
       * bukan menerbitkan penjualan kedua tanpa jejak seperti sebelumnya.
       */
      if (kunci.length === 0) {
        throw new PenjualanGagal(409, "Open bill ini sudah dibayar", "bill_sudah_dibayar");
      }
    }

    const insertedItems = await tx
      .insert(saleItems)
      .values(itemRows.map((r) => ({ ...r, saleId: sale.id })))
      .returning();

    if (konsumsi.size > 0) {
      await tx.insert(saleConsumptions).values(
        [...konsumsi].map(([ingredientId, qty]) => ({
          saleId: sale.id,
          companyId: params.companyId,
          branchId: branch.id,
          ingredientId,
          qty,
          waktu: sale.waktu,
        })),
      );
    }

    return { sale, items: insertedItems, branch_nama: branch.nama };
  });
}

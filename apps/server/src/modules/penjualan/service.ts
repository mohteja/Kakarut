import { and, desc, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { hitungPb1, qtyEfektif, type SaleItemInput } from "@kakarut/shared";
import { db } from "../../db/client";
import { branches, companies, meja, saleConsumptions, saleItems, sales } from "../../db/schema";
import { kodeCabang, tanggalDi } from "../../lib/time";
import { upsertCustomer } from "../customer/service";
import { hitungHargaMenu, loadKatalog, tampilDiCabang } from "../menu/service";

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
  /** owner/admin boleh melampaui batas diskon maksimal kasir */
  bypassDiskonLimit?: boolean;
  /** identitas konsumen/member (opsional) — WA jadi kunci member */
  customerNama?: string | null;
  customerWa?: string | null;
  /** pembayaran: metode + uang tunai diterima (untuk kembalian) */
  metodeBayar?: "tunai" | "qris" | "transfer";
  uangDiterima?: number | null;
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
      const dineIn = item.is_dine_in ?? isDineIn;
      const hppSatuan = hitungHargaMenu(menu, katalog, dineIn);
      const lineTotal = menu.hargaJual * item.qty;

      subtotal += lineTotal;
      totalHpp += hppSatuan * item.qty;
      itemRows.push({
        menuId: menu.id,
        menuNama: menu.nama,
        hargaSatuan: menu.hargaJual,
        hppSatuan,
        qty: item.qty,
        isDineIn: dineIn,
        catatan: item.catatan?.trim() || null,
        lineTotal,
      });

      // Konsumsi bahan: komponen sendiri + (untuk paket) komponen menu dasar
      const sumberKomponen = [
        ...(katalog.komponenByMenu.get(menu.id) ?? []),
        ...(menu.tipe === "paket" && menu.baseMenuId
          ? katalog.komponenByMenu.get(menu.baseMenuId) ?? []
          : []),
      ];
      for (const k of sumberKomponen) {
        // bahan yang tidak dilacak stoknya: tetap masuk HPP, tapi tidak
        // menghasilkan catatan konsumsi
        if (!k.track_stok) continue;
        const qty =
          qtyEfektif(
            { qty: k.qty, isPackaging: k.is_packaging, isComplement: k.is_complement },
            dineIn,
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
    // Batas diskon kasir (owner/admin bypass). +0.5% toleransi pembulatan.
    if (!params.bypassDiskonLimit && subtotal > 0 && diskon > 0) {
      const pctEfektif = (diskon / subtotal) * 100;
      if (pctEfektif > company.diskonMaksPersen + 0.5) {
        throw new HTTPException(400, {
          message: `Diskon melebihi batas maksimal kasir (${company.diskonMaksPersen}%)`,
        });
      }
    }
    const subtotalNet = subtotal - diskon;
    const pb1Amount = company.pb1Enabled ? hitungPb1(subtotalNet, company.pb1Rate) : 0;
    const total = subtotalNet + pb1Amount;
    const saleDate = tanggalDi(company.timezone);

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
      })
      .returning();

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

import { and, desc, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { hitungPb1, qtyEfektif, type SaleItemInput } from "@kakarut/shared";
import { db } from "../../db/client";
import { branches, companies, saleConsumptions, saleItems, sales } from "../../db/schema";
import { kodeCabang, tanggalDi } from "../../lib/time";
import { hitungHargaMenu, loadKatalog } from "../menu/service";

export interface CreateSaleParams {
  companyId: string;
  branchId: string;
  cashierUserId: string;
  isDineIn: boolean;
  catatan?: string | null;
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
      if (item.qty <= 0) {
        throw new HTTPException(400, { message: `Qty tidak valid untuk ${menu.nama}` });
      }
      const dineIn = item.is_dine_in ?? params.isDineIn;
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

    const pb1Amount = company.pb1Enabled ? hitungPb1(subtotal, company.pb1Rate) : 0;
    const saleDate = tanggalDi(company.timezone);

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

    const [sale] = await tx
      .insert(sales)
      .values({
        companyId: params.companyId,
        branchId: branch.id,
        cashierUserId: params.cashierUserId,
        nomor,
        isDineIn: params.isDineIn,
        subtotal,
        pb1Amount,
        total: subtotal + pb1Amount,
        totalHpp,
        catatan: params.catatan ?? null,
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

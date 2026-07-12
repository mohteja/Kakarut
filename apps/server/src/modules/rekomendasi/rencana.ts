/**
 * Rencana penambahan stok DARI MENU: owner memasang target porsi per menu →
 * sistem menghitung total kebutuhan bahan (resep sendiri + menu dasar paket),
 * membandingkan dengan saldo cabang, lalu bisa menerbitkan faktur produksi &
 * faktur beli otomatis untuk KEKURANGANNYA — owner tak perlu hitung manual.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import {
  jumlahFaktur,
  kebutuhanBahanRencana,
  kekuranganBahan,
  qtyBahanPerPorsi,
  type RencanaBahanRow,
  type RencanaFakturResult,
  type RencanaMenuItem,
  type RencanaMenuPreview,
  type RencanaMenuRingkas,
} from "@kakarut/shared";
import { db } from "../../db/client";
import {
  companies,
  ingredients,
  memberships,
  productions,
  suppliers,
} from "../../db/schema";
import { tanggalDi } from "../../lib/time";
import { loadKatalog } from "../menu/service";
import { hitungSaldoCabang } from "../stok/service";

/**
 * Hitung preview rencana: kebutuhan per bahan = Σ porsi × qty per porsi
 * (komponen sendiri + menu dasar untuk paket, qty penuh bawa-pulang — sama
 * dengan perhitungan ketersediaan). Kekurangan = max(0, kebutuhan − saldo).
 * Hanya bahan aktif & terlacak (yang punya saldo cabang) yang diperhitungkan.
 */
export async function rencanaDariMenu(
  companyId: string,
  branchId: string,
  items: RencanaMenuItem[],
): Promise<RencanaMenuPreview> {
  // gabungkan duplikat menu (porsi dijumlah)
  const porsiByMenu = new Map<string, number>();
  for (const it of items) {
    porsiByMenu.set(it.menu_id, (porsiByMenu.get(it.menu_id) ?? 0) + it.porsi);
  }

  const [katalog, saldoRows, extraRows] = await Promise.all([
    loadKatalog(db, companyId),
    hitungSaldoCabang(companyId, branchId),
    db
      .select({ id: ingredients.id, pengadaan: ingredients.pengadaan, hargaBeli: ingredients.hargaBeli })
      .from(ingredients)
      .where(eq(ingredients.companyId, companyId)),
  ]);
  const menuById = new Map(katalog.rows.map((r) => [r.id, r]));
  const bahanById = new Map(saldoRows.map((r) => [r.ingredient_id, r]));
  const extraById = new Map(extraRows.map((r) => [r.id, r]));

  const menus: RencanaMenuRingkas[] = [];
  const rencana: { qtyPerPorsi: Map<string, number>; porsi: number }[] = [];
  for (const [menuId, porsi] of porsiByMenu) {
    const menu = menuById.get(menuId);
    if (!menu) throw new HTTPException(400, { message: `Menu tidak ditemukan (${menuId})` });
    if (!menu.isActive) {
      throw new HTTPException(400, { message: `Menu "${menu.nama}" nonaktif` });
    }
    const komponen = [
      ...(katalog.komponenByMenu.get(menu.id) ?? []),
      ...(menu.tipe === "paket" && menu.baseMenuId
        ? katalog.komponenByMenu.get(menu.baseMenuId) ?? []
        : []),
    ];
    rencana.push({ qtyPerPorsi: qtyBahanPerPorsi(komponen), porsi });
    menus.push({
      menu_id: menu.id,
      nama: menu.nama,
      kode: menu.kode,
      porsi,
      harga_jual: menu.hargaJual,
      omzet: porsi * menu.hargaJual,
    });
  }

  const kebutuhan = kebutuhanBahanRencana(rencana);
  const bahan: RencanaBahanRow[] = [];
  for (const [ingredientId, butuh] of kebutuhan) {
    // bahan tanpa saldo cabang (nonaktif) tidak bisa direncanakan — lewati,
    // konsisten dengan perhitungan ketersediaan yang mengabaikannya
    const s = bahanById.get(ingredientId);
    if (!s) continue;
    const e = extraById.get(ingredientId);
    const pengadaan = e?.pengadaan ?? "beli";
    const hargaPerUnit = e && s.isi > 0 ? e.hargaBeli / s.isi : 0;
    // toleransi presisi float: noise (mis. 5e-17) tidak memicu faktur hantu
    const kurang = kekuranganBahan(butuh, s.saldo);
    const faktur = kurang > 0 ? jumlahFaktur(kurang, pengadaan, s.isi) : null;
    bahan.push({
      ingredient_id: ingredientId,
      nama: s.nama,
      satuan: s.satuan,
      pengadaan,
      kebutuhan: butuh,
      saldo: s.saldo,
      kurang,
      isi: s.isi,
      mode_faktur: faktur?.mode ?? null,
      jumlah_faktur: faktur?.jumlah ?? null,
      qty_faktur: faktur?.qty ?? null,
      harga_per_unit: hargaPerUnit,
      // sama dengan hargaDefault faktur: round((qty/isi) × hargaBeli)
      estimasi_biaya: faktur ? Math.round(faktur.qty * hargaPerUnit) : null,
    });
  }
  // urut: paling kurang dulu, lalu kebutuhan terbesar
  bahan.sort((a, b) => b.kurang - a.kurang || b.kebutuhan - a.kebutuhan);

  return {
    menus,
    perkiraan_omzet: menus.reduce((a, m) => a + m.omzet, 0),
    bahan,
    total_estimasi_biaya: bahan.reduce((a, b) => a + (b.estimasi_biaya ?? 0), 0),
    jumlah_produksi: bahan.filter((b) => b.kurang > 0 && b.pengadaan === "produksi").length,
    jumlah_beli: bahan.filter((b) => b.kurang > 0 && b.pengadaan === "beli").length,
  };
}

export interface BuatFakturRencanaParams {
  companyId: string;
  branchId: string;
  userId: string;
  items: RencanaMenuItem[];
  /** pelaksana produksi (wajib salah satu worker/supplier bila ada baris produksi) */
  workerId?: string | null;
  supplierId?: string | null;
  /** pemasok barang faktur BELI (terpisah dari pelaksana produksi; opsional) */
  supplierBeliId?: string | null;
  catatan?: string | null;
}

/**
 * Terbitkan faktur otomatis dari rencana menu: satu faktur PRODUKSI (bahan
 * pengadaan "produksi" yang kurang, dibulatkan per batch) + satu faktur BELI
 * (bahan "beli" yang kurang). Keduanya mulai tahap "rencana" (RAB) — stok baru
 * terhitung setelah pipeline tahap→konfirmasi/penerimaan selesai, jadi owner
 * tetap meninjau dulu.
 */
export async function buatFakturDariRencana(
  params: BuatFakturRencanaParams,
): Promise<RencanaFakturResult & { preview: RencanaMenuPreview }> {
  const preview = await rencanaDariMenu(params.companyId, params.branchId, params.items);
  const kurangRows = preview.bahan.filter(
    (b) => b.kurang > 0 && b.mode_faktur && b.jumlah_faktur != null && b.qty_faktur != null,
  );
  if (kurangRows.length === 0) {
    throw new HTTPException(400, {
      message: "Stok semua bahan masih cukup untuk rencana ini — tidak ada faktur yang perlu dibuat",
    });
  }
  const prodRows = kurangRows.filter((b) => b.pengadaan === "produksi");
  const beliRows = kurangRows.filter((b) => b.pengadaan === "beli");

  // Validasi pelaksana/relasi milik perusahaan (aturan sama dgn faktur manual)
  if (prodRows.length > 0 && !params.workerId && !params.supplierId) {
    throw new HTTPException(400, {
      message: "Pelaksana (karyawan/supplier) wajib dipilih untuk faktur produksi",
    });
  }
  if (params.workerId) {
    const [m] = await db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(
        and(eq(memberships.userId, params.workerId), eq(memberships.companyId, params.companyId)),
      );
    if (!m) throw new HTTPException(400, { message: "Karyawan bukan anggota perusahaan" });
  }
  for (const supplierId of [params.supplierId, params.supplierBeliId]) {
    if (!supplierId) continue;
    const [s] = await db
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(and(eq(suppliers.id, supplierId), eq(suppliers.companyId, params.companyId)));
    if (!s) throw new HTTPException(400, { message: "Supplier tidak valid" });
  }

  const [company] = await db
    .select({ timezone: companies.timezone })
    .from(companies)
    .where(eq(companies.id, params.companyId));
  const prodDate = tanggalDi(company?.timezone ?? "Asia/Jakarta");

  // Catatan default: baca ulang rencana ("50× PBA, 30× PYO") agar faktur
  // mudah dikenali di daftar Produksi/Beli.
  const ringkas = preview.menus.map((m) => `${m.porsi}× ${m.kode ?? m.nama}`).join(", ");
  const catatan = params.catatan?.trim() || `Rencana dari menu: ${ringkas}`.slice(0, 300);

  const barisFaktur = (
    rows: RencanaBahanRow[],
    tipe: "produksi" | "beli",
    fakturId: string,
  ) =>
    rows.map((b) => ({
      companyId: params.companyId,
      branchId: params.branchId,
      ingredientId: b.ingredient_id,
      qty: b.qty_faktur!,
      tipe,
      totalHarga: b.estimasi_biaya ?? 0,
      fakturId,
      noFaktur: null,
      // produksi: supplier hanya sebagai pelaksana alternatif (tanpa karyawan);
      // beli: pemasok barang dari field TERPISAH — supplier pelaksana produksi
      // tidak boleh ikut tercatat sebagai pemasok pembelian
      supplierId:
        tipe === "produksi"
          ? params.workerId
            ? null
            : (params.supplierId ?? null)
          : (params.supplierBeliId ?? null),
      storageLocationId: null,
      status: "rencana" as const,
      isBatch: b.mode_faktur === "batch",
      catatan,
      userId: params.userId,
      workerId: tipe === "produksi" ? (params.workerId ?? null) : null,
      prodDate,
    }));

  const prodFakturId = prodRows.length > 0 ? randomUUID() : null;
  const beliFakturId = beliRows.length > 0 ? randomUUID() : null;
  await db.transaction(async (tx) => {
    if (prodFakturId) {
      await tx.insert(productions).values(barisFaktur(prodRows, "produksi", prodFakturId));
    }
    if (beliFakturId) {
      await tx.insert(productions).values(barisFaktur(beliRows, "beli", beliFakturId));
    }
  });

  return {
    produksi: prodFakturId ? { faktur_id: prodFakturId, jumlah_baris: prodRows.length } : null,
    beli: beliFakturId ? { faktur_id: beliFakturId, jumlah_baris: beliRows.length } : null,
    preview,
  };
}

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
  branches,
  companies,
  ingredients,
  memberships,
  productions,
  suppliers,
} from "../../db/schema";
import { tanggalDi } from "../../lib/time";
import { loadKatalog, tampilDiCabang } from "../menu/service";
import { catatLogFaktur } from "../produksi/log";
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
      .select({
        id: ingredients.id,
        pengadaan: ingredients.pengadaan,
        hargaBeli: ingredients.hargaBeli,
        bolehEceran: ingredients.bolehEceran,
      })
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
    if (!tampilDiCabang(katalog, menu.id, branchId)) {
      throw new HTTPException(400, {
        message: `Menu "${menu.nama}" tidak tersedia di cabang ini`,
      });
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
    const faktur =
      kurang > 0 ? jumlahFaktur(kurang, pengadaan, s.isi, e?.bolehEceran ?? false) : null;
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
  /** cabang tujuan (store) — kebutuhan bahan dihitung di sini */
  branchId: string;
  /**
   * Central Kitchen pelaksana (work-order): bila terisi & ≠ store, faktur
   * PRODUKSI hidup di CK dgn tujuan = store, dan pelaksana ditugaskan karyawan
   * CK saat mulai (bukan dipaksa owner). Null / = store → produksi di tempat.
   */
  ckBranchId?: string | null;
  userId: string;
  items: RencanaMenuItem[];
  /** pelaksana produksi (wajib bila produksi di tempat / bukan work-order) */
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

  // Tentukan mode work-order: produksi dikerjakan Central Kitchen lalu dikirim
  // ke store tujuan. CK = eksplisit (ck_branch_id) atau CK pemasok store.
  const [store] = await db
    .select({
      id: branches.id,
      nama: branches.nama,
      tipe: branches.tipe,
      ckId: branches.centralKitchenId,
    })
    .from(branches)
    .where(and(eq(branches.id, params.branchId), eq(branches.companyId, params.companyId)));
  if (!store) throw new HTTPException(400, { message: "Cabang tujuan tidak valid" });
  // Kantor bukan cabang penyimpanan stok / tujuan permintaan (tak bisa dikirim).
  if (store.tipe === "kantor") {
    throw new HTTPException(400, { message: "Kantor bukan cabang tujuan permintaan stok" });
  }

  let ck: { id: string; nama: string } | null = null;
  // Produksi & beli bahan baku = aktivitas Central Kitchen: keduanya dibukukan
  // di CK (produksi dikirim ke store; beli disimpan di CK).
  if (prodRows.length > 0 || beliRows.length > 0) {
    const ckId = params.ckBranchId ?? store.ckId ?? null;
    if (ckId && ckId !== store.id) {
      const [row] = await db
        .select({ id: branches.id, nama: branches.nama, tipe: branches.tipe })
        .from(branches)
        .where(and(eq(branches.id, ckId), eq(branches.companyId, params.companyId)));
      if (!row || row.tipe !== "central_kitchen") {
        // CK dipilih eksplisit oleh user tapi tak valid → tolak. Bila hanya link
        // tersimpan (store.central_kitchen_id) yang usang — CK-nya dihapus atau
        // di-demote jadi non-CK — jangan gagalkan permintaan: bukukan di store
        // (fallback aman legacy, sama seperti store tanpa CK).
        if (params.ckBranchId != null) {
          throw new HTTPException(400, { message: "Central Kitchen tidak valid" });
        }
      } else {
        // store hanya boleh diproduksi oleh CK pemasoknya (bila terhubung)
        if (store.tipe === "store" && store.ckId && store.ckId !== ckId) {
          throw new HTTPException(400, {
            message: `Cabang "${store.nama}" terhubung ke Central Kitchen lain`,
          });
        }
        ck = { id: row.id, nama: row.nama };
      }
    }
  }
  const workOrder = ck !== null;

  // Pelaksana wajib HANYA untuk produksi di tempat (bukan work-order). Pada
  // work-order, karyawan CK menugaskan dirinya saat "Mulai dikerjakan".
  if (prodRows.length > 0 && !workOrder && !params.workerId && !params.supplierId) {
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

  // Work-order Central Kitchen: produksi & beli sama-sama dibukukan di CK.
  // Produksi punya tujuan = store (dikirim); beli dibukukan di CK tanpa tujuan
  // (disimpan di CK — CK membeli & menyimpan stok bahan).
  const srcBranchId = workOrder ? ck!.id : params.branchId;
  const barisFaktur = (
    rows: RencanaBahanRow[],
    tipe: "produksi" | "beli",
    fakturId: string,
  ) =>
    rows.map((b) => ({
      companyId: params.companyId,
      branchId: srcBranchId,
      tujuanBranchId: tipe === "produksi" && workOrder ? params.branchId : null,
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
          ? workOrder
            ? null
            : params.workerId
              ? null
              : (params.supplierId ?? null)
          : (params.supplierBeliId ?? null),
      storageLocationId: null,
      status: "rencana" as const,
      isBatch: b.mode_faktur === "batch",
      catatan,
      userId: params.userId,
      // work-order: pelaksana diisi karyawan CK saat mulai (self-assign)
      workerId: tipe === "produksi" && !workOrder ? (params.workerId ?? null) : null,
      prodDate,
    }));

  const prodFakturId = prodRows.length > 0 ? randomUUID() : null;
  const beliFakturId = beliRows.length > 0 ? randomUUID() : null;
  // Detail riwayat permintaan: tujuan (bila work-order) + ringkasan menu.
  const detailProd = workOrder ? `Tujuan: ${store.nama} · ${ringkas}` : ringkas;
  await db.transaction(async (tx) => {
    if (prodFakturId) {
      await tx.insert(productions).values(barisFaktur(prodRows, "produksi", prodFakturId));
      // Riwayat: owner/admin membuat permintaan tambah stok (jejak audit)
      await catatLogFaktur(tx, {
        companyId: params.companyId,
        branchId: srcBranchId,
        fakturId: prodFakturId,
        jalur: "produksi",
        aksi: "Permintaan tambah stok",
        detail: detailProd,
        userId: params.userId,
      });
    }
    if (beliFakturId) {
      await tx.insert(productions).values(barisFaktur(beliRows, "beli", beliFakturId));
      await catatLogFaktur(tx, {
        companyId: params.companyId,
        branchId: srcBranchId,
        fakturId: beliFakturId,
        jalur: "beli",
        aksi: "Permintaan tambah stok",
        detail: workOrder ? `Rencana ${store.nama} · ${ringkas}` : ringkas,
        userId: params.userId,
      });
    }
  });

  return {
    produksi: prodFakturId ? { faktur_id: prodFakturId, jumlah_baris: prodRows.length } : null,
    beli: beliFakturId ? { faktur_id: beliFakturId, jumlah_baris: beliRows.length } : null,
    preview,
  };
}

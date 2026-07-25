/**
 * Rencana penambahan stok DARI MENU: owner memasang target porsi per menu →
 * sistem menghitung total kebutuhan bahan (resep sendiri + menu dasar paket),
 * membandingkan dengan saldo cabang, lalu bisa menerbitkan faktur produksi &
 * faktur beli otomatis untuk KEKURANGANNYA — owner tak perlu hitung manual.
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
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
  ingredientComponents,
  ingredientProduksiBranches,
  ingredients,
  memberships,
  productions,
  suppliers,
} from "../../db/schema";
import { tanggalDi } from "../../lib/time";
import { terbitkanNomor } from "../dokumen/nomor";
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
  /** CK pelaksana eksplisit (opsional) — kekurangan bahan mentah resep dihitung di sini */
  ckBranchId?: string | null,
): Promise<RencanaMenuPreview> {
  // gabungkan duplikat menu (porsi dijumlah)
  const porsiByMenu = new Map<string, number>();
  for (const it of items) {
    porsiByMenu.set(it.menu_id, (porsiByMenu.get(it.menu_id) ?? 0) + it.porsi);
  }

  const [katalog, saldoRows, extraRows, produsenRows] = await Promise.all([
    loadKatalog(db, companyId),
    hitungSaldoCabang(companyId, branchId),
    db
      .select({
        id: ingredients.id,
        pengadaan: ingredients.pengadaan,
        produksiDi: ingredients.produksiDi,
        divisiProduksi: ingredients.divisiProduksi,
        hargaBeli: ingredients.hargaBeli,
        bolehEceran: ingredients.bolehEceran,
        minBeli: ingredients.minBeli,
        leadTimeHari: ingredients.leadTimeHari,
      })
      .from(ingredients)
      .where(eq(ingredients.companyId, companyId)),
    db
      .select({
        ingredientId: ingredientProduksiBranches.ingredientId,
        branchId: ingredientProduksiBranches.branchId,
      })
      .from(ingredientProduksiBranches)
      .innerJoin(ingredients, eq(ingredients.id, ingredientProduksiBranches.ingredientId))
      .where(eq(ingredients.companyId, companyId)),
  ]);
  const menuById = new Map(katalog.rows.map((r) => [r.id, r]));
  const bahanById = new Map(saldoRows.map((r) => [r.ingredient_id, r]));
  const extraById = new Map(extraRows.map((r) => [r.id, r]));
  // Daftar CABANG PRODUSEN per bahan (produksi_di "cabang"): kosong = semua
  // cabang store; berisi & TIDAK memuat cabang tujuan → bahan ini bagi cabang
  // tsb diperlakukan seperti produksi CK (kirim CK / work-order CK).
  const produsenByIng = new Map<string, Set<string>>();
  for (const r of produsenRows) {
    const set = produsenByIng.get(r.ingredientId) ?? new Set<string>();
    set.add(r.branchId);
    produsenByIng.set(r.ingredientId, set);
  }
  const produksiDiEfektif = (ingredientId: string, raw: "ck" | "cabang"): "ck" | "cabang" => {
    if (raw !== "cabang") return raw;
    const set = produsenByIng.get(ingredientId);
    return !set || set.has(branchId) ? "cabang" : "ck";
  };

  // Central Kitchen pelaksana (bila ada): STOK CK ikut menutup kebutuhan store —
  // barang yang sudah ada di CK tinggal dikirim ke store, jadi tak perlu
  // diproduksi/dibeli lagi. Resolusi longgar (validasi keras di
  // buatFakturDariRencana): CK eksplisit / CK pemasok store yang valid.
  let pelaksanaId = branchId;
  {
    const [storeRow] = await db
      .select({ ckId: branches.centralKitchenId })
      .from(branches)
      .where(and(eq(branches.id, branchId), eq(branches.companyId, companyId)));
    const kandidat = ckBranchId ?? storeRow?.ckId ?? null;
    if (kandidat && kandidat !== branchId) {
      const [ckRow] = await db
        .select({ id: branches.id, tipe: branches.tipe })
        .from(branches)
        .where(and(eq(branches.id, kandidat), eq(branches.companyId, companyId)));
      if (ckRow?.tipe === "central_kitchen") pelaksanaId = ckRow.id;
    }
  }
  const ckSaldoMap =
    pelaksanaId !== branchId
      ? new Map(
          (await hitungSaldoCabang(companyId, pelaksanaId)).map((r) => [r.ingredient_id, r]),
        )
      : new Map<string, (typeof saldoRows)[number]>();
  const ckStok = (id: string) => ckSaldoMap.get(id)?.saldo ?? 0;
  // Porsi stok CK yang "terpakai" menutup kebutuhan menu-level tiap bahan —
  // dipakai agar bahan yang SAMA (dipakai langsung menu & jadi input produksi)
  // tak menghitung stok CK dua kali (double-count → under-buy).
  const ckDipakaiMenu = new Map<string, number>();

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
    // Lokasi produksi bahan jadi (diatur di Resep): "cabang" = diproduksi
    // kitchen di cabang tujuan — TIDAK dikirim dari stok CK dan fakturnya
    // lahir di cabang (bukan work-order CK). Hanya bermakna utk "produksi".
    // Efektif PER CABANG: cabang di luar daftar produsen jatuh ke jalur CK.
    const produksiDi =
      pengadaan === "produksi" ? produksiDiEfektif(ingredientId, e?.produksiDi ?? "ck") : null;
    const hargaPerUnit = e && s.isi > 0 ? e.hargaBeli / s.isi : 0;
    // Kekurangan dihitung terhadap saldo CABANG saja (jujur — cocok dengan
    // Kartu Stok cabang). Bagian yang STOK JADInya sudah ADA di CK dipenuhi
    // lewat "kirim dari stok" (transfer CK → cabang, TANPA produksi baru);
    // sisanya baru diproduksi/dibeli. Stok minimum (reorder) tak ditambahkan.
    const saldoCk = ckStok(ingredientId);
    const kurang = kekuranganBahan(butuh, s.saldo);
    // hanya bila ada CK pelaksana: stok jadi CK bisa dikirim menutup kekurangan
    // (bahan ber-produksi_di "cabang" TIDAK — diproduksi langsung di cabang)
    const kirimCk =
      pelaksanaId !== branchId && produksiDi !== "cabang" ? Math.min(kurang, saldoCk) : 0;
    ckDipakaiMenu.set(ingredientId, kirimCk);
    // sisa yang benar-benar perlu diproduksi/dibeli baru (setelah kirim CK)
    const perlu = kekuranganBahan(kurang, kirimCk);
    // MOQ (minimal belanja) hanya berlaku utk jalur beli — bukan produksi
    const dasarFaktur =
      pengadaan === "beli" ? Math.max(perlu, perlu > 0 ? (e?.minBeli ?? 0) : 0) : perlu;
    const faktur =
      perlu > 0 ? jumlahFaktur(dasarFaktur, pengadaan, s.isi, e?.bolehEceran ?? false) : null;
    bahan.push({
      ingredient_id: ingredientId,
      nama: s.nama,
      satuan: s.satuan,
      pengadaan,
      kebutuhan: butuh,
      saldo: s.saldo,
      saldo_ck: saldoCk,
      kurang,
      kirim_ck: kirimCk,
      isi: s.isi,
      mode_faktur: faktur?.mode ?? null,
      jumlah_faktur: faktur?.jumlah ?? null,
      qty_faktur: faktur?.qty ?? null,
      harga_per_unit: hargaPerUnit,
      // sama dengan hargaDefault faktur: round((qty/isi) × hargaBeli)
      estimasi_biaya: faktur ? Math.round(faktur.qty * hargaPerUnit) : null,
      lead_time_hari: e?.leadTimeHari ?? 0,
      produksi_di: produksiDi,
      divisi_produksi: produksiDi === "cabang" ? (e?.divisiProduksi ?? "kitchen") : null,
    });
  }
  // urut: paling kurang dulu, lalu kebutuhan terbesar
  bahan.sort((a, b) => b.kurang - a.kurang || b.kebutuhan - a.kebutuhan);

  // ===== BELANJA BAHAN PRODUKSI: ekspansi resep (BOM) bahan jadi =====
  // Produksi juga butuh belanja: bahan jadi yang akan diproduksi diurai ke
  // bahan mentahnya (resep per 1 batch), kekurangannya dihitung terhadap stok
  // cabang PELAKSANA (Central Kitchen bila store terhubung), lalu menjadi
  // faktur beli tersendiri — terpisah dari belanja produk langsung jadi.
  const bahanProduksi: RencanaBahanRow[] = [];
  // yang PERLU diproduksi baru = punya baris faktur (qty_faktur != null); bagian
  // yang dikirim dari stok CK (kirim_ck) TIDAK perlu bahan mentah baru.
  const prodShort = bahan.filter(
    (b) => b.pengadaan === "produksi" && b.qty_faktur != null,
  );
  if (prodShort.length > 0) {
    const resepRows = await db
      .select({
        producedId: ingredientComponents.ingredientId,
        inputId: ingredientComponents.inputIngredientId,
        qty: ingredientComponents.qty,
      })
      .from(ingredientComponents)
      .innerJoin(ingredients, eq(ingredients.id, ingredientComponents.ingredientId))
      .where(
        and(
          eq(ingredients.companyId, companyId),
          inArray(
            ingredientComponents.ingredientId,
            prodShort.map((b) => b.ingredient_id),
          ),
        ),
      );
    if (resepRows.length > 0) {
      // Bahan mentah dihitung PER LOKASI PRODUKSI bahan jadinya:
      // - bahan jadi produksi_di "ck" (default): terhadap stok cabang PELAKSANA
      //   (CK bila store terhubung) — bahan mentah dibeli & disimpan di CK;
      // - bahan jadi produksi_di "cabang": terhadap stok CABANG TUJUAN — bahan
      //   mentahnya dibelanjakan CK lalu DIKIRIM ke cabang (kitchen yang
      //   memproduksi butuh bahannya di cabang).
      // Input yang sama bisa muncul di dua kelompok (dua baris, tujuan beda).
      const kelompok: {
        rows: RencanaBahanRow[];
        saldoMap: Map<string, (typeof saldoRows)[number]>;
        deduksi: (inputId: string) => number;
        lokasi: "ck" | "cabang" | null;
      }[] = [];
      const adaCk = pelaksanaId !== branchId;
      if (!adaCk) {
        // tanpa CK semua produksi di tempat — satu kelompok (perilaku lama)
        kelompok.push({
          rows: prodShort,
          saldoMap: bahanById,
          deduksi: (id) => kebutuhan.get(id) ?? 0,
          lokasi: null,
        });
      } else {
        kelompok.push({
          rows: prodShort.filter((b) => b.produksi_di !== "cabang"),
          saldoMap: ckSaldoMap,
          deduksi: (id) => ckDipakaiMenu.get(id) ?? 0,
          lokasi: "ck",
        });
        kelompok.push({
          rows: prodShort.filter((b) => b.produksi_di === "cabang"),
          saldoMap: bahanById,
          deduksi: (id) => kebutuhan.get(id) ?? 0,
          lokasi: "cabang",
        });
      }

      for (const grp of kelompok) {
        if (grp.rows.length === 0) continue;
        // total kebutuhan bahan mentah = Σ resep × (qty produksi ÷ isi batch)
        const qtyFakturByProduced = new Map(grp.rows.map((b) => [b.ingredient_id, b]));
        const butuhInput = new Map<string, number>();
        const untukByInput = new Map<string, Set<string>>();
        for (const r of resepRows) {
          const prod = qtyFakturByProduced.get(r.producedId);
          if (!prod || prod.isi <= 0) continue;
          const batch = prod.qty_faktur! / prod.isi;
          butuhInput.set(r.inputId, (butuhInput.get(r.inputId) ?? 0) + r.qty * batch);
          const set = untukByInput.get(r.inputId) ?? new Set<string>();
          set.add(prod.nama);
          untukByInput.set(r.inputId, set);
        }

        for (const [inputId, butuh] of butuhInput) {
          // bahan mentah tak dilacak/nonaktif dilewati — konsisten dgn aturan
          // bahan menu (tak punya saldo cabang → tak direncanakan)
          const si = grp.saldoMap.get(inputId);
          if (!si) continue;
          const e = extraById.get(inputId);
          // Belanja otomatis hanya untuk input BELI (bahan baku). Input produksi
          // di dalam resep bertingkat tidak "dibeli" — bahan itu diproduksi
          // sendiri (dari stok / lewat faktur produksinya sendiri), jadi
          // dilewati di rencana BELI ini. (Belum diurai/di-work-order otomatis.)
          if (e?.pengadaan !== "beli") continue;
          const hargaPerUnitInput = si.isi > 0 ? e.hargaBeli / si.isi : 0;
          // Saldo efektif: bahan yang juga dipakai LANGSUNG oleh menu sudah
          // dialokasikan di perhitungan menu-level — saldo yang sama tak boleh
          // dihitung dua kali (double-count → under-buy).
          const saldoEfektif = Math.max(0, si.saldo - grp.deduksi(inputId));
          // Termasuk STOK MINIMUM lokasi hitung: bahan mentah yang cukup utk
          // produksi tapi sisa stoknya bakal jatuh di bawah ambang minimum
          // IKUT dibeli — selaras faktur beli otomatis pada faktur produksi.
          const kurang = kekuranganBahan(butuh + (si.stok_minimum ?? 0), saldoEfektif);
          const dasarFaktur = kurang > 0 ? Math.max(kurang, e.minBeli ?? 0) : 0;
          const faktur =
            kurang > 0 ? jumlahFaktur(dasarFaktur, "beli", si.isi, e.bolehEceran ?? false) : null;
          bahanProduksi.push({
            ingredient_id: inputId,
            nama: si.nama,
            satuan: si.satuan,
            pengadaan: "beli",
            kebutuhan: butuh,
            saldo: si.saldo,
            // saldo_ck di baris bahan-mentah = saldo lokasi hitung bila CK
            saldo_ck: grp.lokasi === "ck" ? si.saldo : 0,
            kurang,
            // bahan mentah dibeli (disimpan di CK / dikirim ke cabang) — tak
            // ada "kirim dari stok" utk baris belanja
            kirim_ck: 0,
            isi: si.isi,
            mode_faktur: faktur?.mode ?? null,
            jumlah_faktur: faktur?.jumlah ?? null,
            qty_faktur: faktur?.qty ?? null,
            harga_per_unit: hargaPerUnitInput,
            estimasi_biaya: faktur ? Math.round(faktur.qty * hargaPerUnitInput) : null,
            lead_time_hari: e?.leadTimeHari ?? 0,
            untuk: [...(untukByInput.get(inputId) ?? [])].join(", ") || null,
            // penanda utk faktur: belanja bahan-mentah produksi CABANG dikirim
            // ke cabang tujuan (bukan disimpan di CK)
            produksi_di: grp.lokasi === "cabang" ? "cabang" : null,
          });
        }
      }
      bahanProduksi.sort((a, b) => b.kurang - a.kurang || b.kebutuhan - a.kebutuhan);
    }
  }

  return {
    menus,
    perkiraan_omzet: menus.reduce((a, m) => a + m.omzet, 0),
    bahan,
    bahan_produksi: bahanProduksi,
    total_estimasi_biaya:
      bahan.reduce((a, b) => a + (b.estimasi_biaya ?? 0), 0) +
      bahanProduksi.reduce((a, b) => a + (b.estimasi_biaya ?? 0), 0),
    // jumlah bahan per JALUR aksi (yang benar-benar menghasilkan baris faktur)
    jumlah_produksi: bahan.filter((b) => b.pengadaan === "produksi" && b.qty_faktur != null).length,
    jumlah_beli: bahan.filter((b) => b.pengadaan === "beli" && b.qty_faktur != null).length,
    jumlah_beli_produksi: bahanProduksi.filter((b) => b.kurang > 0).length,
    jumlah_kirim: bahan.filter((b) => b.kirim_ck > 1e-9).length,
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
  const preview = await rencanaDariMenu(
    params.companyId,
    params.branchId,
    params.items,
    params.ckBranchId,
  );
  const adaFaktur = (b: RencanaBahanRow) =>
    b.mode_faktur != null && b.jumlah_faktur != null && b.qty_faktur != null;
  const kurangRows = preview.bahan.filter(adaFaktur);
  const beliProduksiRows = preview.bahan_produksi.filter(adaFaktur);
  // KIRIM DARI STOK CK: bahan yang kekurangannya bisa ditutup dari stok jadi CK
  // (transfer, tanpa produksi baru). Dibuat sebagai faktur produksi khusus
  // (asal_branch_id = CK, status 'menunggu' siap kirim).
  const kirimRows = preview.bahan.filter((b) => b.kirim_ck > 1e-9);
  if (kurangRows.length === 0 && beliProduksiRows.length === 0 && kirimRows.length === 0) {
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
  // di CK (produksi dikirim ke store; beli disimpan di CK). Kirim-dari-stok juga
  // butuh CK sebagai asal pengiriman.
  if (prodRows.length > 0 || beliRows.length > 0 || kirimRows.length > 0) {
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
  // Pisah faktur produksi per LOKASI: bahan ber-produksi_di "cabang" lahir di
  // CABANG TUJUAN (kitchen cabang mengerjakan; hasil langsung masuk stok
  // cabang) — bukan work-order CK. Tanpa CK (produksi di tempat) semuanya
  // sudah di cabang, tak perlu dipisah.
  const prodRowsCabang = workOrder ? prodRows.filter((b) => b.produksi_di === "cabang") : [];
  const prodRowsCk = workOrder ? prodRows.filter((b) => b.produksi_di !== "cabang") : prodRows;
  // Faktur produksi cabang DIPISAH PER DIVISI (penugasan resep): kitchen dan
  // bar masing-masing dapat faktur sendiri sehingga tiap divisi hanya
  // mengerjakan resep divisinya.
  const prodRowsCabangKitchen = prodRowsCabang.filter((b) => b.divisi_produksi !== "bar");
  const prodRowsCabangBar = prodRowsCabang.filter((b) => b.divisi_produksi === "bar");

  // Pelaksana wajib HANYA untuk produksi di tempat (bukan work-order). Pada
  // work-order, karyawan CK/kitchen cabang menugaskan dirinya saat "Mulai
  // dikerjakan".
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
  // Tujuan dibedakan per BARIS: produksi & beli PRODUK JADI bertujuan cabang
  // peminta (CK memproses → dikirim → cabang menerima), sedangkan BELANJA
  // BAHAN PRODUKSI (bahan mentah resep) tetap di CK — bahan itu memang
  // dipakai CK untuk memproduksi.
  const srcBranchId = workOrder ? ck!.id : params.branchId;
  // Satu permintaan (submit) = satu rencana_id, dibagi faktur produksi & beli
  // agar tergabung sebagai satu entri di "Data Permintaan Stok".
  const rencanaId = randomUUID();
  const barisFaktur = (
    rows: RencanaBahanRow[],
    tipe: "produksi" | "beli",
    fakturId: string,
    bahanProduksi = false,
    /** true = faktur produksi DI CABANG tujuan (kitchen; hasil masuk stok cabang) */
    produksiCabang = false,
  ) =>
    rows.map((b) => ({
      companyId: params.companyId,
      // produksi_di "cabang": faktur lahir di CABANG TUJUAN (produksi lokal)
      branchId: produksiCabang ? params.branchId : srcBranchId,
      // PRODUKSI → diproduksi & DISIMPAN dulu sebagai stok CK (dikonfirmasi di
      // CK saat selesai), lalu dikirim ke cabang lewat "kirim dari stok CK"
      // (transfer) — sesuai alur "hasil produksi masuk CK dulu, CK bisa
      // ngestock". BELI produk jadi → tetap dikirim langsung ke cabang peminta.
      // Belanja bahan produksi (bahan mentah resep): tetap di CK, KECUALI utk
      // bahan jadi ber-produksi_di "cabang" — bahannya DIKIRIM ke cabang
      // (kitchen cabang yang memproduksi butuh bahan mentahnya di sana).
      tujuanBranchId:
        workOrder && tipe === "beli" && (!bahanProduksi || b.produksi_di === "cabang")
          ? params.branchId
          : null,
      // PRODUKSI work-order CK: hasil masuk stok CK dulu (tujuan kosong), tapi
      // catat "diproduksi UNTUK cabang peminta" — pengingat kirim setelah
      // selesai + badge asal permintaan. Dikosongkan saat hasil dikirim.
      // Produksi DI CABANG: lokal murni — tanpa untuk/tujuan.
      untukBranchId:
        workOrder && tipe === "produksi" && !produksiCabang ? params.branchId : null,
      bahanProduksi,
      ingredientId: b.ingredient_id,
      qty: b.qty_faktur!,
      tipe,
      totalHarga: b.estimasi_biaya ?? 0,
      fakturId,
      rencanaId,
      noFaktur: null,
      // produksi: supplier hanya sebagai pelaksana alternatif (tanpa karyawan);
      // beli: pemasok barang dari field TERPISAH — supplier pelaksana produksi
      // tidak boleh ikut tercatat sebagai pemasok pembelian
      // beli TANPA supplier saat permintaan dibuat — pemroses tercatat
      // sendiri (workerId) saat mengubah status ke "diproses"; supplier_beli
      // tetap diterima utk kompatibilitas API lama.
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

  const prodFakturId = prodRowsCk.length > 0 ? randomUUID() : null;
  // faktur produksi DI CABANG tujuan (bahan produksi_di "cabang") — terpisah
  // dari faktur CK dan TERPISAH PER DIVISI; kitchen/bar cabang mengerjakan
  // faktur divisinya (self-assign saat mulai)
  const prodCabangFakturId = prodRowsCabangKitchen.length > 0 ? randomUUID() : null;
  const prodCabangBarFakturId = prodRowsCabangBar.length > 0 ? randomUUID() : null;
  // SATU faktur belanja per permintaan: produk jadi (bertujuan cabang) DAN
  // bahan produksi (tetap di CK) digabung dalam faktur beli yang sama —
  // pemisahan tujuannya per BARIS (tujuan_branch_id + flag bahan_produksi),
  // terlihat di Dokumen Belanja: mana yang ke cabang, mana yang tetap di CK.
  const beliFakturId =
    beliRows.length > 0 || beliProduksiRows.length > 0 ? randomUUID() : null;
  // KIRIM DARI STOK CK: transfer stok jadi yang SUDAH ADA di CK → cabang (hanya
  // bila terhubung CK). Faktur produksi khusus: asal_branch_id = CK, langsung
  // 'menunggu' (siap dikirim), tanpa produksi/konsumsi bahan mentah.
  const kirimFakturId = workOrder && kirimRows.length > 0 ? randomUUID() : null;
  // Detail riwayat permintaan: produksi disimpan di CK (untuk cabang peminta).
  const detailProd = workOrder
    ? `Produksi di ${ck!.nama} → stok CK (untuk ${store.nama}) · ${ringkas}`
    : ringkas;
  const adaFakturLahir = Boolean(
    prodFakturId || prodCabangFakturId || prodCabangBarFakturId || beliFakturId || kirimFakturId,
  );
  let nomorPermintaan: string | null = null;
  await db.transaction(async (tx) => {
    // Nomor dokumen PERMINTAAN (PM-) — identitas satu submit, dipakai badge
    // di kartu faktur & Data Permintaan Stok. Hanya bila ada faktur lahir.
    if (adaFakturLahir) {
      nomorPermintaan = await terbitkanNomor(tx, params.companyId, "permintaan", rencanaId);
    }
    if (prodFakturId) {
      await tx.insert(productions).values(barisFaktur(prodRowsCk, "produksi", prodFakturId));
      await terbitkanNomor(tx, params.companyId, "produksi", prodFakturId);
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
    if (prodCabangFakturId) {
      await tx
        .insert(productions)
        .values(barisFaktur(prodRowsCabangKitchen, "produksi", prodCabangFakturId, false, true));
      await terbitkanNomor(tx, params.companyId, "produksi", prodCabangFakturId);
      await catatLogFaktur(tx, {
        companyId: params.companyId,
        branchId: params.branchId,
        fakturId: prodCabangFakturId,
        jalur: "produksi",
        aksi: "Permintaan tambah stok",
        detail: `Produksi di ${store.nama} (kitchen cabang) → stok cabang · ${ringkas}`,
        userId: params.userId,
      });
    }
    if (prodCabangBarFakturId) {
      await tx
        .insert(productions)
        .values(barisFaktur(prodRowsCabangBar, "produksi", prodCabangBarFakturId, false, true));
      await terbitkanNomor(tx, params.companyId, "produksi", prodCabangBarFakturId);
      await catatLogFaktur(tx, {
        companyId: params.companyId,
        branchId: params.branchId,
        fakturId: prodCabangBarFakturId,
        jalur: "produksi",
        aksi: "Permintaan tambah stok",
        detail: `Produksi di ${store.nama} (bar cabang) → stok cabang · ${ringkas}`,
        userId: params.userId,
      });
    }
    if (beliFakturId) {
      await tx.insert(productions).values([
        ...barisFaktur(beliRows, "beli", beliFakturId),
        ...barisFaktur(beliProduksiRows, "beli", beliFakturId, true),
      ]);
      await terbitkanNomor(tx, params.companyId, "beli", beliFakturId);
      const potongan: string[] = [];
      if (beliRows.length > 0 && workOrder) potongan.push(`Tujuan: ${store.nama}`);
      if (beliProduksiRows.length > 0) {
        potongan.push(
          `${beliProduksiRows.length} bahan produksi tetap di ${workOrder ? ck!.nama : store.nama}`,
        );
      }
      await catatLogFaktur(tx, {
        companyId: params.companyId,
        branchId: srcBranchId,
        fakturId: beliFakturId,
        jalur: "beli",
        aksi: "Permintaan tambah stok",
        detail: [...potongan, ringkas].join(" · "),
        userId: params.userId,
      });
    }
    if (kirimFakturId) {
      await tx.insert(productions).values(
        kirimRows.map((b) => ({
          companyId: params.companyId,
          branchId: ck!.id, // stok berangkat dari CK
          asalBranchId: ck!.id, // asal transfer → saldo CK berkurang saat diterima
          tujuanBranchId: params.branchId,
          bahanProduksi: false,
          ingredientId: b.ingredient_id,
          qty: b.kirim_ck,
          tipe: "produksi" as const,
          totalHarga: 0, // pemindahan stok yang sudah ada — tanpa biaya baru
          fakturId: kirimFakturId,
          rencanaId,
          noFaktur: null,
          supplierId: null,
          storageLocationId: null,
          // langsung SIAP KIRIM (stok sudah ada di CK) — lewati rencana/dikerjakan,
          // tak mengonsumsi bahan mentah (bukan produksi baru)
          status: "menunggu" as const,
          isBatch: false,
          catatan,
          userId: params.userId,
          workerId: null,
          prodDate,
        })),
      );
      await terbitkanNomor(tx, params.companyId, "produksi", kirimFakturId);
      await catatLogFaktur(tx, {
        companyId: params.companyId,
        branchId: ck!.id,
        fakturId: kirimFakturId,
        jalur: "produksi",
        aksi: "Permintaan tambah stok",
        detail: `Kirim dari stok ${ck!.nama} → ${store.nama} · ${ringkas}`,
        userId: params.userId,
      });
    }
  });

  return {
    rencana_id: rencanaId,
    nomor_permintaan: nomorPermintaan,
    produksi: prodFakturId ? { faktur_id: prodFakturId, jumlah_baris: prodRowsCk.length } : null,
    produksi_cabang: prodCabangFakturId
      ? { faktur_id: prodCabangFakturId, jumlah_baris: prodRowsCabang.length }
      : null,
    beli:
      beliRows.length > 0
        ? { faktur_id: beliFakturId!, jumlah_baris: beliRows.length }
        : null,
    // faktur SAMA dengan `beli` — bagian bahan produksi dibedakan per baris
    beli_produksi:
      beliProduksiRows.length > 0
        ? { faktur_id: beliFakturId!, jumlah_baris: beliProduksiRows.length }
        : null,
    kirim: kirimFakturId ? { faktur_id: kirimFakturId, jumlah_baris: kirimRows.length } : null,
    preview,
  };
}

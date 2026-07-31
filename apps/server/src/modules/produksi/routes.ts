import { randomUUID } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  ne,
  notExists,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  batchTeks,
  hargaPerUnit,
  jumlahFaktur,
  qtyTeks,
  type DampakBahan,
  type DampakLaporanHarga,
  type DampakMenu,
  type JenisPengadaan,
} from "@kakarut/shared";
import { acuanDariLot } from "../../lib/harga-stats";
import { wajibKelipatanKemasan } from "../../lib/kemasan";
import { db, type Db, type Tx } from "../../db/client";
import {
  branches,
  companies,
  dokumenNomor,
  fakturDana,
  fakturLogs,
  ingredientComponents,
  ingredientProduksiBranches,
  ingredientSuppliers,
  ingredients,
  memberships,
  productions,
  storageLocationIngredients,
  storageLocations,
  suppliers,
  users,
} from "../../db/schema";
import {
  bahanKurangUntukProduksi,
  catatKonsumsiProduksi,
  type BahanKurangProduksi,
  type BarisProduksiSelesai,
} from "./konsumsi";
import { AKSI_TAHAP_LOG, catatLogFaktur, rpLog } from "./log";
import { kolomBarisPindah, kolomPindahCabang } from "./pindah";
import { nomorUntukRefs, terbitkanNomor } from "../dokumen/nomor";
import {
  pastikanCabang,
  resolveBranchId,
  terikatCabang,
  verifikasiPassword,
  type AppEnv,
} from "../../middleware/auth";
import { tambahHari, tanggalDi } from "../../lib/time";
import { hitungSaldoCabang, kunciKirimCabang, qtyDalamJalan } from "../stok/service";
import {
  katalogDenganHarga,
  loadKatalog,
  menuMemakaiBahan,
  toMenuDto,
} from "../menu/service";
import { autoFileRakCabang } from "../penyimpanan/autoFile";

const pembuat = alias(users, "pembuat_prod");
const pengubah = alias(users, "pengubah_prod");
const pekerja = alias(users, "pekerja_prod");
const danaOleh = alias(users, "dana_oleh");
const logOleh = alias(users, "log_oleh");
// cabang baris + cabang tujuan (dipakai tampilan lintas-cabang di Kantor)
const cabangProd = alias(branches, "cabang_prod");
const tujuanProd = alias(branches, "tujuan_prod");
const untukProd = alias(branches, "untuk_prod");
// supplier UTAMA bahan tiap baris (info "beli di mana" saat belanja diproses)
const isupUtama = alias(ingredientSuppliers, "isup_utama");
const supBahan = alias(suppliers, "sup_bahan");
// nomor dokumen PERMINTAAN (PM-, ref = rencana_id) — join kedua atas dokumen_nomor
const dokPermintaan = alias(dokumenNomor, "dok_permintaan");

const FakturEditBody = z.object({
  password: z.string(),
  supplier_id: z.string().uuid().nullish(),
  no_faktur: z.string().trim().max(60).nullish(),
  catatan: z.string().nullish(),
  storage_location_id: z.string().uuid().nullish(),
  /** ganti pelaksana karyawan (khusus jalur produksi); null = kosongkan */
  worker_id: z.string().uuid().nullish(),
  prod_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

/** Kirim work-order produksi CK → cabang tujuan (opsional pilih tempat di cabang). */
const KirimBody = z.object({ tujuan_storage_id: z.string().uuid().nullish() });

/**
 * Kirim hasil produksi: qty per bahan BISA DIATUR — boleh lebih sedikit dari
 * hasil produksi (mis. butuh 400, 1 batch = 500 → kirim 400 saja) atau lebih
 * banyak selama stok CK cukup. Tanpa `items` → kirim persis sejumlah hasil.
 */
const KirimHasilBody = KirimBody.extend({
  items: z
    .array(z.object({ ingredient_id: z.string().uuid(), qty: z.number().positive() }))
    .min(1)
    .optional(),
});

const TahapBody = z.object({
  ke: z.enum(["dikerjakan", "menunggu", "dikonfirmasi"]),
  /**
   * Maju SEBAGIAN: hanya baris terpilih yang naik tahap; qty < qty baris →
   * baris di-split (sisa tetap di tahap lama sebagai tugas). Tanpa items =
   * perilaku lama (seluruh faktur, wajib berurutan satu langkah).
   */
  items: z
    .array(
      z.object({
        id: z.string().uuid(),
        qty: z.number().positive(),
        /**
         * Harga riil baris saat maju (harga pasar naik/turun) — menggantikan
         * estimasi RAB pada bagian yang maju; sisa split tetap prorata RAB.
         */
        harga: z.number().nonnegative().max(1_000_000_000_000).nullish(),
        /**
         * Override tanggal EXP lot saat baris MASUK STOK (beli Tiba /
         * produksi Selesai, target ≥ "menunggu"). Kosong = otomatis dari
         * masa simpan bahan (tanggal masuk + masa_simpan_hari); diabaikan
         * untuk target tahap lain.
         */
        exp: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Format exp harus YYYY-MM-DD")
          .nullish(),
      }),
    )
    .min(1)
    .optional(),
  /**
   * Dana yang benar-benar cair saat faktur meninggalkan tahap RAB — penuh
   * sesuai RAB atau sebagian. Dicatat sebagai entri faktur_dana (akumulatif).
   */
  dana_cair: z.number().nonnegative().max(1_000_000_000_000).nullish(),
  /**
   * Realisasi biaya saat proses → selesai. Dibandingkan dengan total dana
   * faktur: kurang → entri 'tambahan' (catatan: dari mana uangnya); lebih →
   * entri 'kembali' (catatan: di siapa sisa uangnya); pas → tanpa entri.
   */
  realisasi: z.number().nonnegative().max(1_000_000_000_000).nullish(),
  /** keterangan selisih realisasi: sumber dana tambahan / pemegang sisa dana */
  selisih_catatan: z.string().trim().max(300).nullish(),
  /**
   * Tujuan kirim baris yang maju (dipakai saat "dikirim"): cabang tujuan —
   * baris berpindah cabang & stoknya terhitung di sana saat dikonfirmasi —
   * dan/atau tempat penyimpanan tujuan. Sisa split tetap di tempat asal.
   */
  tujuan_branch_id: z.string().uuid().nullish(),
  tujuan_storage_id: z.string().uuid().nullish(),
  /**
   * Tetap mulai produksi meski bahan baku (resep) belum cukup — pengaman jadi
   * PERINGATAN, bukan blokir. User (owner/admin/tim) mengonfirmasi "tetap
   * proses" di UI setelah melihat daftar bahan yang kurang.
   */
  paksa: z.boolean().optional(),
});

/** Total dana efektif satu faktur: cair + tambahan − kembali. */
const DANA_EFEKTIF = sql<number>`COALESCE(SUM(CASE WHEN ${fakturDana.tipe} = 'kembali' THEN -${fakturDana.nominal} ELSE ${fakturDana.nominal} END)::float8, 0)`;

type DbAtauTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Rekonsiliasi dana saat realisasi dilaporkan: selisih terhadap total dana
 * faktur dicatat sebagai entri 'tambahan' (dana kurang — dari mana uangnya)
 * atau 'kembali' (dana lebih — di siapa sisa uangnya).
 */
async function catatRealisasiDana(
  tx: DbAtauTx,
  arg: {
    companyId: string;
    branchId: string;
    fakturId: string;
    userId: string;
    realisasi: number;
    catatan: string | null | undefined;
  },
) {
  const [d] = await tx
    .select({ total: DANA_EFEKTIF })
    .from(fakturDana)
    .where(
      and(eq(fakturDana.companyId, arg.companyId), eq(fakturDana.fakturId, arg.fakturId)),
    );
  const selisih = arg.realisasi - (d?.total ?? 0);
  if (Math.abs(selisih) < 0.005) return; // pas — sesuai rencana
  await tx.insert(fakturDana).values({
    companyId: arg.companyId,
    branchId: arg.branchId,
    fakturId: arg.fakturId,
    tipe: selisih > 0 ? "tambahan" : "kembali",
    nominal: Math.abs(Math.round(selisih * 100) / 100),
    catatan:
      arg.catatan ??
      (selisih > 0 ? "Kekurangan dana saat realisasi" : "Sisa dana realisasi"),
    userId: arg.userId,
  });
}
/** transisi tahap produksi wajib berurutan: rencana → dikerjakan → menunggu (lalu /konfirmasi) */
const TAHAP_SEBELUM = { dikerjakan: "rencana", menunggu: "dikerjakan" } as const;
/** urutan pipeline untuk aturan "hanya boleh maju" pada tahap sebagian */
const URUTAN_TAHAP = { rencana: 0, dikerjakan: 1, menunggu: 2, dikonfirmasi: 3 } as const;

/** Terima hanya tanggal format YYYY-MM-DD; selain itu undefined. */
const tglValid = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);

/** Cocokkan satu faktur: baris ber-fakturId, atau baris lama (fakturId null) via id. */
function cocokFaktur(key: string) {
  return or(
    eq(productions.fakturId, key),
    and(isNull(productions.fakturId), eq(productions.id, key)),
  );
}

const TambahStokBody = z
  .object({
    branch_id: z.string().uuid().optional(),
    ingredient_id: z.string().uuid(),
    qty: z.number().positive().optional(),
    /** true = 1 batch/1 pembelian → qty otomatis = isi bahan saat ini */
    batch: z.boolean().default(false),
    /** khusus jalur beli: total harga pembelian (catatan pengeluaran) */
    total_harga: z.number().nonnegative().nullish(),
    catatan: z.string().nullish(),
  })
  .refine((v) => v.batch || v.qty != null, {
    message: "Isi qty, atau set batch=true",
  });

const FakturBody = z.object({
  branch_id: z.string().uuid().optional(),
  /**
   * BELI (opsional, manajemen): cabang STORE tujuan kirim — barang dibeli di
   * cabang faktur (biasanya CK) lalu dikirim ke cabang ini setelah tiba
   * (alur kirim → diterima di Penerimaan cabang, sama dgn faktur permintaan).
   */
  tujuan_branch_id: z.string().uuid().nullish(),
  supplier_id: z.string().uuid().nullish(),
  no_faktur: z.string().trim().max(60).nullish(),
  catatan: z.string().nullish(),
  /**
   * karyawan pelaksana (jalur produksi) — opsional; bila kosong terisi
   * otomatis dari yang menekan Mulai Kerjakan. Diabaikan untuk beli.
   */
  worker_id: z.string().uuid().nullish(),
  items: z
    .array(
      z.object({
        ingredient_id: z.string().uuid(),
        /** jumlah dalam pcs, atau dalam batch (dikali isi bahan) */
        mode: z.enum(["pcs", "batch"]),
        jumlah: z.number().positive(),
        storage_location_id: z.string().uuid().nullish(),
        total_harga: z.number().nonnegative().nullish(),
      }),
    )
    .min(1),
});

const LABEL: Record<JenisPengadaan, { jalur: string }> = {
  produksi: { jalur: "Produksi Bahan Baku" },
  beli: { jalur: "Beli Bahan Baku" },
};

async function resolveBranchUntukTulis(
  c: Context<AppEnv>,
  bodyBranchId: string | undefined,
) {
  const auth = c.get("auth");
  const branchId = bodyBranchId
    ? await pastikanCabang(bodyBranchId, auth.company_id!)
    : await resolveBranchId(c);
  if (terikatCabang(auth.role) && branchId !== auth.branch_id) {
    throw new HTTPException(403, { message: "Kasir hanya boleh input di cabangnya" });
  }
  return branchId;
}

/** Bahan harus milik perusahaan DAN jenis pengadaannya sesuai jalur. */
function pastikanJalur(
  ing: typeof ingredients.$inferSelect | undefined,
  tipe: JenisPengadaan,
  id: string,
) {
  if (!ing) throw new HTTPException(404, { message: `Bahan tidak ditemukan (${id})` });
  if (!ing.trackStok) {
    throw new HTTPException(400, {
      message: `Stok "${ing.nama}" tidak dilacak — centang "Lacak stok" di halaman Bahan Baku dulu`,
    });
  }
  if (ing.pengadaan !== tipe) {
    throw new HTTPException(400, {
      message: `"${ing.nama}" berjenis ${ing.pengadaan === "beli" ? "beli jadi" : "produksi sendiri"} — tambah stok lewat menu ${LABEL[ing.pengadaan].jalur}`,
    });
  }
  return ing;
}

/**
 * Role KITCHEN & BAR (divisi produksi cabang store) hanya boleh memproduksi
 * bahan yang memang ditandai diproduksi DI CABANG (`produksi_di = "cabang"`,
 * diatur di Resep) DAN ber-divisi sesuai role-nya: kitchen hanya resep divisi
 * "kitchen", bar hanya divisi "bar" (`divisi_produksi`, penugasan di Resep).
 * Bahan ber-produksi_di "ck" tetap urusan Central Kitchen — kitchen/bar cabang
 * tidak boleh menduplikasinya di store. Bila bahan punya DAFTAR CABANG
 * PRODUSEN (ingredient_produksi_branches), kitchen/bar di luar daftar juga
 * ditolak; daftar kosong = semua cabang store boleh.
 */
async function pastikanBolehDiproduksiKitchen(
  role: string | null,
  branchId: string,
  ings: Iterable<typeof ingredients.$inferSelect>,
) {
  if (role !== "kitchen" && role !== "bar") return;
  const cabangIngs: (typeof ingredients.$inferSelect)[] = [];
  for (const ing of ings) {
    if (ing.pengadaan !== "produksi") continue;
    if (ing.produksiDi !== "cabang") {
      throw new HTTPException(400, {
        message: `"${ing.nama}" diproduksi di Central Kitchen — atur "Diproduksi di: Cabang" di Resep bila ingin diproduksi kitchen/bar cabang`,
      });
    }
    // Penugasan divisi: kitchen hanya resep divisi kitchen, bar hanya bar.
    if (ing.divisiProduksi !== role) {
      throw new HTTPException(400, {
        message: `"${ing.nama}" adalah resep divisi ${ing.divisiProduksi} — hanya role ${ing.divisiProduksi} yang boleh memproduksinya`,
      });
    }
    cabangIngs.push(ing);
  }
  if (cabangIngs.length === 0) return;
  const rows = await db
    .select({
      ingredientId: ingredientProduksiBranches.ingredientId,
      branchId: ingredientProduksiBranches.branchId,
    })
    .from(ingredientProduksiBranches)
    .where(
      inArray(
        ingredientProduksiBranches.ingredientId,
        cabangIngs.map((i) => i.id),
      ),
    );
  const byIng = new Map<string, Set<string>>();
  for (const r of rows) {
    const set = byIng.get(r.ingredientId) ?? new Set<string>();
    set.add(r.branchId);
    byIng.set(r.ingredientId, set);
  }
  for (const ing of cabangIngs) {
    const set = byIng.get(ing.id);
    if (set && !set.has(branchId)) {
      throw new HTTPException(400, {
        message: `"${ing.nama}" tidak diproduksi di cabang ini — tambahkan cabang ini ke daftar cabang produsen di Resep bila kitchen-nya ikut memproduksi`,
      });
    }
  }
}

/**
 * Estimasi biaya proporsional dari harga per batch bahan:
 * jalur beli = harga default pembelian; jalur produksi = RAB (perkiraan biaya).
 */
function hargaDefault(qty: number, ing: { isi: number; hargaBeli: number }) {
  return Math.round((qty / ing.isi) * ing.hargaBeli);
}

/** Angka ringkas untuk pesan (buang desimal nol berlebih). */
function fmtQty(n: number) {
  return Number(n.toFixed(2)).toLocaleString("id-ID");
}

/** Pesan blokir "bahan baku belum cukup" untuk pengaman mulai produksi. */
function pesanBahanKurang(kurang: BahanKurangProduksi[]) {
  const detail = kurang
    .map((k) => `${k.nama} (butuh ${fmtQty(k.butuh)} ${k.satuan}, tersedia ${fmtQty(k.tersedia)})`)
    .join("; ");
  return `Bahan baku belum cukup untuk mulai produksi: ${detail}. Penuhi/terima stok bahan di cabang dulu.`;
}

/** Pastikan user adalah anggota (karyawan) perusahaan — untuk penugasan produksi. */
async function pastikanKaryawan(userId: string, companyId: string) {
  const [m] = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.companyId, companyId)));
  if (!m) throw new HTTPException(400, { message: "Karyawan bukan anggota perusahaan" });
}

/** Satu baris faktur beli, secukupnya untuk menghitung harga acuan baru. */
interface BarisHarga {
  ingredientId: string;
  qty: number;
  isi: number;
  status: string;
}

/** Baris harga yang dilaporkan — dipakai endpoint laporan harga & pratinjaunya. */
const LaporanHargaItems = z
  .array(z.object({ id: z.string().uuid(), total_harga: z.number().min(0) }))
  .min(1);

/**
 * Muat baris faktur belanja + pastikan semua id yang dilaporkan memang milik
 * faktur itu. Dipakai bersama endpoint laporan harga (yang menulis) dan
 * pratinjau dampaknya (yang hanya membaca).
 */
async function bacaBarisLaporan(
  companyId: string,
  fakturId: string,
  items: { id: string; total_harga: number }[],
) {
  if (!/^[0-9a-f-]{36}$/i.test(fakturId)) {
    throw new HTTPException(404, { message: "Faktur tidak ditemukan" });
  }
  // Baris faktur + isi bahan (utk konversi harga/satuan → harga beli/kemasan)
  const barisFaktur = await db
    .select({
      id: productions.id,
      ingredientId: productions.ingredientId,
      qty: productions.qty,
      isi: ingredients.isi,
      status: productions.status,
    })
    .from(productions)
    .innerJoin(ingredients, eq(productions.ingredientId, ingredients.id))
    .where(
      and(
        eq(productions.companyId, companyId),
        eq(productions.fakturId, fakturId),
        eq(productions.tipe, "beli"),
        isNull(productions.deletedAt),
      ),
    );
  if (barisFaktur.length === 0) {
    throw new HTTPException(404, { message: "Faktur tidak ditemukan" });
  }
  const byId = new Map<string, BarisHarga>(barisFaktur.map((b) => [b.id, b]));
  for (const it of items) {
    if (!byId.has(it.id)) {
      throw new HTTPException(400, { message: "Ada baris yang bukan bagian faktur ini" });
    }
  }
  // dedupe: id sama → laporan terakhir yang berlaku
  return { byId, target: new Map(items.map((it) => [it.id, it.total_harga])) };
}

/**
 * Harga acuan BARU tiap bahan seandainya `target` (id baris → total harga)
 * dilaporkan — satu sumber kebenaran yang dipakai bersama oleh endpoint yang
 * MENULIS (laporan harga) dan endpoint yang cuma MENGINTIP (/dampak), supaya
 * angka pratinjau tak pernah beda dari angka yang akhirnya tersimpan.
 *
 * Kolam median hanya memuat lot `dikonfirmasi` yang harganya BUKAN tebakan
 * (`harga_tebakan = false`). Lot dari faktur ini dikeluarkan dari hasil query
 * lalu dimasukkan kembali dengan nilai barunya — persis kondisi setelah update
 * dijalankan.
 */
async function hitungAcuanBaru(
  dbx: Db | Tx,
  companyId: string,
  baris: Map<string, BarisHarga>,
  target: Map<string, number>,
): Promise<Map<string, { isi: number; acuan: number | null }>> {
  const perBahan = new Map<string, { isi: number; fallback: number | null }>();
  for (const [id, totalHarga] of target) {
    const b = baris.get(id)!;
    const sebelumnya = perBahan.get(b.ingredientId);
    perBahan.set(b.ingredientId, {
      isi: b.isi,
      fallback: b.qty > 0 ? totalHarga / b.qty : (sebelumnya?.fallback ?? null),
    });
  }
  const hasil = new Map<string, { isi: number; acuan: number | null }>();
  for (const [ingredientId, info] of perBahan) {
    const lotRows = await dbx
      .select({ id: productions.id, qty: productions.qty, totalHarga: productions.totalHarga })
      .from(productions)
      .where(
        and(
          eq(productions.companyId, companyId),
          eq(productions.ingredientId, ingredientId),
          eq(productions.tipe, "beli"),
          eq(productions.status, "dikonfirmasi"),
          eq(productions.hargaTebakan, false),
          isNull(productions.deletedAt),
        ),
      );
    const dilaporkan: Array<{ id: string; qty: number; totalHarga: number }> = [];
    for (const [id, totalHarga] of target) {
      const b = baris.get(id)!;
      // Lot yang belum dikonfirmasi tak masuk kolam — sama seperti lot lain.
      if (b.ingredientId !== ingredientId || b.status !== "dikonfirmasi") continue;
      dilaporkan.push({ id, qty: b.qty, totalHarga });
    }
    hasil.set(ingredientId, {
      isi: info.isi,
      acuan: acuanDariLot(lotRows, dilaporkan, info.fallback),
    });
  }
  return hasil;
}

/**
 * Dua jalur penambahan stok dengan aturan yang sama, dibedakan `tipe`:
 * - /produksi  → hanya bahan berjenis pengadaan "produksi" (dibuat sendiri)
 * - /pembelian → hanya bahan berjenis pengadaan "beli" (dibeli jadi)
 *
 * Alur utama: POST /faktur (multi-item, status "menunggu") →
 * POST /konfirmasi/:fakturId ("ya, ada" — stok baru terhitung setelah ini).
 * POST / lama (satu item, langsung dikonfirmasi) dipertahankan untuk
 * kompatibilitas.
 */
function buatRuteTambahStok(tipe: JenisPengadaan) {
  return new Hono<AppEnv>()
    .post("/faktur", zValidator("json", FakturBody), async (c) => {
      const auth = c.get("auth");
      const body = c.req.valid("json");
      const branchId = await resolveBranchUntukTulis(c, body.branch_id);

      // Muat & validasi semua referensi milik perusahaan/cabang
      const ingIds = [...new Set(body.items.map((i) => i.ingredient_id))];
      const ingRows = await db
        .select()
        .from(ingredients)
        .where(
          and(eq(ingredients.companyId, auth.company_id!), inArray(ingredients.id, ingIds)),
        );
      const ingById = new Map(ingRows.map((r) => [r.id, r]));
      // Kitchen cabang: hanya bahan ber-produksi_di "cabang" (diatur di Resep).
      await pastikanBolehDiproduksiKitchen(auth.role, branchId, ingRows);

      // Tujuan kirim (jalur beli, manajemen): barang dibeli di cabang faktur
      // lalu DIKIRIM ke store ini setelah tiba — baris bertujuan tidak
      // auto-confirm, mengikuti alur kirim → diterima di Penerimaan cabang.
      let tujuanBranchId: string | null = null;
      if (body.tujuan_branch_id && body.tujuan_branch_id !== branchId) {
        if (tipe !== "beli") {
          throw new HTTPException(400, { message: "Tujuan kirim hanya untuk faktur beli" });
        }
        if (auth.role !== "owner" && auth.role !== "admin") {
          throw new HTTPException(403, {
            message: "Hanya manajemen yang boleh membeli untuk cabang lain",
          });
        }
        const [tb] = await db
          .select({
            id: branches.id,
            tipe: branches.tipe,
            isActive: branches.isActive,
            ckId: branches.centralKitchenId,
            nama: branches.nama,
          })
          .from(branches)
          .where(
            and(eq(branches.id, body.tujuan_branch_id), eq(branches.companyId, auth.company_id!)),
          );
        if (!tb || tb.tipe !== "store" || !tb.isActive) {
          throw new HTTPException(400, { message: "Cabang tujuan harus store aktif" });
        }
        // Store terhubung SATU CK pemasok: CK lain tak boleh mengirim ke sana
        if (tb.ckId && tb.ckId !== branchId) {
          throw new HTTPException(400, {
            message: `Cabang "${tb.nama}" terhubung ke Central Kitchen lain — beli dari CK pemasoknya`,
          });
        }
        tujuanBranchId = tb.id;
      }

      if (body.supplier_id) {
        const [s] = await db
          .select({ id: suppliers.id })
          .from(suppliers)
          .where(
            and(eq(suppliers.id, body.supplier_id), eq(suppliers.companyId, auth.company_id!)),
          );
        if (!s) throw new HTTPException(400, { message: "Supplier tidak valid" });
      }
      // Jalur produksi: pelaksana OPSIONAL saat faktur dibuat — bila kosong,
      // terisi otomatis (self-assign) dari siapa yang menekan Mulai Kerjakan
      // di tahap "dikerjakan". Supplier sudah divalidasi milik perusahaan.
      let workerId: string | null = null;
      if (tipe === "produksi" && body.worker_id) {
        await pastikanKaryawan(body.worker_id, auth.company_id!);
        workerId = body.worker_id;
      }
      const lokasiIds = [
        ...new Set(body.items.map((i) => i.storage_location_id).filter(Boolean) as string[]),
      ];
      if (lokasiIds.length > 0) {
        const lokasi = await db
          .select({ id: storageLocations.id })
          .from(storageLocations)
          .where(
            and(
              eq(storageLocations.branchId, branchId),
              inArray(storageLocations.id, lokasiIds),
            ),
          );
        if (lokasi.length !== lokasiIds.length) {
          throw new HTTPException(400, {
            message: "Ada tempat penyimpanan yang tidak valid untuk cabang ini",
          });
        }
      }

      const [company] = await db
        .select({ timezone: companies.timezone })
        .from(companies)
        .where(eq(companies.id, auth.company_id!));
      const prodDate = tanggalDi(company?.timezone ?? "Asia/Jakarta");
      const fakturId = randomUUID();

      // Kedua jalur mulai dari tahap "rencana" (RAB):
      // produksi → dikerjakan → selesai (menunggu konfirmasi) → masuk stok;
      // beli → diproses → dikirim (menunggu penerimaan toko) → diterima.
      const statusAwal = "rencana" as const;
      const rows = body.items.map((item) => {
        const ing = pastikanJalur(ingById.get(item.ingredient_id), tipe, item.ingredient_id);
        const qty = item.mode === "batch" ? item.jumlah * ing.isi : item.jumlah;
        return {
          companyId: auth.company_id!,
          branchId,
          tujuanBranchId,
          ingredientId: ing.id,
          qty,
          tipe,
          // beli: harga input/estimasi; produksi: RAB otomatis dari harga bahan
          totalHarga:
            tipe === "beli"
              ? (item.total_harga ?? hargaDefault(qty, ing))
              : hargaDefault(qty, ing),
          // Tanpa harga di faktur, angkanya cuma tebakan dari harga acuan
          // sekarang — tak boleh ikut menentukan harga acuan berikutnya.
          hargaTebakan: tipe !== "beli" || item.total_harga == null,
          fakturId,
          noFaktur: body.no_faktur ?? null,
          supplierId: body.supplier_id ?? null,
          storageLocationId: item.storage_location_id ?? null,
          status: statusAwal,
          isBatch: item.mode === "batch",
          catatan: body.catatan ?? null,
          userId: auth.sub,
          workerId,
          prodDate,
        };
      });

      // ==== FAKTUR BELI OTOMATIS bahan mentah resep (jalur produksi) ====
      // Kekurangan = kebutuhan resep (BOM per 1 batch × jumlah batch) + STOK
      // MINIMUM − saldo cabang. Bahan yang cukup untuk produksi tapi sisa
      // stoknya bakal jatuh di bawah stok minimum IKUT dibeli. Hanya bahan
      // jalur BELI yang dilacak stoknya; dibulatkan per kemasan + MOQ
      // (min_beli), sama dengan planner rencana menu.
      const beliRows: typeof rows = [];
      const beliFakturId = randomUUID();
      if (tipe === "produksi") {
        const batchByProd = new Map<string, number>();
        for (const r of rows) {
          const ing = ingById.get(r.ingredientId)!;
          const batch = ing.isi > 0 ? r.qty / ing.isi : r.qty;
          batchByProd.set(r.ingredientId, (batchByProd.get(r.ingredientId) ?? 0) + batch);
        }
        const komponen = await db
          .select({
            produkId: ingredientComponents.ingredientId,
            inputId: ingredientComponents.inputIngredientId,
            qty: ingredientComponents.qty,
          })
          .from(ingredientComponents)
          .where(inArray(ingredientComponents.ingredientId, [...batchByProd.keys()]));
        const butuhByInput = new Map<string, number>();
        for (const k of komponen) {
          const batch = batchByProd.get(k.produkId) ?? 0;
          if (batch > 0) {
            butuhByInput.set(k.inputId, (butuhByInput.get(k.inputId) ?? 0) + k.qty * batch);
          }
        }
        if (butuhByInput.size > 0) {
          const inputRows = await db
            .select()
            .from(ingredients)
            .where(
              and(
                eq(ingredients.companyId, auth.company_id!),
                inArray(ingredients.id, [...butuhByInput.keys()]),
              ),
            );
          const stokByIng = new Map(
            (await hitungSaldoCabang(auth.company_id!, branchId)).map((s) => [
              s.ingredient_id,
              s,
            ]),
          );
          for (const inp of inputRows) {
            // hanya bahan BELI ber-stok — komponen produksi (resep bertingkat)
            // tidak bisa dibeli, bahan tanpa lacak stok tak punya saldo
            if (inp.pengadaan !== "beli" || !inp.trackStok || !inp.isActive) continue;
            const s = stokByIng.get(inp.id);
            const saldo = s?.saldo ?? 0;
            const stokMin = s?.stok_minimum ?? inp.stokMinimum ?? 0;
            const kurang = (butuhByInput.get(inp.id) ?? 0) + stokMin - saldo;
            if (kurang <= 1e-9) continue;
            const f = jumlahFaktur(Math.max(kurang, inp.minBeli ?? 0), "beli", inp.isi, inp.bolehEceran);
            beliRows.push({
              companyId: auth.company_id!,
              branchId,
              tujuanBranchId: null,
              ingredientId: inp.id,
              qty: f.qty,
              tipe: "beli",
              totalHarga: hargaDefault(f.qty, inp),
              hargaTebakan: true, // belanja otomatis: harga belum pernah dilihat
              fakturId: beliFakturId,
              noFaktur: null,
              supplierId: null,
              storageLocationId: null,
              status: statusAwal,
              isBatch: f.mode === "batch",
              catatan: "Belanja bahan otomatis untuk produksi",
              userId: auth.sub,
              workerId: null,
              prodDate,
            });
          }
        }
      }

      const { inserted, nomor, beliNomor } = await db.transaction(async (tx) => {
        const hasil = await tx.insert(productions).values(rows).returning();
        const nomorTeks = await terbitkanNomor(tx, auth.company_id!, tipe, fakturId);
        await catatLogFaktur(tx, {
          companyId: auth.company_id!,
          branchId,
          fakturId,
          jalur: tipe,
          aksi: "Faktur dibuat (RAB)",
          detail: `${nomorTeks} · ${hasil.length} baris`,
          userId: auth.sub,
        });
        // faktur beli otomatis lahir dalam transaksi yang sama (atomik)
        let nomorBeli: string | null = null;
        if (beliRows.length > 0) {
          await tx.insert(productions).values(beliRows);
          nomorBeli = await terbitkanNomor(tx, auth.company_id!, "beli", beliFakturId);
          await catatLogFaktur(tx, {
            companyId: auth.company_id!,
            branchId,
            fakturId: beliFakturId,
            jalur: "beli",
            aksi: "Faktur dibuat (RAB)",
            detail: `${nomorBeli} · ${beliRows.length} baris · otomatis dari produksi ${nomorTeks}`,
            userId: auth.sub,
          });
          await catatLogFaktur(tx, {
            companyId: auth.company_id!,
            branchId,
            fakturId,
            jalur: tipe,
            aksi: "Faktur beli bahan otomatis",
            detail: `${nomorBeli} · ${beliRows.length} bahan kurang/di bawah stok minimum`,
            userId: auth.sub,
          });
        }
        return { inserted: hasil, nomor: nomorTeks, beliNomor: nomorBeli };
      });
      return c.json(
        {
          faktur_id: fakturId,
          nomor,
          status: statusAwal,
          jumlah_baris: inserted.length,
          // faktur beli otomatis utk bahan mentah kurang / di bawah minimum
          beli_otomatis:
            beliNomor != null
              ? { faktur_id: beliFakturId, nomor: beliNomor, jumlah_baris: beliRows.length }
              : null,
        },
        201,
      );
    })
    /**
     * Ubah tahap (kedua jalur):
     * produksi: rencana → dikerjakan → menunggu (selesai) → dikonfirmasi;
     * beli: rencana (RAB) → dikerjakan (diproses) → menunggu (dikirim) → diterima.
     *
     * Tanpa `items`: seluruh faktur naik SATU langkah (wajib berurutan) —
     * perilaku lama. Dengan `items`: hanya baris terpilih yang maju (boleh
     * lompat tahap ke depan, tak pernah mundur); qty < qty baris → baris
     * di-SPLIT: bagian yang maju jadi baris baru, sisanya tetap di tahap
     * lama sebagai tugas yang masih harus dikerjakan.
     */
    .post("/tahap/:fakturId", zValidator("json", TahapBody), async (c) => {
      const auth = c.get("auth");
      const { ke, items, dana_cair, realisasi, selisih_catatan, tujuan_branch_id, tujuan_storage_id, paksa } =
        c.req.valid("json");

      const conds = [
        eq(productions.companyId, auth.company_id!),
        eq(productions.fakturId, c.req.param("fakturId")),
        eq(productions.tipe, tipe),
        isNull(productions.deletedAt),
      ];
      if (terikatCabang(auth.role) && auth.branch_id) {
        conds.push(eq(productions.branchId, auth.branch_id));
      }

      // ===== Maju sebagian (dropdown + penyesuaian per baris) =====
      if (items) {
        const target = URUTAN_TAHAP[ke];
        // Siapa yang MULAI mengerjakan/memproses menugaskan dirinya (isi
        // worker_id yang masih kosong) — berlaku kedua jalur: produksi
        // (pelaksana work-order CK) maupun beli (pemroses belanja tercatat).
        const selfAssign = ke === "dikerjakan";
        const baris = await db
          .select()
          .from(productions)
          .where(and(...conds));
        if (baris.length === 0) {
          throw new HTTPException(404, { message: "Faktur tidak ditemukan" });
        }
        const byId = new Map(baris.map((b) => [b.id, b]));

        // BELI mulai DIPROSES: transaksi tercatat ke supplier UTAMA bahan
        // (baris tanpa supplier diisi otomatis) — dasar kartu supplier.
        const utamaByIng = new Map<string, string>();
        if (tipe === "beli" && selfAssign) {
          const utamaRows = await db
            .select({
              ingredientId: ingredientSuppliers.ingredientId,
              supplierId: ingredientSuppliers.supplierId,
            })
            .from(ingredientSuppliers)
            .where(
              and(
                eq(ingredientSuppliers.companyId, auth.company_id!),
                eq(ingredientSuppliers.isUtama, true),
                inArray(ingredientSuppliers.ingredientId, [
                  ...new Set(baris.map((b) => b.ingredientId)),
                ]),
              ),
            );
          for (const r of utamaRows) utamaByIng.set(r.ingredientId, r.supplierId);
        }
        const supplierBaris = (b: (typeof baris)[number]) =>
          b.supplierId ?? (b.tipe === "beli" ? (utamaByIng.get(b.ingredientId) ?? null) : null);

        // Validasi seluruh permintaan dulu — semua-atau-tidak-sama-sekali.
        const terpakai = new Set<string>();
        for (const item of items) {
          if (terpakai.has(item.id)) {
            throw new HTTPException(400, { message: "Baris yang sama dikirim dua kali" });
          }
          terpakai.add(item.id);
          const b = byId.get(item.id);
          if (!b) {
            throw new HTTPException(400, { message: "Ada baris yang bukan milik faktur ini" });
          }
          if (b.status === "ditolak" || URUTAN_TAHAP[b.status] >= target) {
            throw new HTTPException(400, {
              message: `Baris berstatus "${b.status}" tidak bisa dipindah ke "${ke}" — tahap hanya bisa maju`,
            });
          }
          // Barang bertujuan cabang lain diterima di cabang tujuan (lewat
          // Penerimaan), bukan dikonfirmasi di sini — cegah stok mendarat di
          // cabang yang salah.
          if (ke === "dikonfirmasi" && b.tujuanBranchId) {
            throw new HTTPException(400, {
              message:
                "Barang bertujuan cabang lain — kirim dulu lalu terima di Penerimaan cabang tujuan",
            });
          }
          // Qty maju SENGAJA boleh melebihi qty baris: RAB itu RENCANA, bukan
          // pagu. Sayur direncanakan 900 gr tapi hanya dijual per kilo → yang
          // benar-benar dibeli 1.000 gr, dan angka itulah yang harus tercatat.
          // Hal yang sama berlaku pada produksi (hasil sering lebih/kurang dari
          // target). Yang dibatasi hanya qty ≤ 0, dijaga skema Zod.
        }

        // PENGAMAN BAHAN BAKU (produksi): sebelum baris rencana MULAI dikerjakan
        // (target ≥ dikerjakan), pastikan bahan mentah resepnya cukup di cabang
        // pelaksana — jangan mulai produksi bila bahannya belum ada/diterima.
        if (tipe === "produksi" && target >= URUTAN_TAHAP.dikerjakan) {
          const cekRows = items
            .map((it) => ({ b: byId.get(it.id)!, qty: it.qty }))
            .filter(
              ({ b }) =>
                URUTAN_TAHAP[b.status as keyof typeof URUTAN_TAHAP] < URUTAN_TAHAP.dikerjakan,
            )
            .map(({ b, qty }) => ({
              id: b.id,
              branchId: b.branchId,
              ingredientId: b.ingredientId,
              qty,
            }));
          const kurang = await bahanKurangUntukProduksi(auth.company_id!, cekRows);
          // Peringatan (bukan blokir): bila bahan kurang & user belum menekan
          // "tetap proses" (paksa), balikan 409 dgn daftar bahan kurang — UI
          // menampilkannya lalu memberi opsi lanjut. paksa=true → lewati.
          if (kurang.length > 0 && !paksa) {
            throw new HTTPException(409, { message: pesanBahanKurang(kurang) });
          }
        }

        // Tujuan kirim (opsional): baris yang maju pindah cabang dan/atau
        // tempat penyimpanan — stok terhitung di cabang tujuan saat konfirmasi.
        let tujuanBranch: string | null = null;
        let tujuanNama: string | null = null;
        if (tujuan_branch_id) {
          const [cb] = await db
            .select({
              id: branches.id,
              nama: branches.nama,
              tipe: branches.tipe,
              centralKitchenId: branches.centralKitchenId,
            })
            .from(branches)
            .where(
              and(eq(branches.id, tujuan_branch_id), eq(branches.companyId, auth.company_id!)),
            );
          if (!cb) throw new HTTPException(400, { message: "Cabang tujuan tidak valid" });
          if (cb.tipe === "kantor") {
            throw new HTTPException(400, {
              message: "Kantor bukan tujuan kirim barang — pilih cabang store",
            });
          }
          // Store terhubung ke SATU CK pemasok: CK lain tidak boleh mengirim
          // ke store itu. Baris yang maju bisa lintas cabang → cek per pengirim.
          if (cb.tipe === "store" && cb.centralKitchenId) {
            const pengirimIds = [
              ...new Set(items.map((it) => byId.get(it.id)!.branchId)),
            ].filter((idCabang) => idCabang !== cb.id);
            if (pengirimIds.length > 0) {
              const pengirim = await db
                .select({ id: branches.id, tipe: branches.tipe })
                .from(branches)
                .where(inArray(branches.id, pengirimIds));
              const ckLain = pengirim.find(
                (p) => p.tipe === "central_kitchen" && p.id !== cb.centralKitchenId,
              );
              if (ckLain) {
                throw new HTTPException(400, {
                  message: `Cabang "${cb.nama}" terhubung ke Central Kitchen lain — kirim hanya dari CK pemasoknya`,
                });
              }
            }
          }
          tujuanBranch = cb.id;
          tujuanNama = cb.nama;
          // Khusus kasir, kitchen & bar: tak boleh lintas cabang. Karyawan CK
          // (tim) justru tugasnya MENGIRIM ke store — validasi CK↔store di
          // atas. Kitchen/bar memproduksi LOKAL untuk cabangnya sendiri.
          if (
            (auth.role === "cashier" || auth.role === "kitchen" || auth.role === "bar") &&
            auth.branch_id &&
            tujuanBranch !== auth.branch_id
          ) {
            throw new HTTPException(403, {
              message: "Kasir/Kitchen/Bar tidak boleh mengirim ke cabang lain",
            });
          }
        }
        let tujuanStorage: string | null = null;
        if (tujuan_storage_id) {
          const [lok] = await db
            .select({ id: storageLocations.id })
            .from(storageLocations)
            .where(
              and(
                eq(storageLocations.id, tujuan_storage_id),
                eq(storageLocations.companyId, auth.company_id!),
                eq(storageLocations.branchId, tujuanBranch ?? baris[0].branchId),
              ),
            );
          if (!lok) {
            throw new HTTPException(400, {
              message: "Tempat penyimpanan tidak valid untuk cabang tujuan",
            });
          }
          tujuanStorage = tujuan_storage_id;
        }
        // Pindah cabang hanya berlaku saat barang benar-benar dikirim
        // (>= menunggu). Pindah dini (mis. ke 'dikerjakan') membuat konsumsi
        // bahan resep tercatat di cabang yang salah — abaikan tujuannya.
        const bolehPindah = target >= URUTAN_TAHAP.menunggu;
        /**
         * Lewat `kolomPindahCabang`, JANGAN dirakit di sini.
         *
         * Dulu blok ini hanya mengisi `branchId` + `dariBranchId` dan LUPA
         * `tujuanBranchId`. Akibatnya barang berpindah ke cabang tapi
         * alamatnya tertinggal (kosong untuk produksi, cabang lain untuk
         * beli), sehingga gerbang Penerimaan tak pernah mengenalinya:
         * faktur berbunyi "Dikirim" tapi tak ada layar mana pun yang bisa
         * menerimanya, dan stok cabang tak pernah bertambah.
         */
        const pindah = bolehPindah && tujuanBranch ? kolomPindahCabang(tujuanBranch) : {};

        // RAK DEFAULT per bahan PER CABANG: saat barang TIBA/DISIMPAN
        // (>= menunggu) di cabang tujuan, otomatis diletakkan di rak yang
        // ditugaskan untuk bahan itu DI CABANG TUJUAN (diatur di Tempat
        // Penyimpanan). Belanja pilih rak manual (tujuan_storage) jadi cadangan;
        // tanpa keduanya → tanpa tempat (null). Penyimpanan terkelompok per rak
        // otomatis, konsisten dgn penerimaan kiriman di cabang store.
        const rakDefault = new Map<string, string>(); // `${ingredientId}|${branchId}` → rakId
        {
          const ingIds = [...new Set(baris.map((b) => b.ingredientId))];
          const asg = await db
            .select({
              ingredientId: storageLocationIngredients.ingredientId,
              rakId: storageLocationIngredients.storageLocationId,
              rakBranch: storageLocations.branchId,
            })
            .from(storageLocationIngredients)
            .innerJoin(
              storageLocations,
              eq(storageLocations.id, storageLocationIngredients.storageLocationId),
            )
            .where(
              and(
                eq(storageLocationIngredients.companyId, auth.company_id!),
                inArray(storageLocationIngredients.ingredientId, ingIds),
              ),
            );
          for (const r of asg) rakDefault.set(`${r.ingredientId}|${r.rakBranch}`, r.rakId);
        }
        /** rak simpan untuk baris yang maju (>= menunggu): rak manual (bila
         * dipilih) menang, lalu rak default bahan DI CABANG SENDIRI (barang
         * tiba/disimpan lokal, mis. CK-local). Kiriman LINTAS-CABANG tidak
         * di-auto-file di sini — rak default cabang tujuan diterapkan saat
         * DITERIMA di cabang (autoFileRakCabang), bukan saat dikirim; sampai
         * itu tetap tanpa tempat (barang masih transit). */
        const rakBaris = (b: (typeof baris)[number]) => {
          if (tujuanStorage) return tujuanStorage;
          if (tujuanBranch && tujuanBranch !== b.branchId) return b.storageLocationId;
          return rakDefault.get(`${b.ingredientId}|${b.branchId}`) ?? b.storageLocationId;
        };

        // EXP LOT: saat baris MASUK STOK (>= menunggu: beli Tiba / produksi
        // Selesai), exp otomatis = tanggal masuk + masa simpan bahan (master),
        // bisa di-override per baris (items[].exp). Baris yang sudah ber-exp
        // dipertahankan (mis. menunggu → dikonfirmasi tidak menggeser exp).
        const masukStok = target >= URUTAN_TAHAP.menunggu;
        const masaSimpanByIng = new Map<string, number>();
        let hariMasuk = "";
        if (masukStok) {
          const [comp] = await db
            .select({ timezone: companies.timezone })
            .from(companies)
            .where(eq(companies.id, auth.company_id!));
          hariMasuk = tanggalDi(comp?.timezone ?? "Asia/Jakarta");
          const msRows = await db
            .select({ id: ingredients.id, masaSimpan: ingredients.masaSimpanHari })
            .from(ingredients)
            .where(
              and(
                eq(ingredients.companyId, auth.company_id!),
                inArray(ingredients.id, [...new Set(baris.map((b) => b.ingredientId))]),
              ),
            );
          for (const r of msRows) masaSimpanByIng.set(r.id, r.masaSimpan);
        }
        const expBaris = (b: (typeof baris)[number], override?: string | null) => {
          if (!masukStok) return b.expDate;
          if (override) return override;
          if (b.expDate) return b.expDate;
          const ms = masaSimpanByIng.get(b.ingredientId) ?? 0;
          return ms > 0 ? tambahHari(hariMasuk, ms) : null;
        };

        const now = new Date();
        // Baris yang TIBA/SELESAI di cabang sendiri (tujuan kosong & tak dikirim
        // ke cabang lain) LANGSUNG dikonfirmasi begitu mencapai "menunggu" → stok
        // masuk di CK tanpa perlu penerimaan/konfirmasi terpisah (orang CK yang
        // beli & produksi, jadi tak perlu konfirmasi lagi). Baris bertujuan cabang
        // tetap "menunggu" → dikirim lalu diterima lewat Penerimaan cabang.
        // "waktu" di-set saat konfirmasi (bukan saat RAB) agar stok masuk relatif
        // ke opname terakhir.
        const langsungMasuk = (b: (typeof baris)[number]) =>
          ke === "menunggu" &&
          // CK-lokal = tujuan kosong ATAU = cabang sendiri (invariant sama dengan
          // saldo & penerimaan) — keduanya "tetap di cabang sendiri", tak dikirim.
          (b.tujuanBranchId == null || b.tujuanBranchId === b.branchId) &&
          (tujuanBranch == null || tujuanBranch === b.branchId);
        const naikBaris = (b: (typeof baris)[number]) =>
          ke === "dikonfirmasi" || langsungMasuk(b)
            ? ({ status: "dikonfirmasi", confirmedBy: auth.sub, confirmedAt: now, waktu: now } as const)
            : ({ status: ke, updatedBy: auth.sub, updatedAt: now } as const);

        await db.transaction(async (tx) => {
          if (dana_cair != null) {
            await tx.insert(fakturDana).values({
              companyId: auth.company_id!,
              branchId: baris[0].branchId,
              fakturId: c.req.param("fakturId"),
              nominal: dana_cair,
              userId: auth.sub,
            });
          }
          // Baris PRODUKSI yang baru SELESAI dikerjakan pada transisi ini
          // (melewati 'menunggu') → bahan mentah resep dikonsumsi dari stok
          // cabang PELAKSANA (branch snapshot, sebelum pindah/kirim). Pada
          // split, id = baris BARU yang maju (baris sisa mengonsumsi sendiri
          // saat gilirannya maju nanti).
          const selesaiProduksi: BarisProduksiSelesai[] = [];
          const selesaiTahapIni = (b: (typeof baris)[number]) =>
            b.tipe === "produksi" &&
            URUTAN_TAHAP[b.status as keyof typeof URUTAN_TAHAP] < URUTAN_TAHAP.menunggu &&
            target >= URUTAN_TAHAP.menunggu;
          for (const item of items) {
            const b = byId.get(item.id)!;
            // BELI bertujuan cabang: "menunggu" = barang TIBA DI CK (semua
            // belanjaan kumpul di CK dulu) — pengiriman ke cabang lewat
            // tombol Kirim (POST /kirim) TERPISAH, dengan dokumen kirim.
            // WHERE menuntut status DAN qty persis seperti saat dibaca: bila
            // berubah oleh proses lain, update 0 baris → transaksi batal.
            // qty ikut dikunci karena split TIDAK mengubah status baris asli —
            // tanpa ini dua request paralel sama-sama lolos (qty menggelembung
            // + konsumsi bahan dobel).
            const kunci = and(
              eq(productions.id, b.id),
              eq(productions.status, b.status),
              eq(productions.qty, b.qty),
              isNull(productions.deletedAt),
            );
            // Qty realisasi ≥ rencana → SELURUH baris maju, tak ada sisa tugas.
            // Bila lebih (beli 1.000 gr padahal RAB 900), qty baris diperbarui
            // ke angka yang benar-benar terjadi.
            if (item.qty >= b.qty - 1e-9) {
              const lebih = item.qty > b.qty + 1e-9;
              // Tanpa harga riil, harga RAB diskalakan mengikuti qty baru supaya
              // harga per satuan tetap masuk akal. Angka hasil skala itu TAK
              // PERNAH DILIHAT MANUSIA — walau harga awalnya diketik orang —
              // jadi ia ditandai `harga_tebakan` agar tak ikut jadi bahan median
              // harga acuan (invarian yang sama dengan perbaikan lingkaran umpan
              // balik harga).
              const hargaSkala =
                lebih && b.totalHarga != null
                  ? Math.round((b.totalHarga * item.qty) / b.qty)
                  : null;
              const res = await tx
                .update(productions)
                .set({
                  ...naikBaris(b),
                  ...pindah,
                  ...(lebih ? { qty: item.qty } : {}),
                  ...(hargaSkala != null && item.harga == null
                    ? { totalHarga: hargaSkala, hargaTebakan: true }
                    : {}),
                  // rak simpan otomatis (home rak per bahan) saat barang tiba/disimpan
                  ...(bolehPindah ? { storageLocationId: rakBaris(b) } : {}),
                  // self-assign pelaksana (isi hanya bila masih kosong)
                  ...(selfAssign
                    ? { workerId: sql`COALESCE(${productions.workerId}, ${auth.sub}::uuid)` }
                    : {}),
                  // beli diproses: catat transaksi ke supplier utama bahan
                  ...(selfAssign && b.supplierId == null && supplierBaris(b) != null
                    ? { supplierId: supplierBaris(b) }
                    : {}),
                  // harga riil menggantikan estimasi RAB (harga pasar berubah)
                  // — angka yang dilihat manusia, jadi bukan tebakan lagi
                  ...(item.harga != null ? { totalHarga: item.harga, hargaTebakan: false } : {}),
                  // exp lot saat masuk stok (otomatis dari masa simpan / override)
                  ...(masukStok ? { expDate: expBaris(b, item.exp) } : {}),
                })
                .where(kunci)
                .returning({ id: productions.id });
              if (res.length === 0) {
                throw new HTTPException(409, {
                  message: "Status faktur berubah — muat ulang halaman lalu coba lagi",
                });
              }
              if (selesaiTahapIni(b)) {
                selesaiProduksi.push({
                  id: b.id,
                  branchId: b.branchId,
                  ingredientId: b.ingredientId,
                  qty: item.qty,
                });
              }
            } else {
              // Split: bagian yang maju jadi baris BARU; baris asli menyimpan
              // sisa qty di tahap lama dengan prorata RAB-nya. Bagian yang maju
              // memakai harga RIIL bila dikirim (harga pasar berubah), selain
              // itu prorata — sehingga tanpa harga riil jumlah keduanya tetap
              // = harga awal (tidak ada rupiah yang hilang/berlipat).
              const hargaMaju =
                b.totalHarga != null ? Math.round((b.totalHarga * item.qty) / b.qty) : null;
              const hargaBaris = item.harga ?? hargaMaju;
              const res = await tx
                .update(productions)
                .set({
                  qty: b.qty - item.qty,
                  ...(b.totalHarga != null
                    ? { totalHarga: b.totalHarga - (hargaMaju ?? 0) }
                    : {}),
                  updatedBy: auth.sub,
                  updatedAt: now,
                })
                .where(kunci)
                .returning({ id: productions.id });
              if (res.length === 0) {
                throw new HTTPException(409, {
                  message: "Status faktur berubah — muat ulang halaman lalu coba lagi",
                });
              }
              const [barisMaju] = await tx
                .insert(productions)
                .values({
                companyId: b.companyId,
                ingredientId: b.ingredientId,
                qty: item.qty,
                tipe: b.tipe,
                totalHarga: hargaBaris,
                // harga riil → bukan tebakan; prorata mewarisi sifat induknya
                hargaTebakan: item.harga != null ? false : b.hargaTebakan,
                fakturId: b.fakturId,
                // pertahankan penanda permintaan agar baris hasil tahap (split)
                // tetap tergabung di "Data Permintaan Stok"
                rencanaId: b.rencanaId,
                noFaktur: b.noFaktur,
                supplierId: selfAssign ? supplierBaris(b) : b.supplierId,
                // rak simpan otomatis (home rak) saat maju ke tiba/disimpan; selain itu tetap
                storageLocationId: bolehPindah ? rakBaris(b) : b.storageLocationId,
                isBatch: b.isBatch,
                catatan: b.catatan,
                userId: b.userId,
                /**
                 * Baris hasil "maju sebagian" adalah baris BARU, jadi seluruh
                 * penanda induknya harus ikut disalin. Empat di antaranya dulu
                 * tertinggal, masing-masing dengan akibatnya sendiri:
                 *
                 * - `untukBranchId` → tombol "Kirim hasil ke cabang" hilang,
                 *   sisa barang jadi mengendap selamanya di CK;
                 * - `asalBranchId`  → baris pecahan sebuah transfer BERHENTI
                 *   mengurangi saldo CK (kebocoran saldo yang senyap);
                 * - `bahanProduksi` → belanja bahan mentah tercampur dengan
                 *   belanja produk jadi;
                 * - `dariBranchId`  → pendeteksi kiriman menggantung jadi buta.
                 */
                untukBranchId: b.untukBranchId,
                asalBranchId: b.asalBranchId,
                bahanProduksi: b.bahanProduksi,
                // Pindah cabang: alamat WAJIB ikut lokasi (lihat pindah.ts).
                // Tanpa tujuan/tak boleh pindah → tetap di cabangnya sendiri.
                ...(bolehPindah && tujuanBranch
                  ? kolomBarisPindah(tujuanBranch, b.branchId)
                  : { branchId: b.branchId, tujuanBranchId: b.tujuanBranchId, dariBranchId: b.dariBranchId }),
                workerId: b.workerId ?? (selfAssign ? auth.sub : null),
                prodDate: b.prodDate,
                // exp lot bagian yang maju; sisa split tetap exp lama (belum masuk)
                expDate: expBaris(b, item.exp),
                ...naikBaris(b),
              })
                .returning({ id: productions.id });
              if (selesaiTahapIni(b)) {
                selesaiProduksi.push({
                  id: barisMaju.id,
                  branchId: b.branchId,
                  ingredientId: b.ingredientId,
                  qty: item.qty,
                });
              }
            }
          }
          await catatKonsumsiProduksi(tx, auth.company_id!, selesaiProduksi);
          if (realisasi != null) {
            await catatRealisasiDana(tx, {
              companyId: auth.company_id!,
              branchId: baris[0].branchId,
              fakturId: c.req.param("fakturId"),
              userId: auth.sub,
              realisasi,
              catatan: selisih_catatan,
            });
          }
          // jejak kegiatan: siapa mengubah tahap ini + uang/tujuan yang menyertai
          const potongan = [`${items.length} baris`];
          if (selfAssign) potongan.push(`oleh ${auth.nama}`);
          if (dana_cair != null) potongan.push(`dana cair ${rpLog(dana_cair)}`);
          if (realisasi != null) potongan.push(`realisasi ${rpLog(realisasi)}`);
          if (tujuanNama) potongan.push(`tujuan: ${tujuanNama}`);
          await catatLogFaktur(tx, {
            companyId: auth.company_id!,
            branchId: baris[0].branchId,
            fakturId: c.req.param("fakturId"),
            jalur: tipe,
            aksi: AKSI_TAHAP_LOG[tipe][ke],
            detail: potongan.join(" · "),
            userId: auth.sub,
          });
        });
        return c.json({ ok: true, status: ke, jumlah_baris: items.length });
      }

      // ===== Perilaku lama: seluruh faktur, wajib berurutan satu langkah =====
      if (ke === "dikonfirmasi") {
        throw new HTTPException(400, {
          message: 'Sertakan "items" (baris terpilih) atau pakai endpoint /konfirmasi',
        });
      }
      const dari = TAHAP_SEBELUM[ke];

      // PENGAMAN BAHAN BAKU (produksi): seluruh faktur MULAI dikerjakan →
      // pastikan bahan mentah resep tiap baris rencana cukup di cabang
      // pelaksana sebelum produksi dimulai.
      if (tipe === "produksi" && ke === "dikerjakan") {
        const barisRencana = await db
          .select({
            id: productions.id,
            branchId: productions.branchId,
            ingredientId: productions.ingredientId,
            qty: productions.qty,
          })
          .from(productions)
          .where(and(...conds, eq(productions.status, dari)));
        const kurang = await bahanKurangUntukProduksi(auth.company_id!, barisRencana);
        // Peringatan (bukan blokir) — lihat jalur items di atas. paksa=true lewati.
        if (kurang.length > 0 && !paksa) {
          throw new HTTPException(409, { message: pesanBahanKurang(kurang) });
        }
      }

      // EXP LOT (jalur non-items): saat seluruh faktur TIBA/SELESAI
      // (ke="menunggu"), isi exp otomatis = hari ini + masa simpan bahan bila
      // belum ada. Auto-confirm dua-langkah di bawah tidak menyentuh expDate.
      const [compTz] = await db
        .select({ timezone: companies.timezone })
        .from(companies)
        .where(eq(companies.id, auth.company_id!));
      const hariMasukPenuh = tanggalDi(compTz?.timezone ?? "Asia/Jakarta");

      const rows = await db.transaction(async (tx) => {
        const diperbarui = await tx
          .update(productions)
          .set({
            status: ke,
            updatedBy: auth.sub,
            updatedAt: new Date(),
            // yang MULAI mengerjakan/memproses menugaskan dirinya — produksi
            // (pelaksana) maupun beli (pemroses belanja tercatat)
            ...(ke === "dikerjakan"
              ? { workerId: sql`COALESCE(${productions.workerId}, ${auth.sub}::uuid)` }
              : {}),
            // beli mulai DIPROSES: transaksi tercatat ke supplier UTAMA bahan
            // (hanya baris yang belum menyebut supplier) — dasar kartu supplier
            ...(tipe === "beli" && ke === "dikerjakan"
              ? {
                  supplierId: sql`COALESCE(${productions.supplierId}, (SELECT isup.supplier_id FROM ingredient_suppliers isup WHERE isup.ingredient_id = ${productions.ingredientId} AND isup.is_utama LIMIT 1))`,
                }
              : {}),
            // masuk stok: exp otomatis dari masa simpan bahan (PG: date + int)
            ...(ke === "menunggu"
              ? {
                  expDate: sql`COALESCE(${productions.expDate}, (SELECT CASE WHEN i.masa_simpan_hari > 0 THEN ${hariMasukPenuh}::date + i.masa_simpan_hari END FROM ingredients i WHERE i.id = ${productions.ingredientId}))`,
                }
              : {}),
            // masuk stok: rak simpan otomatis dari rak default bahan di cabang
            // baris (Tempat Penyimpanan) — paritas dgn jalur items (rakBaris).
            // Baris bertujuan cabang LAIN tetap tanpa rak (transit; di-auto-file
            // saat diterima di cabang), rak yang sudah dipilih dipertahankan.
            ...(ke === "menunggu"
              ? {
                  storageLocationId: sql`COALESCE(${productions.storageLocationId}, CASE WHEN (${productions.tujuanBranchId} IS NULL OR ${productions.tujuanBranchId} = ${productions.branchId}) THEN (SELECT sli.storage_location_id FROM storage_location_ingredients sli JOIN storage_locations sl ON sl.id = sli.storage_location_id WHERE sli.ingredient_id = ${productions.ingredientId} AND sli.company_id = ${auth.company_id!} AND sl.branch_id = ${productions.branchId} LIMIT 1) END)`,
                }
              : {}),
            // BELI bertujuan cabang: "menunggu" = barang TIBA DI CK — baris
            // TETAP di CK; pengiriman ke cabang lewat POST /kirim terpisah
            // (dengan dokumen kirim), baru muncul di Penerimaan cabang.
          })
          .where(and(...conds, eq(productions.status, dari)))
          .returning({
            id: productions.id,
            branchId: productions.branchId,
            ingredientId: productions.ingredientId,
            qty: productions.qty,
            tujuanBranchId: productions.tujuanBranchId,
          });
        // dikerjakan → menunggu = produksi SELESAI → konsumsi bahan mentah resep
        if (tipe === "produksi" && ke === "menunggu") {
          await catatKonsumsiProduksi(tx, auth.company_id!, diperbarui);
        }
        // CK-lokal (tujuan kosong ATAU = cabang sendiri) yang baru "menunggu" →
        // LANGSUNG dikonfirmasi (stok masuk di CK), tanpa penerimaan/konfirmasi
        // terpisah. Baris bertujuan cabang LAIN tetap "menunggu" → dikirim lalu
        // diterima di cabang. (Invariant sama dengan saldo & penerimaan.)
        if (ke === "menunggu") {
          const lokal = diperbarui
            .filter((r) => r.tujuanBranchId == null || r.tujuanBranchId === r.branchId)
            .map((r) => r.id);
          if (lokal.length > 0) {
            const kini = new Date();
            await tx
              .update(productions)
              .set({ status: "dikonfirmasi", confirmedBy: auth.sub, confirmedAt: kini, waktu: kini })
              .where(
                and(
                  inArray(productions.id, lokal),
                  eq(productions.status, "menunggu"),
                  isNull(productions.deletedAt),
                ),
              );
          }
        }
        return diperbarui;
      });

      if (rows.length === 0) {
        const [ada] = await db
          .select({ status: productions.status })
          .from(productions)
          .where(and(...conds))
          .limit(1);
        if (!ada) throw new HTTPException(404, { message: "Faktur tidak ditemukan" });
        throw new HTTPException(400, {
          message: `Tahap tidak berurutan: faktur berstatus "${ada.status}" — hanya bisa "${dari}" → "${ke}"`,
        });
      }
      if (dana_cair != null) {
        await db.insert(fakturDana).values({
          companyId: auth.company_id!,
          branchId: rows[0].branchId,
          fakturId: c.req.param("fakturId"),
          nominal: dana_cair,
          userId: auth.sub,
        });
      }
      if (realisasi != null) {
        await catatRealisasiDana(db, {
          companyId: auth.company_id!,
          branchId: rows[0].branchId,
          fakturId: c.req.param("fakturId"),
          userId: auth.sub,
          realisasi,
          catatan: selisih_catatan,
        });
      }
      {
        const potongan = [`${rows.length} baris`];
        if (dana_cair != null) potongan.push(`dana cair ${rpLog(dana_cair)}`);
        if (realisasi != null) potongan.push(`realisasi ${rpLog(realisasi)}`);
        await catatLogFaktur(db, {
          companyId: auth.company_id!,
          branchId: rows[0].branchId,
          fakturId: c.req.param("fakturId"),
          jalur: tipe,
          aksi: AKSI_TAHAP_LOG[tipe][ke],
          detail: potongan.join(" · "),
          userId: auth.sub,
        });
      }
      return c.json({ ok: true, status: ke, jumlah_baris: rows.length });
    })
    /**
     * Kirim barang bertujuan cabang dari Central Kitchen (langkah terpisah):
     * produksi setelah "selesai — disimpan di CK", beli setelah "tiba di CK"
     * (semua belanjaan kumpul di CK dulu). Memindah baris yang masih
     * `menunggu` di CK → cabang `tujuan_branch_id` (tetap `menunggu`), lalu
     * muncul di Penerimaan cabang untuk diterima.
     */
    .post("/kirim/:fakturId", zValidator("json", KirimBody), async (c) => {
      const auth = c.get("auth");
      const { tujuan_storage_id } = c.req.valid("json");
      const fakturId = c.req.param("fakturId");
      const conds = [
        eq(productions.companyId, auth.company_id!),
        eq(productions.fakturId, fakturId),
        eq(productions.tipe, tipe),
        eq(productions.status, "menunggu" as const),
        isNull(productions.deletedAt),
      ];
      if (terikatCabang(auth.role) && auth.branch_id) {
        conds.push(eq(productions.branchId, auth.branch_id));
      }
      const baris = await db.select().from(productions).where(and(...conds));
      // hanya baris yang MASIH di CK (belum terkirim) & punya tujuan
      const siap = baris.filter((b) => b.tujuanBranchId && b.branchId !== b.tujuanBranchId);
      if (siap.length === 0) {
        throw new HTTPException(400, {
          message: "Tidak ada barang siap dikirim (selesaikan dulu produksi di CK)",
        });
      }
      const ckId = siap[0].branchId;
      const tujuanId = siap[0].tujuanBranchId!;
      const [store] = await db
        .select({
          id: branches.id,
          nama: branches.nama,
          tipe: branches.tipe,
          centralKitchenId: branches.centralKitchenId,
        })
        .from(branches)
        .where(and(eq(branches.id, tujuanId), eq(branches.companyId, auth.company_id!)));
      if (!store || store.tipe === "kantor") {
        throw new HTTPException(400, { message: "Cabang tujuan tidak valid" });
      }
      // store hanya menerima dari CK pemasoknya
      if (store.tipe === "store" && store.centralKitchenId && store.centralKitchenId !== ckId) {
        throw new HTTPException(400, {
          message: `Cabang "${store.nama}" terhubung ke Central Kitchen lain`,
        });
      }
      // hanya manajemen atau karyawan (tim) di CK pengirim
      if (terikatCabang(auth.role) && auth.branch_id !== ckId) {
        throw new HTTPException(403, { message: "Hanya karyawan Central Kitchen ini yang boleh mengirim" });
      }
      let tujuanStorage: string | null = null;
      if (tujuan_storage_id) {
        const [lok] = await db
          .select({ id: storageLocations.id })
          .from(storageLocations)
          .where(
            and(
              eq(storageLocations.id, tujuan_storage_id),
              eq(storageLocations.companyId, auth.company_id!),
              eq(storageLocations.branchId, tujuanId),
            ),
          );
        if (!lok) {
          throw new HTTPException(400, {
            message: "Tempat penyimpanan tidak valid untuk cabang tujuan",
          });
        }
        tujuanStorage = tujuan_storage_id;
      }
      await db.transaction(async (tx) => {
        await tx
          .update(productions)
          .set({
            // Jalur ini SUDAH benar sejak awal; disatukan ke helper supaya tak
            // ada lagi tempat kedua yang merakit perpindahan dengan tangan.
            ...kolomPindahCabang(tujuanId),
            // tempat penyimpanan CK tidak berlaku di cabang tujuan → set ke
            // pilihan di cabang (bila ada) atau kosongkan (hindari bocor gudang CK)
            storageLocationId: tujuanStorage,
            updatedBy: auth.sub,
            updatedAt: new Date(),
          })
          .where(
            and(
              inArray(
                productions.id,
                siap.map((b) => b.id),
              ),
              eq(productions.status, "menunggu" as const),
              isNull(productions.deletedAt),
            ),
          );
        await catatLogFaktur(tx, {
          companyId: auth.company_id!,
          branchId: ckId,
          fakturId,
          jalur: tipe,
          aksi: `Dikirim ke ${store.nama}`,
          detail: `${siap.length} baris`,
          userId: auth.sub,
        });
      });
      return c.json({ ok: true, tujuan: store.nama, jumlah_baris: siap.length });
    })
    /**
     * KIRIM HASIL PRODUKSI ke cabang peminta (jalur produksi): hasil work-order
     * dari Permintaan sudah masuk STOK CK saat selesai (untuk_branch_id =
     * cabang peminta). Endpoint ini membuat FAKTUR KIRIMAN baru (transfer stok
     * CK → cabang, asal_branch_id = CK) yang wajib DITERIMA di Penerimaan
     * cabang — stok CK berkurang & stok cabang bertambah saat diterima. Baris
     * sumber ditandai selesai-dikirim (untuk_branch_id dikosongkan).
     */
    .post("/kirim-hasil/:fakturId", zValidator("json", KirimHasilBody), async (c) => {
      if (tipe !== "produksi") {
        throw new HTTPException(404, { message: "Hanya untuk faktur produksi" });
      }
      const auth = c.get("auth");
      const { tujuan_storage_id, items } = c.req.valid("json");
      const fakturId = c.req.param("fakturId");
      const conds = [
        eq(productions.companyId, auth.company_id!),
        eq(productions.fakturId, fakturId),
        eq(productions.tipe, "produksi" as const),
        eq(productions.status, "dikonfirmasi" as const),
        isNull(productions.deletedAt),
      ];
      if (terikatCabang(auth.role) && auth.branch_id) {
        conds.push(eq(productions.branchId, auth.branch_id));
      }
      const baris = await db.select().from(productions).where(and(...conds));
      const siap = baris.filter((b) => b.untukBranchId && b.untukBranchId !== b.branchId);
      if (siap.length === 0) {
        throw new HTTPException(400, {
          message:
            "Tidak ada hasil produksi yang menunggu dikirim (selesaikan produksi dulu, atau sudah terkirim)",
        });
      }
      const ckId = siap[0].branchId;
      const tujuanId = siap[0].untukBranchId!;
      const rows = siap.filter((b) => b.branchId === ckId && b.untukBranchId === tujuanId);
      const [store] = await db
        .select({
          id: branches.id,
          nama: branches.nama,
          tipe: branches.tipe,
          centralKitchenId: branches.centralKitchenId,
        })
        .from(branches)
        .where(and(eq(branches.id, tujuanId), eq(branches.companyId, auth.company_id!)));
      if (!store || store.tipe === "kantor") {
        throw new HTTPException(400, { message: "Cabang tujuan tidak valid" });
      }
      if (store.tipe === "store" && store.centralKitchenId && store.centralKitchenId !== ckId) {
        throw new HTTPException(400, {
          message: `Cabang "${store.nama}" terhubung ke Central Kitchen lain`,
        });
      }
      if (terikatCabang(auth.role) && auth.branch_id !== ckId) {
        throw new HTTPException(403, {
          message: "Hanya karyawan Central Kitchen ini yang boleh mengirim",
        });
      }
      let tujuanStorage: string | null = null;
      if (tujuan_storage_id) {
        const [lok] = await db
          .select({ id: storageLocations.id })
          .from(storageLocations)
          .where(
            and(
              eq(storageLocations.id, tujuan_storage_id),
              eq(storageLocations.companyId, auth.company_id!),
              eq(storageLocations.branchId, tujuanId),
            ),
          );
        if (!lok) {
          throw new HTTPException(400, {
            message: "Tempat penyimpanan tidak valid untuk cabang tujuan",
          });
        }
        tujuanStorage = tujuan_storage_id;
      }
      const [company] = await db
        .select({ timezone: companies.timezone })
        .from(companies)
        .where(eq(companies.id, auth.company_id!));
      const prodDate = tanggalDi(company?.timezone ?? "Asia/Jakarta");

      // Qty kiriman per BAHAN: default = jumlah hasil produksi faktur ini;
      // `items` menimpanya (boleh kurang/lebih — dibatasi stok CK, karena
      // kiriman adalah transfer stok nyata).
      const perBahan = new Map<string, { qty: number; rencanaId: string | null }>();
      for (const b of rows) {
        const p = perBahan.get(b.ingredientId);
        perBahan.set(b.ingredientId, {
          qty: (p?.qty ?? 0) + b.qty,
          rencanaId: p?.rencanaId ?? b.rencanaId,
        });
      }
      const kirimMap = new Map(
        [...perBahan.entries()].map(([id, v]) => [id, { qty: v.qty, rencanaId: v.rencanaId }]),
      );
      if (items) {
        kirimMap.clear();
        for (const it of items) {
          const asal = perBahan.get(it.ingredient_id);
          if (!asal) {
            throw new HTTPException(400, {
              message: "Ada bahan yang bukan bagian dari hasil produksi faktur ini",
            });
          }
          kirimMap.set(it.ingredient_id, { qty: it.qty, rencanaId: asal.rencanaId });
        }
      }
      // baris sumber yang bahannya ikut terkirim (pengingatnya dihapus);
      // bahan yang tidak disertakan tetap berpengingat "perlu dikirim"
      const sumberTerkirim = rows.filter((b) => kirimMap.has(b.ingredientId));

      const kirimFakturId = randomUUID();
      const hasil = await db.transaction(async (tx) => {
        // Cek stok CK DI DALAM transaksi + kunci per cabang: saldo diturunkan
        // dari ledger (tak ada baris yang bisa dikunci), jadi tanpa ini dua
        // pengiriman bersamaan sama-sama membaca saldo lama dan lolos.
        await kunciKirimCabang(tx, auth.company_id!, ckId);
        const saldoCk = new Map(
          (await hitungSaldoCabang(auth.company_id!, ckId)).map((r) => [r.ingredient_id, r]),
        );
        // Saldo CK masih memuat barang yang SUDAH dikirim tapi belum diterima
        // cabang tujuan — harus dipotong dulu, kalau tidak stok yang sama bisa
        // dijanjikan ke beberapa permintaan dan saldo CK jadi minus saat semua
        // kiriman diterima.
        const jalanCk = await qtyDalamJalan(tx, auth.company_id!, ckId, [...kirimMap.keys()]);
        // Aturan kemasan kiriman: sama dengan belanja — barang yang hanya bisa
        // dibeli per kemasan juga hanya boleh dikirim per kemasan.
        const bahanKirim = new Map(
          (
            await tx
              .select({
                id: ingredients.id,
                nama: ingredients.nama,
                satuan: ingredients.satuan,
                satuanBeli: ingredients.satuanBeli,
                isi: ingredients.isi,
                pengadaan: ingredients.pengadaan,
                bolehEceran: ingredients.bolehEceran,
              })
              .from(ingredients)
              .where(inArray(ingredients.id, [...kirimMap.keys()]))
          ).map((b) => [b.id, b]),
        );
        for (const [ingId, v] of kirimMap) {
          const s = saldoCk.get(ingId);
          const diJalan = jalanCk.get(ingId) ?? 0;
          const tersedia = (s?.saldo ?? 0) - diJalan;
          if (!s || v.qty > tersedia + 1e-9) {
            const catatanJalan =
              diJalan > 0 ? `, ${diJalan} masih dalam perjalanan ke cabang lain` : "";
            throw new HTTPException(400, {
              message: `Stok CK tidak cukup untuk ${s?.nama ?? "bahan"} (tersedia ${Math.max(0, tersedia)} ${s?.satuan ?? ""}${catatanJalan}) — kurangi jumlah kiriman`,
            });
          }
          const b = bahanKirim.get(ingId);
          if (b) wajibKelipatanKemasan(b, v.qty, Math.max(0, tersedia));
        }
        const asalNomor = (await nomorUntukRefs(tx, auth.company_id!, [fakturId])).get(fakturId);
        // Faktur KIRIMAN (transfer stok CK): lahir langsung 'menunggu' di cabang
        // tujuan — muncul di Penerimaan; saat diterima stok CK asal berkurang.
        await tx.insert(productions).values(
          [...kirimMap.entries()].map(([ingredientId, v]) => ({
            companyId: auth.company_id!,
            branchId: tujuanId,
            asalBranchId: ckId,
            dariBranchId: ckId,
            tujuanBranchId: tujuanId,
            ingredientId,
            qty: v.qty,
            tipe: "produksi" as const,
            totalHarga: 0, // pemindahan stok yang sudah ada — tanpa biaya baru
            fakturId: kirimFakturId,
            rencanaId: v.rencanaId,
            noFaktur: null,
            supplierId: null,
            storageLocationId: tujuanStorage,
            status: "menunggu" as const,
            isBatch: false,
            catatan: asalNomor ? `Kiriman hasil produksi ${asalNomor}` : "Kiriman hasil produksi",
            userId: auth.sub,
            workerId: null,
            prodDate,
          })),
        );
        const nomorBaru = await terbitkanNomor(tx, auth.company_id!, "produksi", kirimFakturId);
        // sumber ditandai selesai-dikirim → pengingat & tombol Kirim hilang
        await tx
          .update(productions)
          .set({ untukBranchId: null, updatedBy: auth.sub, updatedAt: new Date() })
          .where(
            inArray(
              productions.id,
              sumberTerkirim.map((b) => b.id),
            ),
          );
        await catatLogFaktur(tx, {
          companyId: auth.company_id!,
          branchId: ckId,
          fakturId,
          jalur: "produksi",
          aksi: `Hasil dikirim ke ${store.nama}`,
          detail: `${nomorBaru} · ${kirimMap.size} bahan`,
          userId: auth.sub,
        });
        await catatLogFaktur(tx, {
          companyId: auth.company_id!,
          branchId: ckId,
          fakturId: kirimFakturId,
          jalur: "produksi",
          aksi: "Kiriman hasil produksi dibuat",
          detail: `${asalNomor ? `dari ${asalNomor} · ` : ""}tujuan ${store.nama} · ${kirimMap.size} bahan`,
          userId: auth.sub,
        });
        return { nomor: nomorBaru };
      });
      return c.json({
        ok: true,
        faktur_id: kirimFakturId,
        nomor: hasil.nomor,
        tujuan: store.nama,
        jumlah_baris: kirimMap.size,
      });
    })
    /** Buku dana satu faktur: entri pencairan/tambahan/kembali + total efektif. */
    .get("/dana/:fakturId", async (c) => {
      const auth = c.get("auth");
      const fakturId = c.req.param("fakturId");
      if (!/^[0-9a-f-]{36}$/i.test(fakturId)) {
        throw new HTTPException(404, { message: "Faktur tidak ditemukan" });
      }
      const conds = [
        eq(productions.companyId, auth.company_id!),
        eq(productions.fakturId, fakturId),
        eq(productions.tipe, tipe),
        isNull(productions.deletedAt),
      ];
      if (terikatCabang(auth.role) && auth.branch_id) {
        conds.push(eq(productions.branchId, auth.branch_id));
      }
      const [ada] = await db
        .select({ id: productions.id })
        .from(productions)
        .where(and(...conds))
        .limit(1);
      if (!ada) throw new HTTPException(404, { message: "Faktur tidak ditemukan" });

      const rows = await db
        .select({
          id: fakturDana.id,
          tipe: fakturDana.tipe,
          nominal: fakturDana.nominal,
          catatan: fakturDana.catatan,
          oleh: danaOleh.nama,
          waktu: fakturDana.waktu,
        })
        .from(fakturDana)
        .leftJoin(danaOleh, eq(fakturDana.userId, danaOleh.id))
        .where(
          and(eq(fakturDana.companyId, auth.company_id!), eq(fakturDana.fakturId, fakturId)),
        )
        .orderBy(asc(fakturDana.waktu), asc(fakturDana.id));
      const total = rows.reduce(
        (t, r) => t + (r.tipe === "kembali" ? -r.nominal : r.nominal),
        0,
      );
      return c.json({ rows, total });
    })
    /**
     * Konfirmasi "ya, ada": barang benar-benar diterima → stok terhitung.
     *
     * PINTU UNTUK BARANG YANG TIDAK KE MANA-MANA. Faktur yang PUNYA ALAMAT
     * (`tujuan_branch_id`) sengaja tidak bisa lewat sini: barang berpindah
     * cabang harus DITERIMA orang di cabang tujuan lewat Penerimaan, bukan
     * dituntaskan sepihak oleh pengirimnya. Itulah pengaman "harus ada
     * penerimaan dulu" — satu barang, satu pintu.
     */
    .post("/konfirmasi/:fakturId", async (c) => {
      const auth = c.get("auth");
      const conds = [
        eq(productions.companyId, auth.company_id!),
        eq(productions.fakturId, c.req.param("fakturId")),
        eq(productions.tipe, tipe),
        eq(productions.status, "menunggu"),
        // Barang beralamat (work-order CK maupun belanja yang dikirim ke
        // cabang) TIDAK dikonfirmasi di sini — lihat blok dokumentasi di atas.
        isNull(productions.tujuanBranchId),
      ];
      if (terikatCabang(auth.role) && auth.branch_id) {
        conds.push(eq(productions.branchId, auth.branch_id));
      }
      // waktu = saat dikonfirmasi (bukan saat RAB dibuat) agar stok masuk
      // terhitung relatif ke opname terakhir — kalau tetap pakai waktu insert,
      // faktur yang dibuat sebelum opname lalu dikonfirmasi setelahnya tak
      // pernah masuk saldo.
      const now = new Date();
      const rows = await db
        .update(productions)
        .set({ status: "dikonfirmasi", confirmedBy: auth.sub, confirmedAt: now, waktu: now })
        .where(and(...conds))
        .returning();
      if (rows.length === 0) {
        // Bedakan "tidak ada apa-apa" dari "ADA, tapi ini kiriman beralamat".
        // Tanpa pembedaan ini penolakannya terbaca seperti faktur hilang, dan
        // orang akan mengira datanya rusak padahal pengamannya sedang bekerja.
        const beralamat = await db
          .select({ id: productions.id })
          .from(productions)
          .where(
            and(
              eq(productions.companyId, auth.company_id!),
              eq(productions.fakturId, c.req.param("fakturId")),
              eq(productions.tipe, tipe),
              eq(productions.status, "menunggu"),
              isNull(productions.deletedAt),
              sql`${productions.tujuanBranchId} IS NOT NULL`,
            ),
          )
          .limit(1);
        if (beralamat.length > 0) {
          throw new HTTPException(409, {
            message:
              "Kiriman ini beralamat ke cabang — selesaikan lewat Penerimaan di cabang tujuan, bukan konfirmasi di sini",
          });
        }
        throw new HTTPException(404, {
          message: "Faktur tidak ditemukan atau sudah dikonfirmasi",
        });
      }
      // masuk stok cabang → otomatis diletakkan di rak default bahannya
      await autoFileRakCabang(auth.company_id!, rows.map((r) => r.id));
      await catatLogFaktur(db, {
        companyId: auth.company_id!,
        branchId: rows[0].branchId,
        fakturId: c.req.param("fakturId"),
        jalur: tipe,
        aksi: AKSI_TAHAP_LOG[tipe].dikonfirmasi,
        detail: `${rows.length} baris`,
        userId: auth.sub,
      });
      return c.json({ ok: true, jumlah_baris: rows.length });
    })
    /** Riwayat kegiatan satu faktur: dibuat → tahap → konfirmasi/penerimaan. */
    .get("/log/:fakturId", async (c) => {
      const auth = c.get("auth");
      const fakturId = c.req.param("fakturId");
      if (!/^[0-9a-f-]{36}$/i.test(fakturId)) {
        throw new HTTPException(404, { message: "Faktur tidak ditemukan" });
      }
      const conds = [
        eq(productions.companyId, auth.company_id!),
        eq(productions.fakturId, fakturId),
        eq(productions.tipe, tipe),
        isNull(productions.deletedAt),
      ];
      if (terikatCabang(auth.role) && auth.branch_id) {
        conds.push(eq(productions.branchId, auth.branch_id));
      }
      const [ada] = await db
        .select({ id: productions.id })
        .from(productions)
        .where(and(...conds))
        .limit(1);
      if (!ada) throw new HTTPException(404, { message: "Faktur tidak ditemukan" });

      const rows = await db
        .select({
          id: fakturLogs.id,
          aksi: fakturLogs.aksi,
          detail: fakturLogs.detail,
          oleh: logOleh.nama,
          waktu: fakturLogs.waktu,
        })
        .from(fakturLogs)
        .leftJoin(logOleh, eq(fakturLogs.userId, logOleh.id))
        .where(
          and(eq(fakturLogs.companyId, auth.company_id!), eq(fakturLogs.fakturId, fakturId)),
        )
        .orderBy(asc(fakturLogs.waktu), asc(fakturLogs.id));
      return c.json({ rows });
    })
    /**
     * PRATINJAU DAMPAK laporan harga — tidak menulis apa pun.
     *
     * "Laporan Harga" tampak seperti sekadar mencatat nota, padahal juga
     * menyegarkan HARGA ACUAN bahan; dan karena HPP dihitung live dari harga
     * acuan, food cost SEMUA menu yang memakai bahan itu ikut bergeser. Di sini
     * pergeserannya dihitung lebih dulu dengan fungsi yang SAMA seperti yang
     * menulis (`hitungAcuanBaru`), jadi pratinjau tak mungkin beda dari hasil.
     *
     * POST, bukan GET: dampaknya bergantung pada angka yang sedang DIKETIK
     * user, bukan pada angka yang sudah tersimpan di faktur.
     *
     * AKSES = gerbang `/pembelian/*` (manajemen ATAU karyawan Central Kitchen),
     * tanpa penyempitan tambahan di sini. Yang belanja dan memegang notanya
     * adalah tim CK; menutup laporan harga dari mereka berarti harga riil baru
     * masuk kalau manajemen sempat menyalinnya — dan selama belum, RAB belanja
     * berikutnya memakai harga yang sudah basi.
     */
    .post(
      "/laporan-harga/:fakturId/dampak",
      zValidator("json", z.object({ items: LaporanHargaItems })),
      async (c) => {
        if (tipe !== "beli") {
          throw new HTTPException(400, {
            message: "Laporan harga hanya untuk faktur belanja bahan baku",
          });
        }
        const auth = c.get("auth");
        const { items } = c.req.valid("json");
        const { byId, target } = await bacaBarisLaporan(
          auth.company_id!,
          c.req.param("fakturId"),
          items,
        );
        const acuanBaru = await hitungAcuanBaru(db, auth.company_id!, byId, target);
        const idBahan = [...acuanBaru.keys()];
        const [katalog, perusahaan, bahanRows] = await Promise.all([
          loadKatalog(db, auth.company_id!),
          db
            .select({ foodCostMaks: companies.foodCostMaks })
            .from(companies)
            .where(eq(companies.id, auth.company_id!)),
          idBahan.length > 0
            ? db
                .select({
                  id: ingredients.id,
                  nama: ingredients.nama,
                  satuan: ingredients.satuan,
                  satuanBeli: ingredients.satuanBeli,
                  hargaBeli: ingredients.hargaBeli,
                })
                .from(ingredients)
                .where(
                  and(
                    eq(ingredients.companyId, auth.company_id!),
                    inArray(ingredients.id, idBahan),
                  ),
                )
            : Promise.resolve([]),
        ]);
        const foodCostMaks = perusahaan[0]?.foodCostMaks ?? 40;
        const bahanById = new Map(bahanRows.map((b) => [b.id, b]));

        const hargaPerUnitBaru = new Map<string, number>();
        const bahan: DampakBahan[] = [];
        for (const [ingredientId, { isi, acuan }] of acuanBaru) {
          const ing = bahanById.get(ingredientId);
          if (!ing || acuan == null) continue;
          const acuanBaruRp = Math.round(acuan * isi);
          hargaPerUnitBaru.set(ingredientId, hargaPerUnit(acuanBaruRp, isi));
          bahan.push({
            ingredient_id: ingredientId,
            nama: ing.nama,
            // acuan itu harga per KEMASAN beli, bukan per satuan resep
            satuan: ing.satuanBeli ?? ing.satuan,
            acuan_lama: ing.hargaBeli,
            acuan_baru: acuanBaruRp,
            jumlah_menu_terdampak: menuMemakaiBahan(katalog, ingredientId).length,
          });
        }
        const katalogBaru = katalogDenganHarga(katalog, hargaPerUnitBaru);
        const menuLewat: DampakMenu[] = [];
        for (const m of katalog.rows) {
          if (!m.isActive) continue;
          const lama = toMenuDto(m, katalog).food_cost_persen;
          const baru = toMenuDto(m, katalogBaru).food_cost_persen;
          // Hanya yang MENYEBERANG ambang — menu yang sudah tinggi sejak awal
          // bukan kabar baru dan cuma membuat panel ini ramai.
          if (lama <= foodCostMaks && baru > foodCostMaks) {
            menuLewat.push({
              menu_id: m.id,
              nama: m.nama,
              food_cost_lama: lama,
              food_cost_baru: baru,
            });
          }
        }
        menuLewat.sort((a, b) => b.food_cost_baru - a.food_cost_baru);
        const hasil: DampakLaporanHarga = {
          food_cost_maks: foodCostMaks,
          bahan,
          menu_lewat_ambang: menuLewat,
        };
        return c.json(hasil);
      },
    )
    /**
     * LAPORAN HARGA faktur belanja: catat harga riil yang dibayar per baris
     * (setelah barang dibeli/dikirim) → total_harga baris diperbarui + harga
     * beli acuan tiap bahan disegarkan ke MEDIAN riwayat pembelian (acuan RAB;
     * harga riil per lot tetap dipakai HPP FIFO/resep). Khusus jalur BELI.
     *
     * AKSES = gerbang `/pembelian/*` (manajemen ATAU karyawan Central Kitchen).
     * Yang pulang dari pasar sambil memegang notanya adalah tim CK, jadi
     * merekalah yang paling tahu harga sebenarnya. Pengamannya bukan peran,
     * melainkan pratinjau: endpoint `/dampak` di atas menghitung pergeseran food
     * cost tiap menu SEBELUM apa pun ditulis, dan layar menampilkannya. Tiap
     * baris yang dilaporkan juga menyimpan `updated_by` + `laporan_harga_at`,
     * jadi pelaku dan waktunya tercatat per baris (tampil sbg `diubah_oleh`).
     *
     * PENTING — kolam median hanya memuat lot yang harganya PERNAH DILIHAT
     * MANUSIA (`harga_tebakan = false`): harga diisi di faktur, dilaporkan
     * lewat endpoint ini, atau direalisasi saat tahap. Faktur yang dibuat tanpa
     * harga memakai TEBAKAN `hargaDefault()` yang diturunkan dari harga acuan
     * saat itu; kalau tebakan ikut dihitung, acuan menyeret dirinya sendiri
     * (acuan → tebakan → median → acuan) dan HPP seluruh menu ikut hanyut.
     *
     * `perbarui_acuan: false` mencatat harga nota saja tanpa menyentuh harga
     * acuan bahan — dipakai saat nota tidak mewakili harga pasar (mis. beli
     * eceran darurat). Bawaannya `true` supaya klien lama tak berubah perilaku.
     */
    .post(
      "/laporan-harga/:fakturId",
      zValidator(
        "json",
        z.object({ items: LaporanHargaItems, perbarui_acuan: z.boolean().optional() }),
      ),
      async (c) => {
        if (tipe !== "beli") {
          throw new HTTPException(400, {
            message: "Laporan harga hanya untuk faktur belanja bahan baku",
          });
        }
        const auth = c.get("auth");
        const { items, perbarui_acuan: perbaruiAcuanBody } = c.req.valid("json");
        // Bawaan true: klien lama (termasuk aplikasi mobile) tak berubah perilaku.
        const perbaruiAcuan = perbaruiAcuanBody ?? true;
        const { byId, target } = await bacaBarisLaporan(
          auth.company_id!,
          c.req.param("fakturId"),
          items,
        );
        await db.transaction(async (tx) => {
          for (const [id, totalHarga] of target) {
            await tx
              .update(productions)
              .set({
                totalHarga,
                // angka dari nota — bukan tebakan lagi, boleh menentukan acuan
                hargaTebakan: false,
                laporanHargaAt: new Date(),
                updatedAt: new Date(),
                updatedBy: auth.sub,
              })
              .where(
                and(eq(productions.id, id), eq(productions.companyId, auth.company_id!)),
              );
          }
          // Segarkan HARGA ACUAN tiap bahan yang dilaporkan ke MEDIAN riwayat
          // pembelian — acuan dipakai RAB belanja berikutnya; harga riil per lot
          // tetap tercatat utk HPP FIFO/resep. Fallback bila belum ada lot
          // berharga-dilaporkan: harga baris yang barusan dilaporkan.
          //
          // Kolam median HANYA memuat lot ber-`harga_tebakan = false` (lihat
          // `hitungAcuanBaru`). Faktur yang dibuat tanpa harga membawa TEBAKAN
          // `hargaDefault()` yang diturunkan dari harga acuan saat itu; kalau
          // ikut dihitung, acuan menyeret dirinya sendiri (acuan → tebakan →
          // median → acuan) sampai HPP seluruh menu hanyut naik.
          if (!perbaruiAcuan) return;
          const acuanBaru = await hitungAcuanBaru(tx, auth.company_id!, byId, target);
          for (const [ingredientId, { isi, acuan }] of acuanBaru) {
            if (acuan == null) continue;
            await tx
              .update(ingredients)
              .set({ hargaBeli: Math.round(acuan * isi), updatedAt: new Date() })
              .where(
                and(eq(ingredients.id, ingredientId), eq(ingredients.companyId, auth.company_id!)),
              );
          }
        });
        return c.json({ ok: true, jumlah: target.size });
      },
    )
    .post("/", zValidator("json", TambahStokBody), async (c) => {
      const auth = c.get("auth");
      const body = c.req.valid("json");
      const branchId = await resolveBranchUntukTulis(c, body.branch_id);

      const [ingRow] = await db
        .select()
        .from(ingredients)
        .where(
          and(
            eq(ingredients.id, body.ingredient_id),
            eq(ingredients.companyId, auth.company_id!),
          ),
        );
      const ing = pastikanJalur(ingRow, tipe, body.ingredient_id);
      // Kitchen cabang: hanya bahan ber-produksi_di "cabang" (diatur di Resep).
      await pastikanBolehDiproduksiKitchen(auth.role, branchId, [ing]);

      const [company] = await db
        .select({ timezone: companies.timezone })
        .from(companies)
        .where(eq(companies.id, auth.company_id!));

      const qty = body.batch ? ing.isi : body.qty!;
      const row = await db.transaction(async (tx) => {
        const [baru] = await tx
          .insert(productions)
          .values({
            companyId: auth.company_id!,
            branchId,
            ingredientId: ing.id,
            qty,
            tipe,
            totalHarga:
              tipe === "beli" ? (body.total_harga ?? hargaDefault(qty, ing)) : null,
            hargaTebakan: tipe !== "beli" || body.total_harga == null,
            isBatch: body.batch,
            catatan: body.catatan ?? null,
            userId: auth.sub,
            prodDate: tanggalDi(company?.timezone ?? "Asia/Jakarta"),
            // lahir langsung dikonfirmasi (masuk stok) → exp dari masa simpan
            expDate:
              ing.masaSimpanHari > 0
                ? tambahHari(tanggalDi(company?.timezone ?? "Asia/Jakarta"), ing.masaSimpanHari)
                : null,
          })
          .returning();
        // baris lahir langsung 'dikonfirmasi' (tanpa tahap) → produksi selesai
        // seketika → konsumsi bahan mentah resep di cabang ini
        if (tipe === "produksi") {
          await catatKonsumsiProduksi(tx, auth.company_id!, [
            { id: baru.id, branchId, ingredientId: ing.id, qty },
          ]);
        }
        return baru;
      });
      return c.json({ ...row, bahan: ing.nama }, 201);
    })
    /**
     * Daftar "buku besar": pagination per FAKTUR. Urutan: faktur yang BELUM
     * selesai (masih di pipeline) dulu, lalu terbaru → terlama (halaman awal
     * = yang perlu ditindak + terbaru). Filter rentang tanggal opsional
     * (dari/sampai). Balikan { rows, total, total_pengeluaran }.
     */
    .get("/", async (c) => {
      const auth = c.get("auth");
      // Kantor = pusat pemantauan: owner/admin boleh "?branch_id=all" untuk
      // melihat faktur SEMUA cabang (kasir/tim tetap terkunci cabangnya).
      const semuaCabang = !terikatCabang(auth.role) && c.req.query("branch_id") === "all";
      const branchId = semuaCabang ? null : await resolveBranchId(c);
      const dari = tglValid(c.req.query("dari"));
      const sampai = tglValid(c.req.query("sampai"));
      // dukung juga ?tanggal= (satu hari) demi kompatibilitas
      const satuHari = tglValid(c.req.query("tanggal"));
      const page = Math.max(1, Number(c.req.query("page") ?? "1") || 1);
      const perPage = Math.min(200, Math.max(1, Number(c.req.query("per_page") ?? "20") || 20));

      // Cabang PENGIRIM tetap melihat faktur yang sudah terkirim: baris yang
      // pindah ke cabang tujuan menyimpan jejak dari/asal — tanpa ini tim CK
      // kehilangan faktur begitu semua barisnya dikirim.
      const condCabang = branchId
        ? [
            or(
              eq(productions.branchId, branchId),
              eq(productions.dariBranchId, branchId),
              eq(productions.asalBranchId, branchId),
            )!,
          ]
        : [];
      const conds = [
        eq(productions.companyId, auth.company_id!),
        ...condCabang,
        eq(productions.tipe, tipe),
        isNull(productions.deletedAt),
      ];
      if (satuHari) conds.push(eq(productions.prodDate, satuHari));
      if (dari) conds.push(gte(productions.prodDate, dari));
      if (sampai) conds.push(lte(productions.prodDate, sampai));
      // Role KITCHEN/BAR hanya melihat pekerjaan DIVISINYA: baris produksi
      // cabang milik divisi lain disembunyikan (bar tak melihat resep kitchen,
      // dan sebaliknya). Baris lain (kiriman/bahan CK) tetap tampil — hanya
      // resep cabang yang berdivisi. Berlaku juga utk hitungan badge nav.
      // Dipakai di ketiga query (ringkas, kunci halaman, baris) agar faktur
      // campuran divisi pun hanya menampilkan baris divisinya sendiri.
      const condDivisi =
        auth.role === "kitchen" || auth.role === "bar"
          ? [
              notInArray(
                productions.ingredientId,
                db
                  .select({ id: ingredients.id })
                  .from(ingredients)
                  .where(
                    and(
                      eq(ingredients.companyId, auth.company_id!),
                      eq(ingredients.produksiDi, "cabang"),
                      ne(ingredients.divisiProduksi, auth.role),
                    ),
                  ),
              ),
            ]
          : [];
      conds.push(...condDivisi);

      // Faktur TRANSFER STOK (nomor TF-) menumpang bentuk baris `productions`
      // yang sama, tapi itu pemindahan stok jadi — bukan pekerjaan produksi.
      // Disaring di sini agar tidak mengotori daftar/badge Produksi; jalurnya
      // sendiri ada di menu Transfer Stok & Penerimaan Barang.
      const condBukanTransfer = [
        notExists(
          db
            .select({ ada: sql`1` })
            .from(dokumenNomor)
            .where(
              and(
                eq(dokumenNomor.companyId, productions.companyId),
                eq(dokumenNomor.refId, productions.fakturId),
                eq(dokumenNomor.jenis, "transfer"),
              ),
            ),
        ),
      ];
      conds.push(...condBukanTransfer);

      const keyExpr = sql<string>`COALESCE(${productions.fakturId}::text, ${productions.id}::text)`;

      const [ringkas] = await db
        .select({
          total: sql<number>`COUNT(DISTINCT ${keyExpr})::int`,
          total_pengeluaran: sql<number>`COALESCE(SUM(${productions.totalHarga}) FILTER (WHERE ${productions.status} = 'dikonfirmasi'), 0)`,
        })
        .from(productions)
        .where(and(...conds));
      const total = ringkas?.total ?? 0;

      // faktur untuk halaman ini: yang belum selesai (ada baris yang masih di
      // pipeline) dulu, lalu terbaru → terlama
      const keyRows = await db
        .select({ key: keyExpr })
        .from(productions)
        .where(and(...conds))
        .groupBy(keyExpr)
        .orderBy(
          sql`MAX(CASE WHEN ${productions.status} NOT IN ('dikonfirmasi', 'ditolak') THEN 1 ELSE 0 END) DESC`,
          sql`MIN(${productions.waktu}) DESC`,
        )
        .limit(perPage)
        .offset((page - 1) * perPage);
      const keys = keyRows.map((r) => r.key);

      const select = {
        id: productions.id,
        ingredient_id: productions.ingredientId,
        bahan: ingredients.nama,
        isi: ingredients.isi,
        /**
         * SATUAN TAMPILAN BARIS INI. `qty` di bawah SELALU dinyatakan dalam
         * `satuan` (satuan kerja/resep) — lihat pembuatan baris:
         * `qty = mode === "batch" ? jumlah * isi : jumlah`. Jadi pasangan yang
         * benar untuk ditampilkan adalah `qty` + `satuan`.
         */
        satuan: ingredients.satuan,
        /**
         * Satuan BELI/kemasan (mis. "kg"), hanya untuk input pembelian &
         * dokumen belanja. JANGAN dipasangkan langsung dengan `qty` — itu
         * membuat 900 gr terbaca "900 kg". Konversinya: qty ÷ isi.
         */
        satuan_beli: ingredients.satuanBeli,
        /** jumlah dalam `satuan` (satuan kerja), bukan dalam `satuan_beli` */
        qty: productions.qty,
        total_harga: productions.totalHarga,
        /**
         * ASAL-USUL input, BUKAN satuan: true = user mengetiknya dalam kemasan
         * (`mode:"batch"`) lalu server mengalikannya dengan `isi`. Menampilkan
         * kata "batch" sebagai satuan `qty` salah — qty-nya sudah terlanjur
         * dikonversi ke satuan kerja.
         */
        is_batch: productions.isBatch,
        catatan: productions.catatan,
        waktu: productions.waktu,
        prod_date: productions.prodDate,
        // exp lot (terisi saat masuk stok) + masa simpan master (default form Tiba)
        exp_date: productions.expDate,
        masa_simpan_hari: ingredients.masaSimpanHari,
        /** "produksi" | "beli" — penentu apakah baris ini punya batch resep */
        pengadaan: ingredients.pengadaan,
        // lokasi + divisi produksi resep (badge Kitchen/Bar utk produksi cabang)
        produksi_di: ingredients.produksiDi,
        divisi_produksi: ingredients.divisiProduksi,
        faktur_id: productions.fakturId,
        no_faktur: productions.noFaktur,
        // nomor dokumen otomatis (PB-/PR-) — sama untuk semua baris satu faktur
        nomor: dokumenNomor.nomorTeks,
        status: productions.status,
        supplier: suppliers.nama,
        tempat: storageLocations.nama,
        storage_location_id: productions.storageLocationId,
        // laporan harga riil (jalur beli) sudah dibuat utk baris ini? → status "Selesai"
        laporan_harga_at: productions.laporanHargaAt,
        /**
         * true = `total_harga` baris ini TEBAKAN, belum pernah dilihat manusia
         * (estimasi RAB, belanja otomatis, atau hasil skala saat realisasi qty
         * melebihi rencana). Baris bertanda ini DIKECUALIKAN dari kolam median
         * harga acuan — tanpa itu acuan menyeret dirinya sendiri naik.
         */
        harga_tebakan: productions.hargaTebakan,
        supplier_id: productions.supplierId,
        dibuat_oleh: pembuat.nama,
        diubah_oleh: pengubah.nama,
        updated_at: productions.updatedAt,
        worker_id: productions.workerId,
        dikerjakan_oleh: pekerja.nama,
        qty_dipesan: productions.qtyDipesan,
        alasan_tolak: productions.alasanTolak,
        // cabang baris + cabang tujuan work-order (utk tampilan Kantor & kirim)
        branch_id: productions.branchId,
        cabang: cabangProd.nama,
        tujuan_branch_id: productions.tujuanBranchId,
        tujuan_cabang: tujuanProd.nama,
        // transfer stok antar-cabang (kirim dari stok CK / kirim hasil):
        // kartu tampil sebagai "Kiriman", bukan produksi baru
        asal_branch_id: productions.asalBranchId,
        // asal permintaan (badge "Permintaan" vs "Langsung")
        rencana_id: productions.rencanaId,
        // nomor dokumen permintaan (PM-xxxx) — badge identitas asal faktur
        permintaan_nomor: dokPermintaan.nomorTeks,
        // "diproduksi UNTUK cabang" — pengingat kirim hasil setelah selesai
        untuk_branch_id: productions.untukBranchId,
        untuk_cabang: untukProd.nama,
        // supplier UTAMA bahan baris ini (info "beli di mana" saat diproses)
        supplier_bahan: supBahan.nama,
        supplier_bahan_alamat: supBahan.alamat,
        supplier_bahan_telepon: supBahan.telepon,
        // total dana EFEKTIF faktur ini: cair + tambahan − kembali (sama di tiap baris)
        dana_cair: sql<number>`COALESCE((SELECT SUM(CASE WHEN fd.tipe = 'kembali' THEN -fd.nominal ELSE fd.nominal END)::float8 FROM faktur_dana fd WHERE fd.faktur_id = ${productions.fakturId}), 0)`,
      };
      const rows =
        keys.length === 0
          ? []
          : await db
              .select(select)
              .from(productions)
              .innerJoin(ingredients, eq(productions.ingredientId, ingredients.id))
              .leftJoin(suppliers, eq(productions.supplierId, suppliers.id))
              .leftJoin(storageLocations, eq(productions.storageLocationId, storageLocations.id))
              .leftJoin(pembuat, eq(productions.userId, pembuat.id))
              .leftJoin(pengubah, eq(productions.updatedBy, pengubah.id))
              .leftJoin(pekerja, eq(productions.workerId, pekerja.id))
              .leftJoin(cabangProd, eq(productions.branchId, cabangProd.id))
              .leftJoin(tujuanProd, eq(productions.tujuanBranchId, tujuanProd.id))
              .leftJoin(untukProd, eq(productions.untukBranchId, untukProd.id))
              .leftJoin(
                dokumenNomor,
                and(
                  eq(dokumenNomor.companyId, productions.companyId),
                  eq(dokumenNomor.refId, productions.fakturId),
                ),
              )
              .leftJoin(
                dokPermintaan,
                and(
                  eq(dokPermintaan.companyId, productions.companyId),
                  eq(dokPermintaan.refId, productions.rencanaId),
                ),
              )
              // maks SATU baris utama per bahan (partial unique index) → join 1:≤1
              .leftJoin(
                isupUtama,
                and(
                  eq(isupUtama.ingredientId, productions.ingredientId),
                  eq(isupUtama.isUtama, true),
                ),
              )
              .leftJoin(supBahan, eq(isupUtama.supplierId, supBahan.id))
              .where(
                and(
                  eq(productions.companyId, auth.company_id!),
                  ...condCabang,
                  ...condDivisi,
                  ...condBukanTransfer,
                  eq(productions.tipe, tipe),
                  isNull(productions.deletedAt),
                  inArray(keyExpr, keys),
                ),
              )
              .orderBy(asc(productions.waktu), asc(productions.id));

      // RAK DEFAULT bahan di cabang penyimpanan (tujuan ?? cabang baris) untuk
      // pratinjau "akan disimpan di rak X" saat barang tiba/disimpan. Diambil
      // dari Tempat Penyimpanan (storage_location_ingredients) per cabang.
      const ingUnik = [...new Set(rows.map((r) => r.ingredient_id))];
      const rakByKey = new Map<string, { id: string; nama: string }>();
      if (ingUnik.length > 0) {
        const asg = await db
          .select({
            ingredientId: storageLocationIngredients.ingredientId,
            branchId: storageLocations.branchId,
            rakId: storageLocations.id,
            rakNama: storageLocations.nama,
          })
          .from(storageLocationIngredients)
          .innerJoin(
            storageLocations,
            eq(storageLocations.id, storageLocationIngredients.storageLocationId),
          )
          .where(
            and(
              eq(storageLocationIngredients.companyId, auth.company_id!),
              inArray(storageLocationIngredients.ingredientId, ingUnik),
            ),
          );
        for (const a of asg)
          rakByKey.set(`${a.ingredientId}|${a.branchId}`, { id: a.rakId, nama: a.rakNama });
      }
      const rowsRak = rows.map((r) => {
        const destBranch = r.tujuan_branch_id ?? r.branch_id;
        const rak = destBranch ? rakByKey.get(`${r.ingredient_id}|${destBranch}`) : undefined;
        // Teks kuantitas ditulis SERVER. Klien yang menyusunnya sendiri pernah
        // memasangkan `qty` dengan `satuan_beli` ("900 kg" untuk 900 gr) dan
        // dengan kata "batch"; `qty_teks` menghapus ruang tebakan itu.
        const t = qtyTeks({ qty: r.qty, satuan: r.satuan, isi: r.isi, satuanBeli: r.satuan_beli });
        // Berapa kali resep dijalankan. `qty` menjawab "berapa banyak jadinya",
        // `batch` menjawab "berapa kali masak" — itu yang dikerjakan orang di
        // dapur, dan sebelumnya tak pernah dikirim ke klien mana pun.
        const b = batchTeks({ qty: r.qty, satuan: r.satuan, isi: r.isi, pengadaan: r.pengadaan });
        return {
          ...r,
          qty_teks: t.teks,
          qty_setara: t.setara,
          batch: b.batch,
          batch_teks: b.teks,
          default_storage_location_id: rak?.id ?? null,
          default_tempat: rak?.nama ?? null,
        };
      });

      return c.json({
        rows: rowsRak,
        total,
        page,
        per_page: perPage,
        total_pengeluaran: Number(ringkas?.total_pengeluaran ?? 0),
      });
    })
    /** Ubah metadata faktur (butuh password). Tak mengubah qty/harga → stok tetap. */
    .patch("/faktur/:key", zValidator("json", FakturEditBody), async (c) => {
      const auth = c.get("auth");
      const body = c.req.valid("json");
      const key = c.req.param("key");
      if (!/^[0-9a-f-]{36}$/i.test(key)) {
        throw new HTTPException(404, { message: "Faktur tidak ditemukan" });
      }
      await verifikasiPassword(auth.sub, body.password);

      // Muat faktur (milik perusahaan + jalur, belum dihapus) untuk cek + branch
      const barisFaktur = await db
        .select({ id: productions.id, branchId: productions.branchId })
        .from(productions)
        .where(
          and(
            eq(productions.companyId, auth.company_id!),
            eq(productions.tipe, tipe),
            isNull(productions.deletedAt),
            cocokFaktur(key),
          ),
        );
      if (barisFaktur.length === 0) {
        throw new HTTPException(404, { message: "Faktur tidak ditemukan" });
      }
      const branchId = barisFaktur[0].branchId;

      if (body.supplier_id) {
        const [s] = await db
          .select({ id: suppliers.id })
          .from(suppliers)
          .where(
            and(eq(suppliers.id, body.supplier_id), eq(suppliers.companyId, auth.company_id!)),
          );
        if (!s) throw new HTTPException(400, { message: "Supplier tidak valid" });
      }
      if (body.storage_location_id) {
        const [l] = await db
          .select({ id: storageLocations.id })
          .from(storageLocations)
          .where(
            and(
              eq(storageLocations.id, body.storage_location_id),
              eq(storageLocations.branchId, branchId),
            ),
          );
        if (!l) throw new HTTPException(400, { message: "Tempat penyimpanan tidak valid" });
      }

      const set: Partial<typeof productions.$inferInsert> = {
        updatedBy: auth.sub,
        updatedAt: new Date(),
      };
      if (body.worker_id !== undefined && tipe === "produksi") {
        if (body.worker_id) await pastikanKaryawan(body.worker_id, auth.company_id!);
        set.workerId = body.worker_id ?? null;
      }
      if (body.supplier_id !== undefined) set.supplierId = body.supplier_id ?? null;
      if (body.no_faktur !== undefined) set.noFaktur = body.no_faktur ?? null;
      if (body.catatan !== undefined) set.catatan = body.catatan ?? null;
      if (body.storage_location_id !== undefined)
        set.storageLocationId = body.storage_location_id ?? null;
      if (body.prod_date !== undefined) set.prodDate = body.prod_date;

      const rows = await db
        .update(productions)
        .set(set)
        .where(
          and(
            eq(productions.companyId, auth.company_id!),
            eq(productions.tipe, tipe),
            isNull(productions.deletedAt),
            cocokFaktur(key),
          ),
        )
        .returning({ id: productions.id });
      return c.json({ ok: true, jumlah_baris: rows.length });
    })
    /**
     * Hapus faktur → Tempat Sampah (SOFT-DELETE, cukup konfirmasi — tanpa
     * password; bisa dipulihkan dari Tempat Sampah). Stok dikoreksi.
     */
    .delete("/faktur/:key", async (c) => {
      const auth = c.get("auth");
      const key = c.req.param("key");
      if (!/^[0-9a-f-]{36}$/i.test(key)) {
        throw new HTTPException(404, { message: "Faktur tidak ditemukan" });
      }
      const rows = await db
        .update(productions)
        .set({ deletedAt: new Date(), deletedBy: auth.sub })
        .where(
          and(
            eq(productions.companyId, auth.company_id!),
            eq(productions.tipe, tipe),
            isNull(productions.deletedAt),
            cocokFaktur(key),
          ),
        )
        .returning({ id: productions.id });
      if (rows.length === 0) {
        throw new HTTPException(404, { message: "Faktur tidak ditemukan" });
      }
      return c.json({ ok: true, jumlah_baris: rows.length });
    });
}

export const produksiRoutes = buatRuteTambahStok("produksi");
export const pembelianRoutes = buatRuteTambahStok("beli");

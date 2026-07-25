import { randomUUID } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type {
  KonfirmasiStatus,
  TransferStokFaktur,
  TransferStokItemRow,
  TransferStokSaldoRow,
} from "@kakarut/shared";
import { db } from "../../db/client";
import {
  branches,
  companies,
  dokumenNomor,
  ingredients,
  productions,
  users,
} from "../../db/schema";
import { tanggalDi } from "../../lib/time";
import {
  requireRole,
  resolveBranchId,
  terikatCabang,
  type AppEnv,
} from "../../middleware/auth";
import { terbitkanNomor } from "../dokumen/nomor";
import { catatLogFaktur } from "../produksi/log";
import { hitungSaldoCabang } from "../stok/service";

const TransferBody = z.object({
  /** cabang ASAL (stok berkurang saat kiriman diterima) */
  asal_branch_id: z.string().uuid(),
  /** cabang TUJUAN (stok bertambah saat diterima di Penerimaan) */
  tujuan_branch_id: z.string().uuid(),
  catatan: z.string().trim().max(300).nullish(),
  items: z
    .array(
      z.object({
        ingredient_id: z.string().uuid(),
        qty: z.number().positive(),
      }),
    )
    .min(1)
    .max(100),
});

const pembuat = alias(users, "pembuat_transfer");
const cabangAsal = alias(branches, "cabang_asal");
const cabangTujuan = alias(branches, "cabang_tujuan");

/**
 * Cabang milik perusahaan yang boleh jadi asal/tujuan transfer: aktif dan
 * BUKAN kantor (kantor tak menyimpan stok).
 */
async function pastikanCabangStok(companyId: string, id: string, peran: "Asal" | "Tujuan") {
  const [b] = await db
    .select({ id: branches.id, nama: branches.nama, tipe: branches.tipe })
    .from(branches)
    .where(and(eq(branches.id, id), eq(branches.companyId, companyId), eq(branches.isActive, true)));
  if (!b) throw new HTTPException(404, { message: `Cabang ${peran.toLowerCase()} tidak ditemukan` });
  if (b.tipe === "kantor") {
    throw new HTTPException(400, {
      message: `${peran} tidak boleh Kantor — kantor tidak menyimpan stok`,
    });
  }
  return b;
}

/** Status agregat satu faktur transfer dari status baris-barisnya. */
function statusFaktur(items: { status: KonfirmasiStatus }[]): KonfirmasiStatus | "sebagian" {
  const set = new Set(items.map((i) => i.status));
  if (set.size === 1) return [...set][0];
  if (set.has("dikonfirmasi") && set.has("ditolak") && !set.has("menunggu")) return "sebagian";
  return "menunggu";
}

/**
 * TRANSFER STOK antar lokasi (CK↔cabang, cabang↔cabang) untuk stok yang SUDAH
 * ADA (ready) — mis. mengirim ulang barang yang rusak di jalan. Satu faktur
 * (nomor TF-) memuat BANYAK bahan baku.
 *
 * Representasi: satu baris `productions` per bahan dengan pola KIRIMAN yang
 * sudah dipakai jalur "kirim hasil"/"kirim dari stok CK" —
 *   branch_id      = cabang TUJUAN  → menambah saldo tujuan saat dikonfirmasi
 *   asal_branch_id = cabang ASAL    → mengurangi saldo asal saat dikonfirmasi
 *   tujuan_branch_id = TUJUAN       → muncul di Penerimaan cabang tujuan
 *   dari_branch_id = ASAL           → faktur tetap terlihat dari cabang asal
 *   status 'menunggu', total_harga 0 (pemindahan stok, bukan biaya baru)
 * Dengan begitu perhitungan saldo (hitungSaldoCabang), Kartu Stok, Penerimaan,
 * dan Tempat Sampah otomatis konsisten tanpa logika saldo baru.
 *
 * BERDAMPINGAN dengan "Kirim dari stok CK" pada Permintaan Stok: yang itu lahir
 * dari rencana menu (rencana_id terisi, nomor PR-), yang ini manual/ad-hoc
 * (rencana_id null, nomor TF-).
 */
export const transferRoutes = new Hono<AppEnv>()
  /** Stok READY di satu cabang (dasar pemilih bahan + validasi qty di form). */
  .get("/saldo", async (c) => {
    const auth = c.get("auth");
    const branchId = await resolveBranchId(c);
    const saldo = await hitungSaldoCabang(auth.company_id!, branchId);
    const ids = saldo.filter((r) => r.saldo > 0).map((r) => r.ingredient_id);
    if (ids.length === 0) return c.json({ branch_id: branchId, rows: [] });
    const master = await db
      .select({
        id: ingredients.id,
        pengadaan: ingredients.pengadaan,
        trackStok: ingredients.trackStok,
        isActive: ingredients.isActive,
      })
      .from(ingredients)
      .where(and(eq(ingredients.companyId, auth.company_id!), inArray(ingredients.id, ids)));
    const infoById = new Map(master.map((m) => [m.id, m]));
    const rows: TransferStokSaldoRow[] = saldo
      .filter((r) => {
        const m = infoById.get(r.ingredient_id);
        return r.saldo > 0 && m?.trackStok && m?.isActive;
      })
      .map((r) => ({
        ingredient_id: r.ingredient_id,
        nama: r.nama,
        satuan: r.satuan,
        pengadaan: infoById.get(r.ingredient_id)!.pengadaan,
        saldo: r.saldo,
      }));
    return c.json({ branch_id: branchId, rows });
  })
  /** Daftar faktur transfer (terbaru dulu) — dikelompokkan per faktur. */
  .get("/", async (c) => {
    const auth = c.get("auth");
    const perPage = Math.min(200, Math.max(1, Number(c.req.query("per_page") ?? "50") || 50));
    // Peran terkunci cabang hanya melihat transfer yang menyangkut cabangnya
    // (sebagai pengirim ATAU penerima); manajemen melihat semuanya.
    const kunci =
      terikatCabang(auth.role) && auth.branch_id
        ? [
            sql`(${productions.asalBranchId} = ${auth.branch_id} OR ${productions.branchId} = ${auth.branch_id})`,
          ]
        : [];
    const rows = await db
      .select({
        id: productions.id,
        faktur_id: productions.fakturId,
        nomor: dokumenNomor.nomorTeks,
        waktu: productions.waktu,
        prod_date: productions.prodDate,
        ingredient_id: productions.ingredientId,
        nama: ingredients.nama,
        satuan: ingredients.satuan,
        pengadaan: ingredients.pengadaan,
        qty: productions.qty,
        status: productions.status,
        alasan_tolak: productions.alasanTolak,
        catatan: productions.catatan,
        asal_branch_id: productions.asalBranchId,
        asal_cabang: cabangAsal.nama,
        tujuan_branch_id: productions.tujuanBranchId,
        tujuan_cabang: cabangTujuan.nama,
        dibuat_oleh: pembuat.nama,
      })
      .from(productions)
      // hanya faktur bernomor TRANSFER — pembeda tegas dari kiriman jalur lain
      .innerJoin(
        dokumenNomor,
        and(
          eq(dokumenNomor.companyId, productions.companyId),
          eq(dokumenNomor.refId, productions.fakturId),
          eq(dokumenNomor.jenis, "transfer"),
        ),
      )
      .innerJoin(ingredients, eq(productions.ingredientId, ingredients.id))
      .leftJoin(cabangAsal, eq(productions.asalBranchId, cabangAsal.id))
      .leftJoin(cabangTujuan, eq(productions.tujuanBranchId, cabangTujuan.id))
      .leftJoin(pembuat, eq(productions.userId, pembuat.id))
      .where(
        and(
          eq(productions.companyId, auth.company_id!),
          isNull(productions.deletedAt),
          ...kunci,
        ),
      )
      .orderBy(desc(productions.waktu), asc(productions.id));

    const byFaktur = new Map<string, TransferStokFaktur>();
    for (const r of rows) {
      const key = r.faktur_id ?? r.id;
      let f = byFaktur.get(key);
      if (!f) {
        f = {
          faktur_id: key,
          nomor: r.nomor,
          waktu: r.waktu instanceof Date ? r.waktu.toISOString() : String(r.waktu),
          prod_date: r.prod_date,
          asal_branch_id: r.asal_branch_id,
          asal_cabang: r.asal_cabang,
          tujuan_branch_id: r.tujuan_branch_id,
          tujuan_cabang: r.tujuan_cabang,
          catatan: r.catatan,
          dibuat_oleh: r.dibuat_oleh,
          status: "menunggu",
          items: [],
        };
        byFaktur.set(key, f);
      }
      const item: TransferStokItemRow = {
        id: r.id,
        ingredient_id: r.ingredient_id,
        nama: r.nama,
        satuan: r.satuan,
        pengadaan: r.pengadaan,
        qty: r.qty,
        status: r.status,
        alasan_tolak: r.alasan_tolak,
      };
      f.items.push(item);
    }
    const daftar = [...byFaktur.values()].slice(0, perPage);
    for (const f of daftar) f.status = statusFaktur(f.items);
    return c.json({ rows: daftar });
  })
  /** Buat faktur transfer + langsung KIRIM (menunggu diterima di tujuan). */
  .post("/", zValidator("json", TransferBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    if (body.asal_branch_id === body.tujuan_branch_id) {
      throw new HTTPException(400, { message: "Cabang asal dan tujuan tidak boleh sama" });
    }
    // Peran terkunci cabang hanya boleh mengirim DARI cabangnya sendiri.
    if (terikatCabang(auth.role) && auth.branch_id !== body.asal_branch_id) {
      throw new HTTPException(403, {
        message: "Hanya boleh transfer dari cabang Anda sendiri",
      });
    }
    const asal = await pastikanCabangStok(auth.company_id!, body.asal_branch_id, "Asal");
    const tujuan = await pastikanCabangStok(auth.company_id!, body.tujuan_branch_id, "Tujuan");

    // Gabungkan baris bahan yang sama (qty dijumlah) → satu baris per bahan.
    const qtyByIng = new Map<string, number>();
    for (const it of body.items) {
      qtyByIng.set(it.ingredient_id, (qtyByIng.get(it.ingredient_id) ?? 0) + it.qty);
    }
    const ingIds = [...qtyByIng.keys()];
    const bahan = await db
      .select({
        id: ingredients.id,
        nama: ingredients.nama,
        satuan: ingredients.satuan,
        trackStok: ingredients.trackStok,
      })
      .from(ingredients)
      .where(
        and(
          eq(ingredients.companyId, auth.company_id!),
          eq(ingredients.isActive, true),
          inArray(ingredients.id, ingIds),
        ),
      );
    if (bahan.length !== ingIds.length) {
      throw new HTTPException(400, { message: "Ada bahan yang tidak valid atau tidak aktif" });
    }
    const takLacak = bahan.find((b) => !b.trackStok);
    if (takLacak) {
      throw new HTTPException(400, {
        message: `"${takLacak.nama}" tidak melacak stok — tidak bisa ditransfer`,
      });
    }

    const [company] = await db
      .select({ timezone: companies.timezone })
      .from(companies)
      .where(eq(companies.id, auth.company_id!));
    const prodDate = tanggalDi(company?.timezone ?? "Asia/Jakarta");
    const fakturId = randomUUID();

    const hasil = await db.transaction(async (tx) => {
      // Saldo asal dicek DI DALAM transaksi (saldo diturunkan dari ledger, tak
      // bisa dikunci baris) → jendela balapan sekecil mungkin; transfer paralel
      // yang melebihi stok akan gagal di pemeriksaan ini.
      const saldoAsal = new Map(
        (await hitungSaldoCabang(auth.company_id!, asal.id)).map((r) => [r.ingredient_id, r]),
      );
      for (const [ingId, qty] of qtyByIng) {
        const s = saldoAsal.get(ingId);
        const nama = bahan.find((b) => b.id === ingId)?.nama ?? "bahan";
        if (!s || qty > s.saldo + 1e-9) {
          throw new HTTPException(400, {
            message: `Stok ${asal.nama} tidak cukup untuk ${nama} (saldo ${s?.saldo ?? 0} ${s?.satuan ?? ""}) — kurangi jumlah transfer`,
          });
        }
      }
      await tx.insert(productions).values(
        [...qtyByIng.entries()].map(([ingredientId, qty]) => ({
          companyId: auth.company_id!,
          // tujuan = pemilik baris (stok masuk saat diterima)
          branchId: tujuan.id,
          asalBranchId: asal.id,
          dariBranchId: asal.id,
          tujuanBranchId: tujuan.id,
          ingredientId,
          qty,
          tipe: "produksi" as const,
          totalHarga: 0, // pemindahan stok yang sudah ada — tanpa biaya baru
          fakturId,
          rencanaId: null,
          noFaktur: null,
          supplierId: null,
          // rak simpan diisi otomatis (rak default bahan) saat diterima
          storageLocationId: null,
          status: "menunggu" as const,
          isBatch: false,
          catatan: body.catatan?.trim() || null,
          userId: auth.sub,
          workerId: null,
          prodDate,
        })),
      );
      const nomor = await terbitkanNomor(tx, auth.company_id!, "transfer", fakturId);
      const ringkas = [...qtyByIng.entries()]
        .map(([id, q]) => `${bahan.find((b) => b.id === id)?.nama ?? "?"} ${q}`)
        .join(", ");
      await catatLogFaktur(tx, {
        companyId: auth.company_id!,
        branchId: asal.id,
        fakturId,
        jalur: "produksi",
        aksi: "Transfer stok",
        detail: `${asal.nama} → ${tujuan.nama} · ${ringkas}`,
        userId: auth.sub,
      });
      return { nomor };
    });

    return c.json(
      {
        ok: true,
        faktur_id: fakturId,
        nomor: hasil.nomor,
        asal: asal.nama,
        tujuan: tujuan.nama,
        jumlah_baris: ingIds.length,
      },
      201,
    );
  })
  /**
   * BATALKAN transfer yang belum diterima (salah kirim) → baris masuk Tempat
   * Sampah. Hanya boleh oleh pihak PENGIRIM (atau manajemen), dan hanya selagi
   * semua barisnya masih 'menunggu' — yang sudah diterima/ditolak tak diusik.
   */
  .post("/:fakturId/batal", async (c) => {
    const auth = c.get("auth");
    const fakturId = c.req.param("fakturId");
    if (!/^[0-9a-f-]{36}$/i.test(fakturId)) {
      throw new HTTPException(404, { message: "Transfer tidak ditemukan" });
    }
    const baris = await db
      .select({
        id: productions.id,
        status: productions.status,
        asalBranchId: productions.asalBranchId,
      })
      .from(productions)
      .innerJoin(
        dokumenNomor,
        and(
          eq(dokumenNomor.companyId, productions.companyId),
          eq(dokumenNomor.refId, productions.fakturId),
          eq(dokumenNomor.jenis, "transfer"),
        ),
      )
      .where(
        and(
          eq(productions.companyId, auth.company_id!),
          eq(productions.fakturId, fakturId),
          isNull(productions.deletedAt),
        ),
      );
    if (baris.length === 0) throw new HTTPException(404, { message: "Transfer tidak ditemukan" });
    if (terikatCabang(auth.role) && auth.branch_id !== baris[0].asalBranchId) {
      throw new HTTPException(403, { message: "Hanya pengirim yang boleh membatalkan transfer" });
    }
    if (baris.some((b) => b.status !== "menunggu")) {
      throw new HTTPException(409, {
        message: "Transfer sudah diproses di cabang tujuan — tidak bisa dibatalkan",
      });
    }
    const now = new Date();
    const hapus = await db
      .update(productions)
      .set({ deletedAt: now, deletedBy: auth.sub })
      .where(
        and(
          eq(productions.companyId, auth.company_id!),
          eq(productions.fakturId, fakturId),
          eq(productions.status, "menunggu"),
          isNull(productions.deletedAt),
        ),
      )
      .returning({ id: productions.id });
    if (hapus.length === 0) {
      throw new HTTPException(409, { message: "Transfer sudah berubah — muat ulang lalu coba lagi" });
    }
    return c.json({ ok: true, jumlah_baris: hapus.length });
  });

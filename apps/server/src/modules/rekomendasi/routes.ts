import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { AcuanJenis, KonfirmasiStatus, PermintaanStokRow } from "@kakarut/shared";
import { db } from "../../db/client";
import { branches, companies, productions, users } from "../../db/schema";
import { resolveBranchId, type AppEnv } from "../../middleware/auth";
import { buatFakturDariRencana, rencanaDariMenu } from "./rencana";
import { rekomendasiBeli } from "./service";

const RencanaBody = z.object({
  items: z
    .array(
      z.object({
        menu_id: z.string().uuid(),
        // batas atas wajar agar qty/harga faktur tak melampaui kapasitas kolom numeric
        porsi: z.number().int().positive().max(100_000),
      }),
    )
    .min(1),
  /** CK pelaksana (opsional) — kekurangan bahan mentah resep dihitung di sini */
  ck_branch_id: z.string().uuid().nullish(),
});

const RencanaFakturBody = RencanaBody.extend({
  worker_id: z.string().uuid().nullish(),
  /** pelaksana produksi alternatif (bila bukan karyawan) */
  supplier_id: z.string().uuid().nullish(),
  /** pemasok barang faktur beli (terpisah dari pelaksana produksi) */
  supplier_beli_id: z.string().uuid().nullish(),
  /** work-order: cabang tujuan (store) yang butuh stok */
  tujuan_branch_id: z.string().uuid().nullish(),
  /** work-order: Central Kitchen pelaksana (auto dari pemasok store bila kosong) */
  ck_branch_id: z.string().uuid().nullish(),
  catatan: z.string().nullish(),
});

/**
 * Rekomendasi pembelian bahan baku dari target penjualan. Owner/admin (gerbang
 * peran dipasang di app.ts).
 */
export const rekomendasiRoutes = new Hono<AppEnv>().get("/beli", async (c) => {
  const auth = c.get("auth");
  const branchId = await resolveBranchId(c);

  const [company] = await db
    .select({ timezone: companies.timezone, target: companies.targetPenjualan })
    .from(companies)
    .where(eq(companies.id, auth.company_id!));
  const tz = company?.timezone ?? "Asia/Jakarta";

  const qTarget = c.req.query("target");
  const targetRaw = qTarget != null && qTarget !== "" ? Number(qTarget) : (company?.target ?? 0);
  const target = Number.isFinite(targetRaw) && targetRaw > 0 ? targetRaw : 0;

  const acuanQ = c.req.query("acuan");
  const acuan: AcuanJenis =
    acuanQ === "7hari" ? "7hari" : acuanQ === "rentang" ? "rentang" : "minggu_lalu";

  // terima hanya format tanggal YYYY-MM-DD; selain itu diabaikan (default hari ini)
  const tgl = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);

  const hasil = await rekomendasiBeli(auth.company_id!, branchId, tz, {
    target,
    acuan,
    dari: c.req.query("dari") ?? undefined,
    sampai: c.req.query("sampai") ?? undefined,
    pakaiDari: tgl(c.req.query("pakai_dari")),
    pakaiSampai: tgl(c.req.query("pakai_sampai")),
  });
  return c.json(hasil);
})
  // Preview rencana dari menu: target porsi per menu → kebutuhan/kurang bahan
  .post("/menu", zValidator("json", RencanaBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const branchId = await resolveBranchId(c);
    const preview = await rencanaDariMenu(
      auth.company_id!,
      branchId,
      body.items,
      body.ck_branch_id,
    );
    return c.json(preview);
  })
  // Permintaan tambah stok: terbitkan faktur produksi (work-order CK) + beli
  // otomatis untuk kekurangan rencana di cabang tujuan (store).
  .post("/menu/faktur", zValidator("json", RencanaFakturBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    // cabang tujuan = store yang butuh stok (default cabang aktif)
    const branchId = body.tujuan_branch_id ?? (await resolveBranchId(c));
    const hasil = await buatFakturDariRencana({
      companyId: auth.company_id!,
      branchId,
      ckBranchId: body.ck_branch_id,
      userId: auth.sub,
      items: body.items,
      workerId: body.worker_id,
      supplierId: body.supplier_id,
      supplierBeliId: body.supplier_beli_id,
      catatan: body.catatan,
    });
    return c.json(hasil, 201);
  })
  // Data Permintaan Stok: daftar permintaan "Tambah Stok dari Menu" — faktur
  // produksi + beli satu submit digabung lewat rencana_id. Company-scoped
  // (owner/admin dari Kantor).
  .get("/permintaan", async (c) => {
    const auth = c.get("auth");
    const tujuanB = alias(branches, "tujuan_permintaan");
    const pembuatU = alias(users, "pembuat_permintaan");
    const rows = await db
      .select({
        rencanaId: productions.rencanaId,
        fakturId: productions.fakturId,
        ingredientId: productions.ingredientId,
        tipe: productions.tipe,
        bahanProduksi: productions.bahanProduksi,
        asalBranchId: productions.asalBranchId,
        status: productions.status,
        totalHarga: productions.totalHarga,
        catatan: productions.catatan,
        waktu: productions.waktu,
        tujuanNama: tujuanB.nama,
        pembuat: pembuatU.nama,
      })
      .from(productions)
      .leftJoin(tujuanB, eq(productions.tujuanBranchId, tujuanB.id))
      .leftJoin(pembuatU, eq(productions.userId, pembuatU.id))
      .where(
        and(
          eq(productions.companyId, auth.company_id!),
          isNotNull(productions.rencanaId),
          isNull(productions.deletedAt),
        ),
      )
      .orderBy(desc(productions.waktu));

    // status representatif faktur = tahap PALING AWAL di antara barisnya (bila
    // sebagian sudah maju & sebagian belum, tampilkan yang paling tertinggal).
    const RANK: Record<string, number> = {
      rencana: 0,
      dikerjakan: 1,
      menunggu: 2,
      ditolak: 3,
      dikonfirmasi: 4,
    };
    // jumlah_baris = bahan UNIK (bukan jumlah baris) — satu bahan bisa terpecah
    // jadi beberapa baris saat tahap sebagian.
    type Akum = PermintaanStokRow & {
      _rankProd: number;
      _rankBeli: number;
      _rankBeliProd: number;
      _rankKirim: number;
      _ingProd: Set<string>;
      _ingBeli: Set<string>;
      _ingBeliProd: Set<string>;
      _ingKirim: Set<string>;
    };
    const map = new Map<string, Akum>();
    for (const r of rows) {
      const id = r.rencanaId!;
      let g = map.get(id);
      if (!g) {
        g = {
          rencana_id: id,
          waktu: (r.waktu as Date).toISOString(),
          catatan: r.catatan,
          tujuan_cabang: null,
          pembuat: r.pembuat,
          produksi: null,
          beli: null,
          beli_produksi: null,
          kirim: null,
          _rankProd: Infinity,
          _rankBeli: Infinity,
          _rankBeliProd: Infinity,
          _rankKirim: Infinity,
          _ingProd: new Set(),
          _ingBeli: new Set(),
          _ingBeliProd: new Set(),
          _ingKirim: new Set(),
        };
        map.set(id, g);
      }
      if (r.tujuanNama && !g.tujuan_cabang) g.tujuan_cabang = r.tujuanNama;
      const rank = RANK[r.status] ?? 99;
      const st = r.status as KonfirmasiStatus;
      if (r.asalBranchId) {
        // KIRIM DARI STOK CK (transfer) — bagian tersendiri (bukan produksi baru)
        if (!g.kirim) g.kirim = { faktur_id: r.fakturId!, jumlah_baris: 0, status: st, total: 0 };
        g._ingKirim.add(r.ingredientId);
        g.kirim.jumlah_baris = g._ingKirim.size;
        g.kirim.total += Number(r.totalHarga ?? 0);
        if (rank < g._rankKirim) {
          g._rankKirim = rank;
          g.kirim.status = st;
        }
      } else if (r.tipe === "produksi") {
        if (!g.produksi)
          g.produksi = { faktur_id: r.fakturId!, jumlah_baris: 0, status: st, total: 0 };
        g._ingProd.add(r.ingredientId);
        g.produksi.jumlah_baris = g._ingProd.size;
        g.produksi.total += Number(r.totalHarga ?? 0);
        if (rank < g._rankProd) {
          g._rankProd = rank;
          g.produksi.status = st;
        }
      } else if (r.bahanProduksi) {
        // belanja bahan mentah utk produksi (dari resep) — bagian terpisah
        if (!g.beli_produksi)
          g.beli_produksi = { faktur_id: r.fakturId!, jumlah_baris: 0, status: st, total: 0 };
        g._ingBeliProd.add(r.ingredientId);
        g.beli_produksi.jumlah_baris = g._ingBeliProd.size;
        g.beli_produksi.total += Number(r.totalHarga ?? 0);
        if (rank < g._rankBeliProd) {
          g._rankBeliProd = rank;
          g.beli_produksi.status = st;
        }
      } else {
        if (!g.beli) g.beli = { faktur_id: r.fakturId!, jumlah_baris: 0, status: st, total: 0 };
        g._ingBeli.add(r.ingredientId);
        g.beli.jumlah_baris = g._ingBeli.size;
        g.beli.total += Number(r.totalHarga ?? 0);
        if (rank < g._rankBeli) {
          g._rankBeli = rank;
          g.beli.status = st;
        }
      }
    }
    const hasil: PermintaanStokRow[] = [...map.values()].map(
      ({
        _rankProd,
        _rankBeli,
        _rankBeliProd,
        _rankKirim,
        _ingProd,
        _ingBeli,
        _ingBeliProd,
        _ingKirim,
        ...rest
      }) => rest,
    );
    return c.json(hasil);
  })
  /**
   * Hapus satu permintaan → Tempat Sampah: SOFT-DELETE semua faktur (produksi +
   * beli + bahan produksi) yang berbagi rencana_id. Stok yang belum
   * dikonfirmasi otomatis batal (semua agregasi memfilter deleted_at IS NULL);
   * yang sudah masuk stok ikut dikoreksi. Cukup konfirmasi (tanpa password) —
   * tiap faktur bisa dipulihkan dari Tempat Sampah.
   */
  .delete("/permintaan/:rencanaId", async (c) => {
    const auth = c.get("auth");
    const rencanaId = c.req.param("rencanaId");
    if (!/^[0-9a-f-]{36}$/i.test(rencanaId)) {
      throw new HTTPException(404, { message: "Permintaan tidak ditemukan" });
    }
    const rows = await db
      .update(productions)
      .set({ deletedAt: new Date(), deletedBy: auth.sub })
      .where(
        and(
          eq(productions.companyId, auth.company_id!),
          eq(productions.rencanaId, rencanaId),
          isNull(productions.deletedAt),
        ),
      )
      .returning({ id: productions.id });
    if (rows.length === 0) {
      throw new HTTPException(404, { message: "Permintaan tidak ditemukan" });
    }
    return c.json({ ok: true, jumlah_baris: rows.length });
  });

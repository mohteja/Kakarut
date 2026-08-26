import { tanggalQuery } from "../../lib/tanggal-query";
import { zValidator } from "../../lib/validator";
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type {
  AcuanJenis,
  KonfirmasiStatus,
  PermintaanStokBagian,
  PermintaanStokBagianPerlengkapan,
  PermintaanStokRow,
} from "@kakarut/shared";
import { db } from "../../db/client";
import {
  branches,
  companies,
  productions,
  supplies,
  supplyPurchases,
  users,
} from "../../db/schema";
import { resolveBranchId, type AppEnv } from "../../middleware/auth";
import { nomorUntukRefs } from "../dokumen/nomor";
import {
  clientRefField,
  denganKlaimIdempoten,
  deviceIdField,
} from "../sync/idempoten";
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
    .min(1)
    .max(500),
  /** CK pelaksana (opsional) — kekurangan bahan mentah resep dihitung di sini */
  ck_branch_id: z.string().uuid().nullish(),
}).strict();

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
  client_ref: clientRefField,
  device_id: deviceIdField,
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
  // Regex-saja dihapus: `2026-02-30` lolos bentuknya lalu ditolak Postgres.
  const tgl = (nama: string) => tanggalQuery(c, nama);

  const hasil = await rekomendasiBeli(auth.company_id!, branchId, tz, {
    target,
    acuan,
    // Lewat `tgl` seperti sepasangnya di bawah. Keduanya sempat mentah padahal
    // penyaringnya sudah berdiri dua baris di atas — dan dari sini nilainya
    // mendarat di `gte(sales.saleDate, ...)`, pembanding kolom `date`. Yang
    // salah ketik tak ditolak rapi, ia menjatuhkan permintaannya.
    dari: tgl("dari"),
    sampai: tgl("sampai"),
    pakaiDari: tgl("pakai_dari"),
    pakaiSampai: tgl("pakai_sampai"),
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
    // Kiriman ulang TIDAK boleh menerbitkan satu set faktur lagi.
    //
    // Halaman "Tambah Stok dari Menu" mengirim DUA permintaan berurutan: faktur
    // bahan baku di sini, lalu permintaan perlengkapan yang menautkan diri ke
    // `rencana_id` hasil panggilan ini. Kalau yang KEDUA gagal, yang pertama
    // sudah terlanjur menerbitkan faktur produksi + beli — dan tombolnya
    // memantulkan galat seolah tak ada apa pun yang terjadi. Orang menekannya
    // lagi, dan gudang menerima DUA work-order untuk satu kebutuhan.
    //
    // Kuncinya dipegang klien sampai SUKSES, jadi percobaan kedua memutar ulang
    // hasil yang sama — termasuk `rencana_id`-nya, sehingga permintaan
    // perlengkapan tetap menaut ke rencana yang benar.
    const { data } = await denganKlaimIdempoten(
      {
        companyId: auth.company_id!,
        clientRef: body.client_ref,
        userId: auth.sub,
        deviceId: body.device_id ?? null,
        tipe: "rencana_faktur",
      },
      async () => {
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
        return hasil;
      },
    );
    return c.json(data, 201);
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
        untukBranchId: productions.untukBranchId,
        dariBranchId: productions.dariBranchId,
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
    // Bucket produksi PER FAKTUR: satu submit bisa punya DUA faktur produksi —
    // work-order CK (baris ber-untuk/dari CK) dan produksi DI CABANG (bahan
    // ber-produksi_di "cabang"; lokal murni tanpa untuk/tujuan).
    type BucketProd = {
      faktur_id: string;
      ings: Set<string>;
      total: number;
      rank: number;
      status: KonfirmasiStatus;
      /** pernah ber-untuk/dari → faktur work-order CK (bukan produksi cabang) */
      sisiCk: boolean;
    };
    type Akum = PermintaanStokRow & {
      _rankBeli: number;
      _rankBeliProd: number;
      _rankKirim: number;
      _prod: Map<string, BucketProd>;
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
          nomor: null,
          waktu: (r.waktu as Date).toISOString(),
          catatan: r.catatan,
          tujuan_cabang: null,
          pembuat: r.pembuat,
          produksi: null,
          produksi_cabang: null,
          beli: null,
          beli_produksi: null,
          kirim: null,
          beli_perlengkapan: null,
          _rankBeli: Infinity,
          _rankBeliProd: Infinity,
          _rankKirim: Infinity,
          _prod: new Map(),
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
        let b = g._prod.get(r.fakturId!);
        if (!b) {
          b = { faktur_id: r.fakturId!, ings: new Set(), total: 0, rank: Infinity, status: st, sisiCk: false };
          g._prod.set(r.fakturId!, b);
        }
        b.ings.add(r.ingredientId);
        b.total += Number(r.totalHarga ?? 0);
        if (r.untukBranchId || r.dariBranchId) b.sisiCk = true;
        if (rank < b.rank) {
          b.rank = rank;
          b.status = st;
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
      ({ _rankBeli, _rankBeliProd, _rankKirim, _prod, _ingBeli, _ingBeliProd, _ingKirim, ...rest }) => {
        // Petakan bucket produksi → bagian: faktur ber-sisiCk (untuk/dari CK) =
        // `produksi` (work-order CK); faktur lokal lainnya = `produksi_cabang`
        // bila submit punya keduanya, atau `produksi` bila hanya satu (perilaku
        // lama utk produksi di tempat / lite).
        const buckets = [...(_prod as Map<string, BucketProd>).values()];
        const keBagian = (b: BucketProd): PermintaanStokBagian => ({
          faktur_id: b.faktur_id,
          jumlah_baris: b.ings.size,
          status: b.status,
          total: b.total,
        });
        if (buckets.length === 1) {
          rest.produksi = keBagian(buckets[0]);
        } else if (buckets.length > 1) {
          const ckSisi = buckets.find((b) => b.sisiCk) ?? buckets[0];
          const lokal = buckets.find((b) => b !== ckSisi)!;
          rest.produksi = keBagian(ckSisi);
          rest.produksi_cabang = keBagian(lokal);
        }
        return rest;
      },
    );
    // Nomor dokumen permintaan (PM-xxxx) — identitas tampil tiap entri.
    const rencanaIds = [...map.keys()];
    const petaNomor = await nomorUntukRefs(db, auth.company_id!, rencanaIds);
    for (const h of hasil) h.nomor = petaNomor.get(h.rencana_id) ?? null;
    // FAKTUR BELI PERLENGKAPAN (BP-) yang lahir bersama permintaan: supply
    // purchases ber-rencana_id sama — bagian tersendiri di tiap entri.
    if (rencanaIds.length > 0) {
      const supRows = await db
        .select({
          rencanaId: supplyPurchases.rencanaId,
          fakturId: supplyPurchases.fakturId,
          id: supplyPurchases.id,
          status: supplyPurchases.status,
          qty: supplyPurchases.qty,
          totalHarga: supplyPurchases.totalHarga,
          hargaBeli: supplies.hargaBeli,
        })
        .from(supplyPurchases)
        .innerJoin(supplies, eq(supplyPurchases.supplyId, supplies.id))
        .where(
          and(
            eq(supplyPurchases.companyId, auth.company_id!),
            inArray(supplyPurchases.rencanaId, rencanaIds),
          ),
        );
      const perRencana = new Map<
        string,
        { faktur_id: string; jumlah: number; total: number; status: Set<string> }
      >();
      for (const s of supRows) {
        const key = s.rencanaId!;
        let agg = perRencana.get(key);
        if (!agg) {
          agg = { faktur_id: s.fakturId ?? s.id, jumlah: 0, total: 0, status: new Set() };
          perRencana.set(key, agg);
        }
        agg.jumlah += 1;
        // total: harga riil bila sudah diisi, selain itu estimasi qty × harga
        // beli; baris batal tak menambah biaya (barang tidak jadi dibeli)
        if (s.status !== "batal") agg.total += s.totalHarga ?? s.qty * (s.hargaBeli ?? 0);
        agg.status.add(s.status);
      }
      const byRencana = new Map(hasil.map((h) => [h.rencana_id, h]));
      for (const [rencanaId, agg] of perRencana) {
        const h = byRencana.get(rencanaId);
        if (!h) continue;
        // tahap PALING TERTINGGAL menang: menunggu > diproses; sisanya
        // campuran tiba+batal → "sebagian"
        const status: PermintaanStokBagianPerlengkapan["status"] = agg.status.has("menunggu")
          ? "menunggu"
          : agg.status.has("diproses")
            ? "diproses"
            : agg.status.size > 1
              ? "sebagian"
              : agg.status.has("tiba")
                ? "tiba"
                : "batal";
        h.beli_perlengkapan = {
          faktur_id: agg.faktur_id,
          jumlah_baris: agg.jumlah,
          status,
          total: Math.round(agg.total),
        };
      }
    }
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
    // faktur beli PERLENGKAPAN yang lahir bersama permintaan ini: baris yang
    // masih 'menunggu' ikut dibatalkan (yang sudah tiba tidak disentuh)
    await db
      .update(supplyPurchases)
      .set({ status: "batal", updatedAt: new Date() })
      .where(
        and(
          eq(supplyPurchases.companyId, auth.company_id!),
          eq(supplyPurchases.rencanaId, rencanaId),
          eq(supplyPurchases.status, "menunggu"),
        ),
      );
    return c.json({ ok: true, jumlah_baris: rows.length });
  });

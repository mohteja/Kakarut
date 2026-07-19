/**
 * Perlengkapan non bahan baku (sendok, spons, sabun, dll): modul mandiri —
 * item TIDAK pernah masuk resep/HPP/rencana. Stok per cabang dari ledger
 * mutasi; konsumsi manual ("pakai") + otomatis (aturan harian per cabang).
 * Semua peran boleh lihat & mencatat pemakaian (kasir/tim terkunci cabang);
 * owner/admin mengelola item, stok masuk, koreksi, aturan, dan belanja.
 */
import { zValidator } from "@hono/zod-validator";
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { db } from "../../db/client";
import { supplies, supplyMutations, supplyRules } from "../../db/schema";
import { requireRole, resolveBranchId, type AppEnv } from "../../middleware/auth";
import { terbitkanNomor } from "../dokumen/nomor";
import {
  belanjaPerlengkapan,
  buatKirimanPerlengkapan,
  buatOpnamePerlengkapan,
  daftarKirimanPerlengkapan,
  detailOpnamePerlengkapan,
  kartuPerlengkapan,
  muatSupplyAktif,
  riwayatOpnamePerlengkapan,
  saldoPerlengkapan,
  saldoSatuPerlengkapan,
  setStatusOpnamePerlengkapan,
  tanggalPerusahaan,
  terapkanKonsumsiOtomatis,
  terimaKirimanPerlengkapan,
} from "./service";

const TANGGAL_RE = /^\d{4}-\d{2}-\d{2}$/;

const ItemBody = z.object({
  nama: z.string().trim().min(1).max(60),
  satuan: z.string().trim().min(1).max(20).default("pcs"),
  harga_beli: z.number().min(0).default(0),
  stok_minimum: z.number().min(0).default(0),
  catatan: z.string().max(300).nullish(),
});

// PATCH parsial tanpa .default() — lihat catatan BahanPatchBody (zod v4).
const ItemPatchBody = z.object({
  nama: z.string().trim().min(1).max(60).optional(),
  satuan: z.string().trim().min(1).max(20).optional(),
  harga_beli: z.number().min(0).optional(),
  stok_minimum: z.number().min(0).optional(),
  catatan: z.string().max(300).nullish(),
  is_active: z.boolean().optional(),
});

const MasukBody = z.object({
  qty: z.number().positive(),
  total_harga: z.number().min(0).nullish(),
  catatan: z.string().max(300).nullish(),
  tanggal: z.string().regex(TANGGAL_RE).optional(),
});

const PakaiBody = z.object({
  qty: z.number().positive(),
  catatan: z.string().max(300).nullish(),
});

const KoreksiBody = z.object({
  qty_fisik: z.number().min(0),
  catatan: z.string().max(300).nullish(),
});

const AturanBody = z.object({
  qty: z.number().positive(),
  per_hari: z.number().int().min(1).max(365).default(1),
  aktif: z.boolean().default(true),
  mulai: z.string().regex(TANGGAL_RE).optional(),
});

const OpnameBody = z.object({
  items: z
    .array(z.object({ supply_id: z.string().uuid(), qty_fisik: z.number().min(0) }))
    .min(1),
  catatan: z.string().max(300).nullish(),
});

const StokAwalBody = z.object({
  items: z
    .array(z.object({ supply_id: z.string().uuid(), qty: z.number().min(0) }))
    .min(1),
});

const MintaBody = z.object({
  qty: z.number().positive(),
  catatan: z.string().max(300).nullish(),
});

export const perlengkapanRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const auth = c.get("auth");
    const branchId = await resolveBranchId(c);
    await terapkanKonsumsiOtomatis(auth.company_id!, branchId);
    return c.json(await saldoPerlengkapan(auth.company_id!, branchId));
  })
  // Ringkasan belanja perlengkapan per rentang tanggal (default bulan berjalan).
  // Didefinisikan SEBELUM rute :id agar "belanja" tak tertangkap sebagai id.
  .get("/belanja", requireRole("owner", "admin"), async (c) => {
    const auth = c.get("auth");
    const branchId = await resolveBranchId(c);
    const hariIni = await tanggalPerusahaan(auth.company_id!);
    const dari =
      c.req.query("dari") && TANGGAL_RE.test(c.req.query("dari")!)
        ? c.req.query("dari")!
        : `${hariIni.slice(0, 8)}01`;
    const sampai =
      c.req.query("sampai") && TANGGAL_RE.test(c.req.query("sampai")!)
        ? c.req.query("sampai")!
        : hariIni;
    return c.json(
      await belanjaPerlengkapan({ companyId: auth.company_id!, branchId, dari, sampai }),
    );
  })
  // Stok awal perlengkapan (dipakai dari halaman Stok, seperti /stok/awal
  // bahan baku): set saldo pembuka per item — selisih terhadap saldo berjalan
  // dibukukan sebagai mutasi koreksi "Stok awal" dan langsung efektif.
  .post(
    "/stok-awal",
    requireRole("owner", "admin"),
    zValidator("json", StokAwalBody),
    async (c) => {
      const auth = c.get("auth");
      const body = c.req.valid("json");
      const branchId = await resolveBranchId(c);
      await terapkanKonsumsiOtomatis(auth.company_id!, branchId);
      // dedupe: item yang sama dua kali → input terakhir yang berlaku
      const target = new Map(body.items.map((it) => [it.supply_id, it.qty]));
      // validasi seluruh item dulu supaya kegagalan tidak menyisakan tulisan sebagian
      for (const supplyId of target.keys()) {
        const item = await muatSupplyAktif(auth.company_id!, supplyId);
        if (!item) throw new HTTPException(404, { message: "Perlengkapan tidak ditemukan" });
      }
      const tanggal = await tanggalPerusahaan(auth.company_id!);
      let diubah = 0;
      await db.transaction(async (tx) => {
        for (const [supplyId, qty] of target) {
          const saldo = await saldoSatuPerlengkapan(supplyId, branchId);
          const selisih = qty - saldo;
          if (selisih === 0) continue;
          await tx.insert(supplyMutations).values({
            companyId: auth.company_id!,
            branchId,
            supplyId,
            tipe: "koreksi",
            qty: selisih,
            tanggal,
            catatan: "Stok awal",
            userId: auth.sub,
          });
          diubah++;
        }
      });
      return c.json({ ok: true, jumlah: target.size, diubah });
    },
  )
  /* ===== STOCK OPNAME PERLENGKAPAN: sesi hitung fisik + ACC owner/admin ===== */
  .post("/opname", zValidator("json", OpnameBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const branchId = await resolveBranchId(c);
    // jatah otomatis dipotong dulu agar saldo sistem yang dibandingkan jujur
    await terapkanKonsumsiOtomatis(auth.company_id!, branchId);
    const hasil = await buatOpnamePerlengkapan({
      companyId: auth.company_id!,
      branchId,
      userId: auth.sub,
      items: body.items,
      catatan: body.catatan ?? null,
    });
    // semua sesuai sistem → tanpa sesi (tak ada yang perlu di-ACC)
    if (!hasil) return c.json({ session_id: null, nomor: null, jumlah_selisih: 0 });
    return c.json(hasil, 201);
  })
  .get("/opname/riwayat", async (c) => {
    const auth = c.get("auth");
    const branchId = await resolveBranchId(c);
    return c.json(await riwayatOpnamePerlengkapan(auth.company_id!, branchId));
  })
  .get("/opname/sesi/:sessionId", async (c) => {
    const auth = c.get("auth");
    const detail = await detailOpnamePerlengkapan(auth.company_id!, c.req.param("sessionId"));
    if (!detail) throw new HTTPException(404, { message: "Sesi opname tidak ditemukan" });
    return c.json(detail);
  })
  .post("/opname/sesi/:sessionId/acc", requireRole("owner", "admin"), async (c) => {
    const auth = c.get("auth");
    const n = await setStatusOpnamePerlengkapan(
      auth.company_id!,
      c.req.param("sessionId"),
      "disetujui",
    );
    if (n === 0) {
      throw new HTTPException(404, { message: "Sesi tidak ditemukan / sudah ditinjau" });
    }
    return c.json({ ok: true, jumlah: n });
  })
  .post("/opname/sesi/:sessionId/tolak", requireRole("owner", "admin"), async (c) => {
    const auth = c.get("auth");
    const n = await setStatusOpnamePerlengkapan(
      auth.company_id!,
      c.req.param("sessionId"),
      "ditolak",
    );
    if (n === 0) {
      throw new HTTPException(404, { message: "Sesi tidak ditemukan / sudah ditinjau" });
    }
    return c.json({ ok: true, jumlah: n });
  })
  .delete("/opname/sesi/:sessionId", requireRole("owner", "admin"), async (c) => {
    const auth = c.get("auth");
    const rows = await db
      .delete(supplyMutations)
      .where(
        and(
          eq(supplyMutations.companyId, auth.company_id!),
          eq(supplyMutations.sessionId, c.req.param("sessionId")),
        ),
      )
      .returning({ id: supplyMutations.id });
    if (rows.length === 0) throw new HTTPException(404, { message: "Sesi tidak ditemukan" });
    return c.json({ ok: true, jumlah: rows.length });
  })
  /* ===== KIRIMAN CK → CABANG (permintaan stok ≤ minimum) ===== */
  .get("/kiriman", async (c) => {
    const auth = c.get("auth");
    const branchId = await resolveBranchId(c);
    return c.json(await daftarKirimanPerlengkapan(auth.company_id!, branchId));
  })
  .post("/kiriman/:id/terima", async (c) => {
    const auth = c.get("auth");
    const branchId = await resolveBranchId(c);
    const hasil = await terimaKirimanPerlengkapan({
      companyId: auth.company_id!,
      transferId: c.req.param("id"),
      branchId,
      userId: auth.sub,
    });
    if ("error" in hasil) {
      throw new HTTPException((hasil.code ?? 400) as 400 | 404, { message: hasil.error });
    }
    return c.json(hasil);
  })
  .post("/", requireRole("owner", "admin"), zValidator("json", ItemBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    // Nama sama (case-insensitive): item nonaktif → reaktivasi; aktif → 409.
    const [ada] = await db
      .select()
      .from(supplies)
      .where(
        and(
          eq(supplies.companyId, auth.company_id!),
          sql`lower(${supplies.nama}) = lower(${body.nama})`,
        ),
      );
    if (ada) {
      if (ada.isActive) {
        throw new HTTPException(409, { message: `Perlengkapan "${ada.nama}" sudah ada` });
      }
      const [row] = await db
        .update(supplies)
        .set({
          nama: body.nama,
          satuan: body.satuan,
          hargaBeli: body.harga_beli,
          stokMinimum: body.stok_minimum,
          catatan: body.catatan ?? null,
          isActive: true,
          updatedAt: new Date(),
        })
        .where(eq(supplies.id, ada.id))
        .returning();
      return c.json({ id: row.id, nama: row.nama, dipulihkan: true }, 201);
    }
    const [row] = await db
      .insert(supplies)
      .values({
        companyId: auth.company_id!,
        nama: body.nama,
        satuan: body.satuan,
        hargaBeli: body.harga_beli,
        stokMinimum: body.stok_minimum,
        catatan: body.catatan ?? null,
      })
      .returning();
    return c.json({ id: row.id, nama: row.nama, dipulihkan: false }, 201);
  })
  .patch("/:id", requireRole("owner", "admin"), zValidator("json", ItemPatchBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const [row] = await db
      .update(supplies)
      .set({
        ...(body.nama !== undefined && { nama: body.nama }),
        ...(body.satuan !== undefined && { satuan: body.satuan }),
        ...(body.harga_beli !== undefined && { hargaBeli: body.harga_beli }),
        ...(body.stok_minimum !== undefined && { stokMinimum: body.stok_minimum }),
        ...(body.catatan !== undefined && { catatan: body.catatan }),
        ...(body.is_active !== undefined && { isActive: body.is_active }),
        updatedAt: new Date(),
      })
      .where(and(eq(supplies.id, c.req.param("id")), eq(supplies.companyId, auth.company_id!)))
      .returning();
    if (!row) throw new HTTPException(404, { message: "Perlengkapan tidak ditemukan" });
    return c.json({ ok: true });
  })
  // Soft delete: ledger & riwayat tetap utuh; nama yang sama bisa dibuat ulang
  // (reaktivasi). Aturan konsumsinya otomatis berhenti (join is_active).
  .delete("/:id", requireRole("owner", "admin"), async (c) => {
    const auth = c.get("auth");
    const [row] = await db
      .update(supplies)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(supplies.id, c.req.param("id")), eq(supplies.companyId, auth.company_id!)))
      .returning();
    if (!row) throw new HTTPException(404, { message: "Perlengkapan tidak ditemukan" });
    return c.json({ ok: true });
  })
  .post("/:id/masuk", requireRole("owner", "admin"), zValidator("json", MasukBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const branchId = await resolveBranchId(c);
    const item = await muatSupplyAktif(auth.company_id!, c.req.param("id"));
    if (!item) throw new HTTPException(404, { message: "Perlengkapan tidak ditemukan" });
    // tiap stok masuk = dokumen belanja kecil → bernomor PL- (ref = id mutasi)
    const nomor = await db.transaction(async (tx) => {
      const [mut] = await tx
        .insert(supplyMutations)
        .values({
          companyId: auth.company_id!,
          branchId,
          supplyId: item.id,
          tipe: "masuk",
          qty: body.qty,
          totalHarga: body.total_harga ?? null,
          tanggal: body.tanggal ?? (await tanggalPerusahaan(auth.company_id!)),
          catatan: body.catatan ?? null,
          userId: auth.sub,
        })
        .returning({ id: supplyMutations.id });
      return terbitkanNomor(tx, auth.company_id!, "perlengkapan", mut.id);
    });
    return c.json({ ok: true, nomor, saldo: await saldoSatuPerlengkapan(item.id, branchId) });
  })
  .post("/:id/pakai", zValidator("json", PakaiBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const branchId = await resolveBranchId(c);
    const item = await muatSupplyAktif(auth.company_id!, c.req.param("id"));
    if (!item) throw new HTTPException(404, { message: "Perlengkapan tidak ditemukan" });
    // jatah otomatis hari ini dipotong dulu agar saldo yang divalidasi jujur
    await terapkanKonsumsiOtomatis(auth.company_id!, branchId);
    const saldo = await saldoSatuPerlengkapan(item.id, branchId);
    if (body.qty > saldo) {
      throw new HTTPException(400, {
        message: `Stok tidak cukup (saldo ${saldo} ${item.satuan})`,
      });
    }
    await db.insert(supplyMutations).values({
      companyId: auth.company_id!,
      branchId,
      supplyId: item.id,
      tipe: "pakai",
      qty: -body.qty,
      tanggal: await tanggalPerusahaan(auth.company_id!),
      catatan: body.catatan ?? null,
      userId: auth.sub,
    });
    return c.json({ ok: true, saldo: saldo - body.qty });
  })
  .post(
    "/:id/koreksi",
    requireRole("owner", "admin"),
    zValidator("json", KoreksiBody),
    async (c) => {
      const auth = c.get("auth");
      const body = c.req.valid("json");
      const branchId = await resolveBranchId(c);
      const item = await muatSupplyAktif(auth.company_id!, c.req.param("id"));
      if (!item) throw new HTTPException(404, { message: "Perlengkapan tidak ditemukan" });
      await terapkanKonsumsiOtomatis(auth.company_id!, branchId);
      const saldo = await saldoSatuPerlengkapan(item.id, branchId);
      const selisih = body.qty_fisik - saldo;
      if (selisih !== 0) {
        await db.insert(supplyMutations).values({
          companyId: auth.company_id!,
          branchId,
          supplyId: item.id,
          tipe: "koreksi",
          qty: selisih,
          tanggal: await tanggalPerusahaan(auth.company_id!),
          catatan: body.catatan ?? "Koreksi fisik",
          userId: auth.sub,
        });
      }
      return c.json({ selisih, saldo: body.qty_fisik });
    },
  )
  .put(
    "/:id/aturan",
    requireRole("owner", "admin"),
    zValidator("json", AturanBody),
    async (c) => {
      const auth = c.get("auth");
      const body = c.req.valid("json");
      const branchId = await resolveBranchId(c);
      const item = await muatSupplyAktif(auth.company_id!, c.req.param("id"));
      if (!item) throw new HTTPException(404, { message: "Perlengkapan tidak ditemukan" });
      const mulai = body.mulai ?? (await tanggalPerusahaan(auth.company_id!));
      // Ganti aturan = hitung ulang jadwal dari `mulai` (kursor direset).
      // Hari yang SUDAH tercatat aman — unique index auto per hari menahannya.
      await db
        .insert(supplyRules)
        .values({
          companyId: auth.company_id!,
          branchId,
          supplyId: item.id,
          qty: body.qty,
          perHari: body.per_hari,
          mulai,
          aktif: body.aktif,
          terakhirDiterapkan: null,
        })
        .onConflictDoUpdate({
          target: [supplyRules.branchId, supplyRules.supplyId],
          set: {
            qty: body.qty,
            perHari: body.per_hari,
            mulai,
            aktif: body.aktif,
            terakhirDiterapkan: null,
            updatedAt: new Date(),
          },
        });
      await terapkanKonsumsiOtomatis(auth.company_id!, branchId);
      return c.json({ ok: true, saldo: await saldoSatuPerlengkapan(item.id, branchId) });
    },
  )
  // Cabang minta ke CK (stok ≤ minimum): faktur kiriman KP- terbit bila stok
  // CK cukup; saldo pindah saat cabang menekan Terima.
  .post("/:id/minta", zValidator("json", MintaBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const branchId = await resolveBranchId(c);
    const item = await muatSupplyAktif(auth.company_id!, c.req.param("id"));
    if (!item) throw new HTTPException(404, { message: "Perlengkapan tidak ditemukan" });
    const hasil = await buatKirimanPerlengkapan({
      companyId: auth.company_id!,
      cabangId: branchId,
      supplyId: item.id,
      qty: body.qty,
      userId: auth.sub,
      catatan: body.catatan ?? null,
    });
    if ("error" in hasil) throw new HTTPException(400, { message: hasil.error });
    return c.json({ ok: true, kiriman_id: hasil.id, nomor: hasil.nomor }, 201);
  })
  .get("/:id/kartu", async (c) => {
    const auth = c.get("auth");
    const branchId = await resolveBranchId(c);
    await terapkanKonsumsiOtomatis(auth.company_id!, branchId);
    const hariIni = await tanggalPerusahaan(auth.company_id!);
    const q = (nama: string) =>
      c.req.query(nama) && TANGGAL_RE.test(c.req.query(nama)!) ? c.req.query(nama)! : null;
    const sampai = q("sampai") ?? hariIni;
    const dari =
      q("dari") ??
      new Date(new Date(`${sampai}T00:00:00Z`).getTime() - 29 * 86_400_000)
        .toISOString()
        .slice(0, 10);
    const kartu = await kartuPerlengkapan({
      companyId: auth.company_id!,
      branchId,
      supplyId: c.req.param("id"),
      dari,
      sampai,
    });
    if (!kartu) throw new HTTPException(404, { message: "Perlengkapan tidak ditemukan" });
    return c.json(kartu);
  });

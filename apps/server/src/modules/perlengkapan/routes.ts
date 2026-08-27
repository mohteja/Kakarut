/**
 * Perlengkapan non bahan baku (sendok, spons, sabun, dll): modul mandiri —
 * item TIDAK pernah masuk resep/HPP/rencana. Stok per cabang dari ledger
 * mutasi; konsumsi manual ("pakai") + otomatis (aturan harian per cabang).
 * Semua peran boleh lihat & mencatat pemakaian (kasir/tim terkunci cabang);
 * owner/admin mengelola item, stok masuk, koreksi, aturan, dan belanja.
 */
import { tanggalQuery, zTanggal } from "../../lib/tanggal-query";
import { keSkalaKolom, SKALA_QTY_PERLENGKAPAN } from "../../lib/batas-angka";
import { zValidator } from "../../lib/validator";
import { BATAS_QTY_STOK, BATAS_UANG } from "../../lib/batas-angka";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  bolehLihatBiaya,
  tanpaBiayaKartuPerlengkapan,
  type RiwayatHargaDto,
  type RiwayatHargaLot,
} from "@kakarut/shared";
import { statistikHargaLots, hargaPerSatuanLot, lotStatistik, BATAS_LOT_RIWAYAT } from "../../lib/harga-stats";
import { db } from "../../db/client";
import {
  dokumenNomor,
  suppliers,
  supplies,
  supplyMutations,
  supplyRules,
  supplySuppliers,
} from "../../db/schema";
import {
  requireRole,
  resolveBranchId,
  syaratCabang,
  terikatCabang,
  type AppEnv,
  cabangDariQuery,
} from "../../middleware/auth";
import { kunciAntrean } from "../../lib/kunci";
import { tanpaBentrok } from "../../lib/pg-galat";
import { clientRefField, denganKlaimIdempoten, deviceIdField } from "../sync/idempoten";
import { terbitkanNomor } from "../dokumen/nomor";
import {
  batalBeliPerlengkapan,
  batalFakturBeliPerlengkapan,
  hapusBeliPerlengkapan,
  hapusFakturBeliPerlengkapan,
  prosesFakturBeliPerlengkapan,
  batalSemuaBeliPerlengkapan,
  belanjaPerlengkapan,
  buatBeliPerlengkapanManual,
  buatKirimanPerlengkapan,
  buatOpnamePerlengkapan,
  daftarBeliPerlengkapan,
  daftarKirimanPerlengkapan,
  detailOpnamePerlengkapan,
  kartuPerlengkapan,
  muatSupplyAktif,
  permintaanOtomatisPerlengkapan,
  riwayatOpnamePerlengkapan,
  saldoPerlengkapan,
  saldoDiRakPerlengkapan,
  saldoSatuPerlengkapan,
  sebaranPerlengkapan,
  setStatusOpnamePerlengkapan,
  tanggalPerusahaan,
  terapkanKonsumsiOtomatis,
  terimaKirimanPerlengkapan,
  tibaBeliPerlengkapan,
  tibaFakturBeliPerlengkapan,
} from "./service";


const ItemBody = z.object({
  nama: z.string().trim().min(1).max(60),
  satuan: z.string().trim().min(1).max(20).default("pcs"),
  harga_beli: z.number().min(0).max(BATAS_UANG).default(0),
  stok_minimum: z.number().min(0).max(BATAS_QTY_STOK).default(0),
  catatan: z.string().max(300).nullish(),
  kategori: z.string().trim().min(1).max(60).nullish(),
  boleh_eceran: z.boolean().default(true),
  dilacak: z.boolean().default(false),
}).strict();

// PATCH parsial tanpa .default() — lihat catatan BahanPatchBody (zod v4).
const ItemPatchBody = z.object({
  nama: z.string().trim().min(1).max(60).optional(),
  satuan: z.string().trim().min(1).max(20).optional(),
  harga_beli: z.number().min(0).max(BATAS_UANG).optional(),
  stok_minimum: z.number().min(0).max(BATAS_QTY_STOK).optional(),
  catatan: z.string().max(300).nullish(),
  kategori: z.string().trim().min(1).max(60).nullish(),
  boleh_eceran: z.boolean().optional(),
  dilacak: z.boolean().optional(),
  is_active: z.boolean().optional(),
}).strict();

const SupplierBody = z.object({
  items: z
    .array(
      z.object({
        supplier_id: z.string().uuid(),
        is_utama: z.boolean().default(false),
      }),
    )
    .max(50)
    .default([]),
}).strict();

/**
 * Riwayat harga beli perlengkapan: setiap stok MASUK (se-perusahaan) = satu lot
 * pembelian. `harga_satuan` = total_harga / qty. Rata-rata tertimbang hanya dari
 * lot berharga. Fondasi hitung HPP FIFO / rata-rata.
 */
async function riwayatHargaPerlengkapan(
  companyId: string,
  item: typeof supplies.$inferSelect,
): Promise<RiwayatHargaDto> {
  const milikItem = and(
    eq(supplyMutations.companyId, companyId),
    eq(supplyMutations.supplyId, item.id),
    eq(supplyMutations.tipe, "masuk"),
    eq(supplyMutations.status, "disetujui"),
  );
  const urutan = [desc(supplyMutations.tanggal), desc(supplyMutations.waktu)] as const;
  // Dua kueri, alasan yang sama persis dengan kartu Riwayat Harga bahan:
  // statistiknya harus dari SELURUH lot (kueri sempit, tanpa join, tanpa
  // batas), sementara daftar yang dikirim dibatasi. Lihat catatan panjang di
  // `riwayatHargaBahan`.
  const [semuaLot, rows] = await Promise.all([
    db
      .select({
        tanggal: supplyMutations.tanggal,
        qty: supplyMutations.qty,
        totalHarga: supplyMutations.totalHarga,
      })
      .from(supplyMutations)
      .where(milikItem)
      .orderBy(...urutan),
    db
      .select({
        id: supplyMutations.id,
        tanggal: supplyMutations.tanggal,
        qty: supplyMutations.qty,
        totalHarga: supplyMutations.totalHarga,
        nomor: dokumenNomor.nomorTeks,
      })
      .from(supplyMutations)
      .leftJoin(
        dokumenNomor,
        and(
          eq(dokumenNomor.companyId, supplyMutations.companyId),
          eq(dokumenNomor.refId, supplyMutations.id),
        ),
      )
      .where(milikItem)
      .orderBy(...urutan)
      .limit(BATAS_LOT_RIWAYAT + 1),
  ]);
  const terpotong = rows.length > BATAS_LOT_RIWAYAT;
  const lots: RiwayatHargaLot[] = rows.map((r) => ({
    id: r.id,
    tanggal: r.tanggal,
    qty: r.qty,
    total_harga: r.totalHarga,
    harga_satuan: hargaPerSatuanLot(r.totalHarga, r.qty),
    supplier: null,
    no_faktur: null,
    nomor: r.nomor,
    // `supply_mutations` tak punya jalur harga tebakan — tak ada padanan
    // `hargaDefault()` di sini, jadi tiap harga yang ada memang diketik orang.
    // Yang kosong tetap dilewati `statistikHargaLots` seperti sebelumnya.
    harga_tebakan: false,
  }));
  return {
    // perlengkapan tak berkemasan: isi 1, harga per satuan = harga beli
    item: {
      id: item.id,
      nama: item.nama,
      satuan: item.satuan,
      isi: 1,
      satuan_beli: null,
    },
    harga_terkini: item.hargaBeli,
    // Dari SELURUH lot, bukan dari `lots` yang dipotong. `supply_mutations`
    // tak punya jalur harga tebakan, jadi `hargaTebakan: false` di sini bukan
    // penyederhanaan — itu memang keadaannya (lihat catatan di bawah).
    ...statistikHargaLots(
      lotStatistik(semuaLot.map((r) => ({ ...r, hargaTebakan: false }))),
    ),
    jumlah_pembelian: semuaLot.length,
    lots: terpotong ? lots.slice(0, BATAS_LOT_RIWAYAT) : lots,
    lots_terpotong: terpotong,
  };
}

const MasukBody = z.object({
  qty: z.number().positive().max(BATAS_QTY_STOK),
  total_harga: z.number().min(0).max(BATAS_UANG).nullish(),
  catatan: z.string().max(300).nullish(),
  tanggal: zTanggal.optional(),
}).strict();

const PakaiBody = z.object({
  qty: z.number().positive().max(BATAS_QTY_STOK),
  catatan: z.string().max(300).nullish(),
  /**
   * Idempotensi antarjalur (online ↔ /sync) — UUID v4 dari perangkat, opsional.
   *
   * Modul ini dulu satu-satunya pemindah stok TANPA medan ini, dan itulah
   * lubangnya: percobaan online yang COMMIT lalu putus di jaringan diantre
   * ulang dengan ref BARU, dan sinkron mengeksekusinya lagi. Terukur
   * (2026-08-25): saldo 100 → online `pakai 7` → 93 → replay via /sync →
   * **86** — pemakaian ganda dengan balasan "ok".
   */
  client_ref: clientRefField,
  device_id: deviceIdField,
}).strict();

const KoreksiBody = z.object({
  qty_fisik: z.number().min(0).max(BATAS_QTY_STOK),
  catatan: z.string().max(300).nullish(),
}).strict();

const AturanBody = z.object({
  /** "otomatis" = potongan terjadwal; "manual" = pemakaian via stock opname */
  metode: z.enum(["otomatis", "manual"]).default("otomatis"),
  // qty wajib > 0 hanya untuk metode otomatis (divalidasi di handler)
  qty: z.number().min(0).max(BATAS_QTY_STOK).default(0),
  per_hari: z.number().int().min(1).max(365).default(1),
  aktif: z.boolean().default(true),
  mulai: zTanggal.optional(),
}).strict();

const OpnameBody = z.object({
  items: z
    .array(
      z.object({ supply_id: z.string().uuid(), qty_fisik: z.number().min(0).max(BATAS_QTY_STOK) }),
    )
    .min(1)
    .max(1000),
  catatan: z.string().max(300).nullish(),
  // Idempotensi antarjalur — alasan yang sama dengan `PakaiBody` di atas;
  // terukur: satu niat opname melahirkan DUA sesi kembar (online + replay).
  client_ref: clientRefField,
  device_id: deviceIdField,
}).strict();

const StokAwalBody = z.object({
  items: z
    .array(z.object({ supply_id: z.string().uuid(), qty: z.number().min(0).max(BATAS_QTY_STOK) }))
    .min(1)
    .max(500),
}).strict();

const MintaBody = z.object({
  qty: z.number().positive().max(BATAS_QTY_STOK),
  catatan: z.string().max(300).nullish(),
}).strict();

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
      tanggalQuery(c, "dari") ?? `${hariIni.slice(0, 8)}01`;
    const sampai =
      tanggalQuery(c, "sampai") ?? hariIni;
    return c.json(
      await belanjaPerlengkapan({
        companyId: auth.company_id!,
        branchId,
        dari,
        sampai,
      }),
    );
  })
  // MASTER se-perusahaan (halaman Manajemen tanpa pemilih cabang): semua item
  // + sebaran "ada di cabang mana saja" (saldo & aturan konsumsi per cabang).
  .get("/master", requireRole("owner", "admin"), async (c) => {
    const auth = c.get("auth");
    // jatah otomatis SEMUA cabang dipotong dulu supaya saldo sebaran jujur
    await terapkanKonsumsiOtomatis(auth.company_id!);
    return c.json(await sebaranPerlengkapan(auth.company_id!));
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
        if (!item)
          throw new HTTPException(404, {
            message: "Perlengkapan tidak ditemukan",
          });
      }
      const tanggal = await tanggalPerusahaan(auth.company_id!);
      let diubah = 0;
      await db.transaction(async (tx) => {
        /*
         * PEMBANDINGNYA ANGKA RAK, SAMA SEPERTI OPNAME.
         *
         * Layar ini duduk di halaman Stok yang sama dengan stock opname dan
         * menanyakan hal yang sama: berapa yang ada. Barang yang sudah berangkat
         * ke cabang tak ada di rak tapi masih utuh di ledger, jadi
         * membandingkannya dengan ledger mentah membuat koreksi "Stok awal"
         * memotongnya sekali — lalu debit kirimannya memotongnya lagi.
         *
         * Terukur: CK 10 pcs yang seluruhnya sudah dikirim, owner menyetel stok
         * awal 0 → saldo CK 0, lalu toko menekan Terima → CK −10, total 0 dari
         * 10 yang ada. Tak ada tafsir yang membuat −10 benar, termasuk tafsir
         * "stok awal itu angka buku": angka buku yang disetel 0 pun tak boleh
         * turun lagi oleh kiriman yang sudah ikut dihitung di dalamnya.
         */
        const rak = await saldoDiRakPerlengkapan(tx, auth.company_id!, branchId, [
          ...target.keys(),
        ]);
        for (const [supplyId, qty] of target) {
          const selisih = qty - (rak.get(supplyId) ?? 0);
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
    // Klaim atomik pola /stok/opname: retry ber-`client_ref` sama memutar
    // ulang hasil tersimpan alih-alih melahirkan sesi kembar (terukur SEBELUM:
    // online + replay /sync = 2 sesi identik menunggu dua ACC).
    const { data } = await denganKlaimIdempoten(
      {
        companyId: auth.company_id!,
        clientRef: body.client_ref,
        userId: auth.sub,
        deviceId: body.device_id ?? null,
        tipe: "perlengkapan_opname",
      },
      async () => {
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
        return hasil ?? { session_id: null, nomor: null, jumlah_selisih: 0 };
      },
    );
    const d = data as { session_id: string | null };
    return d.session_id === null ? c.json(d) : c.json(d, 201);
  })
  .get("/opname/riwayat", async (c) => {
    const auth = c.get("auth");
    const branchId = await resolveBranchId(c);
    return c.json(await riwayatOpnamePerlengkapan(auth.company_id!, branchId));
  })
  .get("/opname/sesi/:sessionId", async (c) => {
    const auth = c.get("auth");
    const detail = await detailOpnamePerlengkapan(
      auth.company_id!,
      c.req.param("sessionId"),
      syaratCabang(c, supplyMutations.branchId),
    );
    if (!detail)
      throw new HTTPException(404, { message: "Sesi opname tidak ditemukan" });
    return c.json(detail);
  })
  .post(
    "/opname/sesi/:sessionId/acc",
    requireRole("owner", "admin"),
    async (c) => {
      const auth = c.get("auth");
      const n = await setStatusOpnamePerlengkapan(
        auth.company_id!,
        c.req.param("sessionId"),
        "disetujui",
      );
      if (n === 0) {
        throw new HTTPException(404, {
          message: "Sesi tidak ditemukan / sudah ditinjau",
        });
      }
      return c.json({ ok: true, jumlah: n });
    },
  )
  .post(
    "/opname/sesi/:sessionId/tolak",
    requireRole("owner", "admin"),
    async (c) => {
      const auth = c.get("auth");
      const n = await setStatusOpnamePerlengkapan(
        auth.company_id!,
        c.req.param("sessionId"),
        "ditolak",
      );
      if (n === 0) {
        throw new HTTPException(404, {
          message: "Sesi tidak ditemukan / sudah ditinjau",
        });
      }
      return c.json({ ok: true, jumlah: n });
    },
  )
  .delete(
    "/opname/sesi/:sessionId",
    requireRole("owner", "admin"),
    async (c) => {
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
      if (rows.length === 0)
        throw new HTTPException(404, { message: "Sesi tidak ditemukan" });
      return c.json({ ok: true, jumlah: rows.length });
    },
  )
  /* ===== KIRIMAN CK → CABANG (permintaan stok ≤ minimum) ===== */
  // Permintaan OTOMATIS: pindai perlengkapan cabang yang saldo ≤ minimum,
  // terbitkan kiriman KP- sebanyak stok yang ada di CK (owner/admin).
  .post("/permintaan-otomatis", requireRole("owner", "admin"), async (c) => {
    const auth = c.get("auth");
    const branchId = await resolveBranchId(c);
    // rencana_id (opsional): faktur BP- ditautkan ke permintaan Tambah Stok
    // dari Menu agar tampil di Data Permintaan Stok
    const rencanaId = c.req.query("rencana_id") || null;
    const hasil = await permintaanOtomatisPerlengkapan({
      companyId: auth.company_id!,
      cabangId: branchId,
      userId: auth.sub,
      rencanaId,
    });
    if ("error" in hasil) {
      throw new HTTPException((hasil.code ?? 400) as 400 | 404, {
        message: hasil.error,
      });
    }
    return c.json(hasil);
  })
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
      throw new HTTPException((hasil.code ?? 400) as 400 | 404, {
        message: hasil.error,
      });
    }
    return c.json(hasil);
  })
  /**
   * Daftar FAKTUR BELI perlengkapan ke CK — berikut harga & totalnya.
   *
   * Komentarnya sudah menulis "owner/admin lihat semua … peran terikat cabang
   * hanya faktur di CK-nya", jadi pembatasannya dipikirkan — sebagai penyaring
   * BARIS, bukan sebagai penjaga PINTU. Terukur 2026-08-26 token peran `bar`:
   * 200. Dua saudaranya di berkas yang SAMA — `GET /belanja` dan `GET /master`
   * — sudah `requireRole("owner","admin")`.
   *
   * Pasangannya diperiksa: pembacanya `BeliPerlengkapanPage` (rute web
   * `isManajemen`), badge nav `Layout` (query-nya ber-`enabled: manajemenGuard`),
   * dan `beli_perlengkapan_page` ponsel (laci `isManajemen`). Tak ada layar
   * peran lain yang memanggilnya.
   */
  .get("/beli", requireRole("owner", "admin"), async (c) => {
    const auth = c.get("auth");
    let ckFilter: string | undefined;
    if (terikatCabang(auth.role)) ckFilter = auth.branch_id ?? undefined;
    else ckFilter = (await cabangDariQuery(c)) ?? undefined;
    return c.json(await daftarBeliPerlengkapan(auth.company_id!, ckFilter));
  })
  /**
   * Buat FAKTUR beli perlengkapan MANUAL ke CK (multi-item — seperti faktur
   * beli bahan baku). Bentuk lama satu-item (supply_id/qty di akar body)
   * tetap diterima. owner/admin.
   */
  .post(
    "/beli",
    requireRole("owner", "admin"),
    zValidator(
      "json",
      z.object({
        items: z
          .array(
            z.object({
              supply_id: z.string().uuid(),
              qty: z.number().positive().max(BATAS_QTY_STOK),
              total_harga: z.number().min(0).max(BATAS_UANG).nullish(),
            }),
          )
          .min(1)
          .max(100)
          .optional(),
        // bentuk lama (satu item) — dipakai bila `items` tidak dikirim
        supply_id: z.string().uuid().optional(),
        qty: z.number().positive().max(BATAS_QTY_STOK).optional(),
        total_harga: z.number().min(0).max(BATAS_UANG).nullish(),
        ck_branch_id: z.string().uuid().nullish(),
        tujuan_branch_id: z.string().uuid().nullish(),
        catatan: z.string().nullish(),
      }).strict(),
    ),
    async (c) => {
      const auth = c.get("auth");
      const b = c.req.valid("json");
      const items =
        b.items ??
        (b.supply_id && b.qty
          ? [
              {
                supply_id: b.supply_id,
                qty: b.qty,
                total_harga: b.total_harga ?? null,
              },
            ]
          : null);
      if (!items) {
        throw new HTTPException(400, {
          message: "items wajib diisi (min 1 perlengkapan)",
        });
      }
      const hasil = await buatBeliPerlengkapanManual({
        companyId: auth.company_id!,
        userId: auth.sub,
        items: items.map((it) => ({
          supplyId: it.supply_id,
          qty: it.qty,
          totalHarga: it.total_harga ?? null,
        })),
        ckBranchId: b.ck_branch_id ?? null,
        tujuanBranchId: b.tujuan_branch_id ?? null,
        catatan: b.catatan ?? null,
      });
      if ("error" in hasil) {
        throw new HTTPException((hasil.code ?? 400) as 400 | 404, {
          message: hasil.error,
        });
      }
      return c.json(hasil, 201);
    },
  )
  /**
   * Barang SATU FAKTUR tiba di CK: proses semua baris 'menunggu' (qty/harga
   * per baris opsional via items) → masuk stok CK + otomatis kirim ke cabang
   * tujuan. owner/admin.
   */
  .post(
    "/beli/faktur/:fakturId/tiba",
    requireRole("owner", "admin"),
    zValidator(
      "json",
      z.object({
        items: z
          .array(
            z.object({
              id: z.string().uuid(),
              qty: z.number().positive().max(BATAS_QTY_STOK).optional(),
              total_harga: z.number().min(0).max(BATAS_UANG).nullish(),
            }),
          )
          .max(100)
          .optional(),
      }).strict(),
    ),
    async (c) => {
      const auth = c.get("auth");
      const body = c.req.valid("json");
      const hasil = await tibaFakturBeliPerlengkapan({
        companyId: auth.company_id!,
        fakturId: c.req.param("fakturId"),
        userId: auth.sub,
        items: body.items,
      });
      if ("error" in hasil) {
        throw new HTTPException((hasil.code ?? 400) as 400 | 404, {
          message: hasil.error,
        });
      }
      return c.json(hasil);
    },
  )
  /**
   * Tandai SATU FAKTUR beli 'diproses' (sedang dibelanjakan) — paritas tahap
   * RAB → diproses beli bahan baku; pemroses tercatat. owner/admin.
   */
  .post(
    "/beli/faktur/:fakturId/proses",
    requireRole("owner", "admin"),
    async (c) => {
      const auth = c.get("auth");
      const hasil = await prosesFakturBeliPerlengkapan(
        auth.company_id!,
        c.req.param("fakturId"),
        auth.sub,
      );
      if ("error" in hasil) {
        throw new HTTPException((hasil.code ?? 400) as 400 | 404, {
          message: hasil.error,
        });
      }
      return c.json(hasil);
    },
  )
  /**
   * Batalkan SEMUA faktur beli yang masih 'menunggu' (bersih-bersih massal;
   * opsional ?branch_id = CK). owner/admin.
   */
  .post("/beli/batal-semua", requireRole("owner", "admin"), async (c) => {
    const auth = c.get("auth");
    const ckId = (await cabangDariQuery(c)) ?? undefined;
    return c.json(await batalSemuaBeliPerlengkapan(auth.company_id!, ckId));
  })
  /** Batalkan semua baris 'menunggu' satu faktur beli perlengkapan. owner/admin. */
  .post(
    "/beli/faktur/:fakturId/batal",
    requireRole("owner", "admin"),
    async (c) => {
      const auth = c.get("auth");
      const hasil = await batalFakturBeliPerlengkapan(
        auth.company_id!,
        c.req.param("fakturId"),
      );
      if ("error" in hasil) {
        throw new HTTPException((hasil.code ?? 400) as 400 | 404, {
          message: hasil.error,
        });
      }
      return c.json(hasil);
    },
  )
  /**
   * HAPUS PERMANEN satu faktur beli perlengkapan (bersih-bersih data lama).
   * owner/admin. Ditolak (400) bila terkait permintaan aktif atau ada baris
   * yang sudah 'tiba' (masuk stok).
   */
  .delete(
    "/beli/faktur/:fakturId",
    requireRole("owner", "admin"),
    async (c) => {
      const auth = c.get("auth");
      const hasil = await hapusFakturBeliPerlengkapan(
        auth.company_id!,
        c.req.param("fakturId"),
      );
      if ("error" in hasil) {
        throw new HTTPException((hasil.code ?? 400) as 400 | 404, {
          message: hasil.error,
        });
      }
      return c.json(hasil);
    },
  )
  /**
   * Barang faktur beli TIBA di CK → masuk stok CK (PL-) + otomatis kirim (KP-)
   * ke cabang tujuan. owner/admin (manajemen memproses kedatangan di CK).
   */
  .post(
    "/beli/:id/tiba",
    requireRole("owner", "admin"),
    zValidator(
      "json",
      z.object({
        qty: z.number().positive().max(BATAS_QTY_STOK).optional(),
        total_harga: z.number().min(0).max(BATAS_UANG).nullish(),
      }).strict(),
    ),
    async (c) => {
      const auth = c.get("auth");
      const body = c.req.valid("json");
      const hasil = await tibaBeliPerlengkapan({
        companyId: auth.company_id!,
        id: c.req.param("id"),
        userId: auth.sub,
        qty: body.qty,
        totalHarga: body.total_harga ?? null,
      });
      if ("error" in hasil) {
        throw new HTTPException((hasil.code ?? 400) as 400 | 404, {
          message: hasil.error,
        });
      }
      return c.json(hasil);
    },
  )
  /** Batalkan faktur beli perlengkapan yang masih 'menunggu'. owner/admin. */
  .post("/beli/:id/batal", requireRole("owner", "admin"), async (c) => {
    const auth = c.get("auth");
    const hasil = await batalBeliPerlengkapan(
      auth.company_id!,
      c.req.param("id"),
    );
    if ("error" in hasil) {
      throw new HTTPException((hasil.code ?? 400) as 400 | 404, {
        message: hasil.error,
      });
    }
    return c.json(hasil);
  })
  /** HAPUS PERMANEN satu baris beli perlengkapan warisan (faktur_id null). owner/admin. */
  .delete("/beli/:id", requireRole("owner", "admin"), async (c) => {
    const auth = c.get("auth");
    const hasil = await hapusBeliPerlengkapan(
      auth.company_id!,
      c.req.param("id"),
    );
    if ("error" in hasil) {
      throw new HTTPException((hasil.code ?? 400) as 400 | 404, {
        message: hasil.error,
      });
    }
    return c.json(hasil);
  })
  .post(
    "/",
    requireRole("owner", "admin"),
    zValidator("json", ItemBody),
    async (c) => {
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
          throw new HTTPException(409, {
            message: `Perlengkapan "${ada.nama}" sudah ada`,
          });
        }
        const [row] = await db
          .update(supplies)
          .set({
            nama: body.nama,
            satuan: body.satuan,
            hargaBeli: body.harga_beli,
            stokMinimum: body.stok_minimum,
            catatan: body.catatan ?? null,
            kategori: body.kategori ?? null,
            bolehEceran: body.boleh_eceran,
            dilacak: body.dilacak,
            isActive: true,
            updatedAt: new Date(),
          })
          .where(eq(supplies.id, ada.id))
          .returning();
        return c.json({ id: row.id, nama: row.nama, dipulihkan: true }, 201);
      }
      /*
       * Pra-cek nama di atas punya jeda sebelum tulisannya; yang benar-benar
       * menjaga keunikan `supplies_company_nama_uq`. Dua owner yang menambahkan
       * perlengkapan bernama sama pada saat bersamaan membuat yang KALAH
       * menabrak indeks itu — 23505 mentah alias 500. Terukur, empat permintaan
       * serentak: 201, 409, 409, dan 500.
       *
       * Pesannya memakai `body.nama` apa adanya, sedangkan jalur berurutan
       * menyebut nama dengan HURUF yang tersimpan (`ada.nama`) — pencocokannya
       * case-insensitive, jadi keduanya bisa berbeda besar-kecilnya. Bedanya
       * dibiarkan: menyamakannya menuntut satu SELECT lagi pada jalur galat,
       * dan yang harus dilakukan pemakainya sama saja (pilih nama lain).
       */
      const [row] = await tanpaBentrok(
        `Perlengkapan "${body.nama}" sudah ada`,
        () =>
          db
            .insert(supplies)
            .values({
              companyId: auth.company_id!,
              nama: body.nama,
              satuan: body.satuan,
              hargaBeli: body.harga_beli,
              stokMinimum: body.stok_minimum,
              catatan: body.catatan ?? null,
              kategori: body.kategori ?? null,
              bolehEceran: body.boleh_eceran,
              dilacak: body.dilacak,
            })
            .returning(),
        "supplies_company_nama_uq",
      );
      return c.json({ id: row.id, nama: row.nama, dipulihkan: false }, 201);
    },
  )
  .patch(
    "/:id",
    requireRole("owner", "admin"),
    zValidator("json", ItemPatchBody),
    async (c) => {
      const auth = c.get("auth");
      const body = c.req.valid("json");
      const [row] = await tanpaBentrok(
        "Nama perlengkapan itu sudah dipakai",
        () =>
          db
            .update(supplies)
            .set({
              ...(body.nama !== undefined && { nama: body.nama }),
              ...(body.satuan !== undefined && { satuan: body.satuan }),
              ...(body.harga_beli !== undefined && {
                hargaBeli: body.harga_beli,
              }),
              ...(body.stok_minimum !== undefined && {
                stokMinimum: body.stok_minimum,
              }),
              ...(body.catatan !== undefined && { catatan: body.catatan }),
              ...(body.kategori !== undefined && { kategori: body.kategori }),
              ...(body.boleh_eceran !== undefined && {
                bolehEceran: body.boleh_eceran,
              }),
              ...(body.dilacak !== undefined && { dilacak: body.dilacak }),
              ...(body.is_active !== undefined && { isActive: body.is_active }),
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(supplies.id, c.req.param("id")),
                eq(supplies.companyId, auth.company_id!),
              ),
            )
            .returning(),
      );
      if (!row)
        throw new HTTPException(404, {
          message: "Perlengkapan tidak ditemukan",
        });
      return c.json({ ok: true });
    },
  )
  /* ===== SUPPLIER per perlengkapan (pola persis /bahan/:id/supplier) =====
   *
   * "Pola persis" itu ikut menyalin celahnya: GET tanpa penjaga, `PUT` di
   * bawahnya `requireRole("owner","admin")`. Terukur token `bar`: 200.
   * Di sini owner/admin saja (bukan +tim seperti bahan) sebab kedua pembacanya
   * — `PerlengkapanPage` web dan `perlengkapan_master_page` ponsel — memang
   * cuma dipasang untuk manajemen.
   */
  .get("/:id/supplier", requireRole("owner", "admin"), async (c) => {
    const auth = c.get("auth");
    const item = await muatSupplyAktif(auth.company_id!, c.req.param("id"));
    if (!item)
      throw new HTTPException(404, { message: "Perlengkapan tidak ditemukan" });
    const rows = await db
      .select({
        id: supplySuppliers.id,
        supplierId: supplySuppliers.supplierId,
        nama: suppliers.nama,
        telepon: suppliers.telepon,
        alamat: suppliers.alamat,
        isUtama: supplySuppliers.isUtama,
      })
      .from(supplySuppliers)
      .innerJoin(suppliers, eq(supplySuppliers.supplierId, suppliers.id))
      .where(
        and(
          eq(supplySuppliers.companyId, auth.company_id!),
          eq(supplySuppliers.supplyId, item.id),
        ),
      )
      .orderBy(desc(supplySuppliers.isUtama), asc(suppliers.nama));
    return c.json(
      rows.map((r) => ({
        id: r.id,
        supplier_id: r.supplierId,
        nama: r.nama,
        telepon: r.telepon,
        alamat: r.alamat,
        is_utama: r.isUtama,
      })),
    );
  })
  .put(
    "/:id/supplier",
    requireRole("owner", "admin"),
    zValidator("json", SupplierBody),
    async (c) => {
      const auth = c.get("auth");
      const { items } = c.req.valid("json");
      const item = await muatSupplyAktif(auth.company_id!, c.req.param("id"));
      if (!item)
        throw new HTTPException(404, {
          message: "Perlengkapan tidak ditemukan",
        });
      // gabungkan duplikat (utama di-OR-kan) agar unique index tak meledak
      const byId = new Map<string, boolean>();
      for (const it of items) {
        byId.set(
          it.supplier_id,
          (byId.get(it.supplier_id) ?? false) || it.is_utama,
        );
      }
      const utama = [...byId.values()].filter(Boolean).length;
      if (utama > 1) {
        throw new HTTPException(400, {
          message: "Hanya boleh satu supplier utama",
        });
      }
      const supplierIds = [...byId.keys()];
      if (supplierIds.length > 0) {
        const valid = await db
          .select({ id: suppliers.id })
          .from(suppliers)
          .where(
            and(
              eq(suppliers.companyId, auth.company_id!),
              inArray(suppliers.id, supplierIds),
            ),
          );
        if (valid.length !== supplierIds.length) {
          throw new HTTPException(400, {
            message: "Ada supplier yang tidak valid",
          });
        }
        // tanpa penanda utama → item pertama jadi utama (selalu ada langganan)
        if (utama === 0) byId.set(supplierIds[0], true);
      }
      await db.transaction(async (tx) => {
        // Kunci baris induknya lebih dulu. "Ganti seluruh daftar" = HAPUS lalu
        // SISIP, dan saat daftarnya masih kosong HAPUS tak memegang baris apa
        // pun — dua permintaan bersamaan sama-sama lolos ke SISIP dan menabrak
        // `supply_suppliers_pair_uq`. Terukur, empat PUT BERBADAN SAMA:
        // 200, 200, 500, 500 (tiga ronde). Cukup satu klik ganda pada tombol
        // Simpan. Alasan lengkapnya di jalur kembarnya, `PUT /bahan/:id/supplier`.
        await tx
          .select({ id: supplies.id })
          .from(supplies)
          .where(and(eq(supplies.id, item.id), eq(supplies.companyId, auth.company_id!)))
          .for("update");
        await tx
          .delete(supplySuppliers)
          .where(
            and(
              eq(supplySuppliers.companyId, auth.company_id!),
              eq(supplySuppliers.supplyId, item.id),
            ),
          );
        if (supplierIds.length > 0) {
          await tx.insert(supplySuppliers).values(
            [...byId].map(([supplierId, isUtama]) => ({
              companyId: auth.company_id!,
              supplyId: item.id,
              supplierId,
              isUtama,
            })),
          );
        }
      });
      return c.json({ ok: true, jumlah: supplierIds.length });
    },
  )
  /**
   * RIWAYAT HARGA beli perlengkapan: daftar lot (stok masuk) + harga terkini &
   * rata-rata tertimbang (fondasi HPP).
   *
   * DULU "terbuka semua peran (info harga)" — kalimat yang sama persis dengan
   * kembarannya di `bahan/routes.ts`, dan celahnya juga sama. Pintu yang
   * MENULIS harga itu (`POST /:id/harga`) sudah owner/admin. Pembacanya
   * `RiwayatHargaModal` web, dibuka HANYA dari `PerlengkapanPage`
   * (rute `isManajemen`); ponsel tak memanggilnya.
   */
  .get("/:id/pembelian", requireRole("owner", "admin"), async (c) => {
    const auth = c.get("auth");
    const item = await muatSupplyAktif(auth.company_id!, c.req.param("id"));
    if (!item)
      throw new HTTPException(404, { message: "Perlengkapan tidak ditemukan" });
    return c.json(await riwayatHargaPerlengkapan(auth.company_id!, item));
  })
  /**
   * CATAT HARGA perlengkapan (dari kartu Riwayat Harga): perbarui harga beli
   * acuan per satuan → dipakai perkiraan belanja & HPP berikutnya. owner/admin.
   */
  .post(
    "/:id/harga",
    requireRole("owner", "admin"),
    zValidator("json", z.object({ harga_per_unit: z.number().min(0).max(BATAS_UANG) }).strict()),
    async (c) => {
      const auth = c.get("auth");
      const { harga_per_unit } = c.req.valid("json");
      const item = await muatSupplyAktif(auth.company_id!, c.req.param("id"));
      if (!item)
        throw new HTTPException(404, {
          message: "Perlengkapan tidak ditemukan",
        });
      const [row] = await db
        .update(supplies)
        .set({ hargaBeli: Math.round(harga_per_unit), updatedAt: new Date() })
        .where(
          and(
            eq(supplies.id, item.id),
            eq(supplies.companyId, auth.company_id!),
          ),
        )
        .returning();
      return c.json(await riwayatHargaPerlengkapan(auth.company_id!, row));
    },
  )
  // Soft delete: ledger & riwayat tetap utuh; nama yang sama bisa dibuat ulang
  // (reaktivasi). Aturan konsumsinya otomatis berhenti (join is_active).
  .delete("/:id", requireRole("owner", "admin"), async (c) => {
    const auth = c.get("auth");
    const [row] = await db
      .update(supplies)
      .set({ isActive: false, updatedAt: new Date() })
      .where(
        and(
          eq(supplies.id, c.req.param("id")),
          eq(supplies.companyId, auth.company_id!),
        ),
      )
      .returning();
    if (!row)
      throw new HTTPException(404, { message: "Perlengkapan tidak ditemukan" });
    return c.json({ ok: true });
  })
  .post(
    "/:id/masuk",
    requireRole("owner", "admin"),
    zValidator("json", MasukBody),
    async (c) => {
      const auth = c.get("auth");
      const body = c.req.valid("json");
      const branchId = await resolveBranchId(c);
      const item = await muatSupplyAktif(auth.company_id!, c.req.param("id"));
      if (!item)
        throw new HTTPException(404, {
          message: "Perlengkapan tidak ditemukan",
        });
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
            /*
             * Tanpa harga → PERKIRAAN dari harga beli acuan, bukan `null`.
             *
             * `null` berarti barang masuk ke stok TANPA biaya sama sekali:
             * saldo naik, uangnya tak pernah muncul di total belanja
             * perlengkapan. Layar web sudah menghindarinya — kotak harga yang
             * dikosongkan mengirim `qty × harga_beli`, dan salah ketik ditahan
             * sebelum terkirim — tapi aturan itu hidup di SATU klien. Klien
             * lain, atau panggilan API langsung, menulis nol diam-diam.
             *
             * Nilainya sama persis dengan yang dikirim web bila kotaknya
             * dikosongkan, jadi ini mencerminkan perilaku yang sudah ada, bukan
             * mengarang harga baru. Pola & alasannya sama dengan `hargaDefault`
             * di jalur faktur produksi.
             *
             * `harga_beli` boleh 0 (memang opsional), dan bila begitu hasilnya
             * 0 — persis seperti sebelumnya. Yang berubah cuma: nol itu kini
             * karena harganya memang nol, bukan karena tak ada yang mengisi.
             */
            totalHarga: body.total_harga ?? Math.round((item.hargaBeli ?? 0) * body.qty),
            tanggal:
              body.tanggal ?? (await tanggalPerusahaan(auth.company_id!)),
            catatan: body.catatan ?? null,
            userId: auth.sub,
          })
          .returning({ id: supplyMutations.id });
        return terbitkanNomor(tx, auth.company_id!, "perlengkapan", mut.id);
      });
      return c.json({
        ok: true,
        nomor,
        saldo: await saldoSatuPerlengkapan(item.id, branchId),
      });
    },
  )
  .post("/:id/pakai", zValidator("json", PakaiBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    // Klaim atomik pola /stok/opname — lihat pengukuran di `PakaiBody`:
    // tanpa ini, replay antrean offline atas commit yang balasannya hilang
    // memotong stok DUA KALI dengan balasan "ok".
    const { data } = await denganKlaimIdempoten(
      {
        companyId: auth.company_id!,
        clientRef: body.client_ref,
        userId: auth.sub,
        deviceId: body.device_id ?? null,
        tipe: "perlengkapan_pakai",
      },
      async () => {
    const branchId = await resolveBranchId(c);
    const item = await muatSupplyAktif(auth.company_id!, c.req.param("id"));
    if (!item)
      throw new HTTPException(404, { message: "Perlengkapan tidak ditemukan" });
    // jatah otomatis hari ini dipotong dulu agar saldo yang divalidasi jujur
    await terapkanKonsumsiOtomatis(auth.company_id!, branchId);
    /*
     * YANG BOLEH DIPAKAI ADALAH YANG ADA DI RAK.
     *
     * Ledger perlengkapan baru bergerak saat diterima, jadi barang yang sudah
     * berangkat ke cabang masih utuh di saldo CK — dan memvalidasi pemakaian
     * terhadap saldo mentah mengizinkan CK "memakai" barang yang fisiknya sudah
     * tidak ada di sana. Terukur: CK 10 pcs yang seluruhnya sudah dikirim,
     * `pakai 10` DITERIMA → saldo 0, lalu toko menekan Terima → CK −10, total 0
     * dari 10 yang ada.
     *
     * Pembandingnya `saldoDiRakPerlengkapan`, sama dengan yang dipakai opname,
     * stok awal, dan koreksi fisik. Bedanya cuma pertanyaannya: yang itu
     * "berapa yang ada", yang ini "boleh dipakai berapa" — jawabannya satu.
     */
    /*
     * BACA DAN TULIS DALAM SATU TRANSAKSI BERKUNCI.
     *
     * Penjaga di bawah ("qty > saldo → 400") sudah benar isinya; yang bocor
     * penegakannya. Bacanya memakai `db` dan tulisannya pernyataan TERPISAH,
     * jadi dua pemakaian bersamaan sama-sama membaca saldo yang sama, sama-sama
     * lolos, lalu sama-sama menulis.
     *
     * Terukur: saldo 10, enam `pakai 10` serentak → TIGA dibalas 200 dan saldo
     * jatuh ke −20 (dua dari tiga ronde; ronde ketiga kebetulan berurutan).
     * Yang menerima "Stok tidak cukup" justru sebagian permintaan, jadi dari
     * layar tampak berfungsi — yang lolos itulah yang menarik stok ke minus.
     *
     * Kuncinya per (perusahaan, cabang, item): dua item berbeda tak saling
     * menunggu, dan cabang berbeda pun tidak.
     */
    const tanggal = await tanggalPerusahaan(auth.company_id!);
    const sisa = await db.transaction(async (tx) => {
      await kunciAntrean(tx, "stok-perlengkapan", auth.company_id!, branchId, item.id);
      const saldo =
        (await saldoDiRakPerlengkapan(tx, auth.company_id!, branchId, [item.id])).get(item.id) ?? 0;
      if (body.qty > saldo) {
        throw new HTTPException(400, {
          message: `Stok tidak cukup (saldo ${saldo} ${item.satuan})`,
        });
      }
      await tx.insert(supplyMutations).values({
        companyId: auth.company_id!,
        branchId,
        supplyId: item.id,
        tipe: "pakai",
        qty: -body.qty,
        tanggal,
        catatan: body.catatan ?? null,
        userId: auth.sub,
      });
      // Sisa yang dibalas ke layar disusun DI JS dari saldo hasil SUM dikurangi
      // qty kiriman klien — tanpa pembulatan, "pakai 0,1 dari 0,3" membalas
      // 0.19999999999999998 tepat di layar yang baru saja menekan Pakai.
      return keSkalaKolom(saldo - body.qty, SKALA_QTY_PERLENGKAPAN);
    });
        return { ok: true, saldo: sisa };
      },
    );
    return c.json(data);
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
      if (!item)
        throw new HTTPException(404, {
          message: "Perlengkapan tidak ditemukan",
        });
      await terapkanKonsumsiOtomatis(auth.company_id!, branchId);
      /*
       * SATU TRANSAKSI BERKUNCI, sama seperti `/:id/pakai`, dan di sini
       * akibatnya bahkan lebih halus karena tak ada yang dibalas galat.
       *
       * Yang ditulis SELISIH (`qty_fisik − saldo`), jadi dua koreksi bersamaan
       * yang membaca saldo sama akan menerapkan selisih itu DUA KALI. Berurutan
       * ia idempoten — koreksi kedua menghitung selisih 0 — dan justru itu yang
       * membuat klik ganda tampak aman.
       *
       * Terukur, "rak berisi 5" atas saldo 10, empat kali serentak, tiga ronde:
       * saldo akhir 0, 10, dan 10 — TAK SEKALI PUN 5. Berurutan selalu 5.
       * Hasilnya bukan cuma salah, melainkan berbeda-beda tiap kali: petugas
       * yang menghitung rak melaporkan 5 dan buku mencatat angka lain.
       */
      const tanggal = await tanggalPerusahaan(auth.company_id!);
      const selisih = await db.transaction(async (tx) => {
        await kunciAntrean(tx, "stok-perlengkapan", auth.company_id!, branchId, item.id);
        // Angka RAK, bukan angka buku — pintu ketiga yang menanyakan hal yang
        // sama. Lihat `saldoDiRakPerlengkapan`.
        const saldo =
          (await saldoDiRakPerlengkapan(tx, auth.company_id!, branchId, [item.id])).get(item.id) ??
          0;
        const beda = body.qty_fisik - saldo;
        if (beda !== 0) {
          await tx.insert(supplyMutations).values({
            companyId: auth.company_id!,
            branchId,
            supplyId: item.id,
            tipe: "koreksi",
            qty: beda,
            tanggal,
            catatan: body.catatan ?? "Koreksi fisik",
            userId: auth.sub,
          });
        }
        return beda;
      });
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
      // metode OTOMATIS butuh takaran; MANUAL cukup dicatat lewat stock opname
      if (body.metode === "otomatis" && !(body.qty > 0)) {
        throw new HTTPException(400, {
          message: "Jumlah terpakai wajib > 0 untuk aturan otomatis",
        });
      }
      const branchId = await resolveBranchId(c);
      const item = await muatSupplyAktif(auth.company_id!, c.req.param("id"));
      if (!item)
        throw new HTTPException(404, {
          message: "Perlengkapan tidak ditemukan",
        });
      const mulai = body.mulai ?? (await tanggalPerusahaan(auth.company_id!));
      // Ganti aturan = hitung ulang jadwal dari `mulai` (kursor direset).
      // Hari yang SUDAH tercatat aman — unique index auto per hari menahannya.
      await db
        .insert(supplyRules)
        .values({
          companyId: auth.company_id!,
          branchId,
          supplyId: item.id,
          metode: body.metode,
          qty: body.metode === "manual" ? 0 : body.qty,
          perHari: body.per_hari,
          mulai,
          aktif: body.aktif,
          terakhirDiterapkan: null,
        })
        .onConflictDoUpdate({
          target: [supplyRules.branchId, supplyRules.supplyId],
          set: {
            metode: body.metode,
            qty: body.metode === "manual" ? 0 : body.qty,
            perHari: body.per_hari,
            mulai,
            aktif: body.aktif,
            terakhirDiterapkan: null,
            updatedAt: new Date(),
          },
        });
      await terapkanKonsumsiOtomatis(auth.company_id!, branchId);
      return c.json({
        ok: true,
        saldo: await saldoSatuPerlengkapan(item.id, branchId),
      });
    },
  )
  // Cabang minta ke CK (stok ≤ minimum): faktur kiriman KP- terbit bila stok
  // CK cukup; saldo pindah saat cabang menekan Terima.
  .post("/:id/minta", zValidator("json", MintaBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const branchId = await resolveBranchId(c);
    const item = await muatSupplyAktif(auth.company_id!, c.req.param("id"));
    if (!item)
      throw new HTTPException(404, { message: "Perlengkapan tidak ditemukan" });
    const hasil = await buatKirimanPerlengkapan({
      companyId: auth.company_id!,
      cabangId: branchId,
      supplyId: item.id,
      qty: body.qty,
      userId: auth.sub,
      catatan: body.catatan ?? null,
    });
    if ("error" in hasil)
      throw new HTTPException(400, { message: hasil.error });
    return c.json({ ok: true, kiriman_id: hasil.id, nomor: hasil.nomor }, 201);
  })
  .get("/:id/kartu", async (c) => {
    const auth = c.get("auth");
    const branchId = await resolveBranchId(c);
    await terapkanKonsumsiOtomatis(auth.company_id!, branchId);
    const hariIni = await tanggalPerusahaan(auth.company_id!);
    const q = (nama: string) => tanggalQuery(c, nama) ?? null;
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
    if (!kartu)
      throw new HTTPException(404, { message: "Perlengkapan tidak ditemukan" });
    /*
     * PINTUNYA sengaja tetap terbuka — `KartuPerlengkapanModal` web dibuka
     * dari tab Stok → Perlengkapan yang dipakai semua peran untuk pakai &
     * opname, dan menutupnya menghentikan pekerjaan harian. Yang ditutup
     * ANGKA belanjanya.
     */
    return c.json(bolehLihatBiaya(auth.role) ? kartu : tanpaBiayaKartuPerlengkapan(kartu));
  });

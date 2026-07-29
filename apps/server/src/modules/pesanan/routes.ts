import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { PesananItemRow, PesananLogRow, PesananRow, PesananStatus } from "@kakarut/shared";
import { db } from "../../db/client";
import {
  companies,
  openBillItems,
  openBills,
  pesananLogs,
  saleItems,
  sales,
  users,
} from "../../db/schema";
import { resolveBranchId, type AppEnv } from "../../middleware/auth";
import { tanggalDi } from "../../lib/time";

/**
 * PAPAN PESANAN MASUK — layar kerja dapur/kasir cabang.
 *
 * Menggabungkan DUA sumber yang sebelumnya tak pernah dilihat bersama:
 *
 * 1. **open bill** — pesanan yang sudah diinput kasir tapi belum dibayar.
 *    Sebelumnya hanya kasir yang bisa melihatnya (`/open-bill/*` dijaga
 *    `requireRole("cashier")`), sehingga dapur tak punya cara tahu ada pesanan
 *    masuk sampai pelanggan membayar.
 * 2. **penjualan hari ini** — pesanan yang sudah dibayar.
 *
 * Satu pesanan bisa berpindah dari (1) ke (2) saat dilunasi; `createSale`
 * mewarisi status & penanda penyajiannya, jadi papan tetap menampilkan satu
 * kartu, bukan dua.
 */

/** Label aksi siap tampil untuk baris riwayat. */
const LABEL_STATUS: Record<PesananStatus, string> = {
  dikerjakan: "Dikembalikan ke antrean",
  selesai: "Ditandai selesai",
  batal: "Dibatalkan",
};

const JenisParam = z.enum(["open_bill", "penjualan"]);

/** Zona waktu perusahaan — dasar "hari ini" yang sama dengan modul lain. */
async function tzPerusahaan(companyId: string): Promise<string> {
  const [comp] = await db
    .select({ tz: companies.timezone })
    .from(companies)
    .where(eq(companies.id, companyId));
  return comp?.tz ?? "Asia/Jakarta";
}

/** Baris log + nama pemakainya, dipakai endpoint riwayat. */
async function riwayat(kolom: "sale" | "bill", id: string): Promise<PesananLogRow[]> {
  const rows = await db
    .select({ waktu: pesananLogs.waktu, aksi: pesananLogs.aksi, oleh: users.nama })
    .from(pesananLogs)
    .leftJoin(users, eq(pesananLogs.userId, users.id))
    .where(kolom === "sale" ? eq(pesananLogs.saleId, id) : eq(pesananLogs.openBillId, id))
    .orderBy(desc(pesananLogs.waktu))
    .limit(100);
  return rows.map((r) => ({ waktu: r.waktu.toISOString(), aksi: r.aksi, oleh: r.oleh ?? null }));
}

export const pesananRoutes = new Hono<AppEnv>()
  /**
   * Papan pesanan satu cabang. Isinya tiga hal, dan aturannya sengaja tidak
   * seragam:
   *
   * 1. **Bill yang masih berjalan — APA PUN tanggalnya.** Pekerjaan yang belum
   *    selesai tak boleh lenyap dari layar dapur hanya karena hari berganti.
   * 2. **Bill yang DIBATALKAN pada tanggal yang diminta.** Tanpa ini kolom
   *    "Batal" tak akan pernah berisi bill: membatalkan juga menutupnya, jadi
   *    kartunya akan raib tepat saat orang menekan tombolnya.
   * 3. **Penjualan pada tanggal yang diminta** (belum dihapus).
   *
   * Bill yang sudah menjadi penjualan (`sale_id` terisi) tak pernah ikut —
   * kartu penjualannyalah yang mewakilinya, kalau tidak satu pesanan tampil dua
   * kali sepanjang hari.
   *
   * Item disertakan inline: papan menampilkan isi tiap pesanan, dan memuatnya
   * satu per satu lewat `GET /penjualan/:id` akan jadi N+1 pada jam ramai —
   * persis saat halaman ini paling dibutuhkan.
   */
  .get(
    "/",
    zValidator(
      "query",
      z.object({
        branch_id: z.string().uuid().optional(),
        tanggal: z.string().optional(),
        status: z.enum(["dikerjakan", "selesai", "batal"]).optional(),
      }),
    ),
    async (c) => {
      const auth = c.get("auth");
      const branchId = await resolveBranchId(c);
      const q = c.req.valid("query");
      const tz = await tzPerusahaan(auth.company_id!);
      const tanggal = q.tanggal ?? tanggalDi(tz);

      // ── Bill: masih berjalan (kapan pun) atau dibatalkan pada tanggal ini
      const billRows = await db
        .select({
          id: openBills.id,
          meja: openBills.mejaLabel,
          customer: openBills.customerNama,
          waktu: openBills.createdAt,
          catatan: openBills.catatan,
          status: openBills.pesananStatus,
          sajianTakeaway: openBills.sajianTakeaway,
          statusPada: openBills.pesananStatusAt,
          statusOleh: users.nama,
        })
        .from(openBills)
        .leftJoin(users, eq(openBills.pesananStatusOleh, users.id))
        .where(
          and(
            eq(openBills.companyId, auth.company_id!),
            eq(openBills.branchId, branchId),
            // sudah jadi penjualan → diwakili kartu penjualannya, bukan dua kartu
            isNull(openBills.saleId),
            or(
              isNull(openBills.closedAt),
              sql`(${openBills.createdAt} AT TIME ZONE ${tz})::date = ${tanggal}::date`,
            ),
          ),
        )
        .orderBy(desc(openBills.createdAt));

      // ── Penjualan tanggal itu
      const saleRows = await db
        .select({
          id: sales.id,
          nomor: sales.nomor,
          meja: sales.mejaLabel,
          customer: sales.customerNama,
          waktu: sales.waktu,
          total: sales.total,
          isDineIn: sales.isDineIn,
          catatan: sales.catatan,
          status: sales.pesananStatus,
          sajianTakeaway: sales.sajianTakeaway,
          statusPada: sales.pesananStatusAt,
          statusOleh: users.nama,
        })
        .from(sales)
        .leftJoin(users, eq(sales.pesananStatusOleh, users.id))
        .where(
          and(
            eq(sales.companyId, auth.company_id!),
            eq(sales.branchId, branchId),
            eq(sales.saleDate, tanggal),
            isNull(sales.deletedAt),
          ),
        )
        .orderBy(desc(sales.waktu));

      // ── Item kedua sumber, sekali jalan
      const billIds = billRows.map((r) => r.id);
      const saleIds = saleRows.map((r) => r.id);
      const itemBill = new Map<string, PesananItemRow[]>();
      const totalBill = new Map<string, number>();
      if (billIds.length > 0) {
        const rows = await db
          .select({
            billId: openBillItems.billId,
            nama: openBillItems.menuNama,
            qty: openBillItems.qty,
            harga: openBillItems.hargaSatuan,
            catatan: openBillItems.catatan,
            dineInOverride: openBillItems.dineInOverride,
          })
          .from(openBillItems)
          .where(inArray(openBillItems.billId, billIds));
        for (const r of rows) {
          const arr = itemBill.get(r.billId) ?? [];
          arr.push({
            nama: r.nama,
            qty: r.qty,
            catatan: r.catatan,
            // null = ikut mode transaksi; bill belum dibayar jadi belum ada
            // keputusan final — tampilkan dine-in sebagai bawaan.
            is_dine_in: r.dineInOverride ?? true,
          });
          itemBill.set(r.billId, arr);
          totalBill.set(r.billId, (totalBill.get(r.billId) ?? 0) + r.harga * r.qty);
        }
      }
      const itemSale = new Map<string, PesananItemRow[]>();
      if (saleIds.length > 0) {
        const rows = await db
          .select({
            saleId: saleItems.saleId,
            nama: saleItems.menuNama,
            qty: saleItems.qty,
            catatan: saleItems.catatan,
            isDineIn: saleItems.isDineIn,
          })
          .from(saleItems)
          .where(inArray(saleItems.saleId, saleIds));
        for (const r of rows) {
          const arr = itemSale.get(r.saleId) ?? [];
          arr.push({ nama: r.nama, qty: r.qty, catatan: r.catatan, is_dine_in: r.isDineIn });
          itemSale.set(r.saleId, arr);
        }
      }

      const hasil: PesananRow[] = [
        ...billRows.map((r) => ({
          id: r.id,
          jenis: "open_bill" as const,
          nomor: null,
          meja: r.meja,
          customer: r.customer,
          waktu: r.waktu.toISOString(),
          total: totalBill.get(r.id) ?? 0,
          dibayar: false,
          status: r.status,
          sajian_takeaway: r.sajianTakeaway,
          is_dine_in: true,
          catatan: r.catatan,
          items: itemBill.get(r.id) ?? [],
          status_oleh: r.statusOleh ?? null,
          status_pada: r.statusPada ? r.statusPada.toISOString() : null,
        })),
        ...saleRows.map((r) => ({
          id: r.id,
          jenis: "penjualan" as const,
          nomor: r.nomor,
          meja: r.meja,
          customer: r.customer,
          waktu: r.waktu.toISOString(),
          total: r.total,
          dibayar: true,
          status: r.status,
          sajian_takeaway: r.sajianTakeaway,
          is_dine_in: r.isDineIn,
          catatan: r.catatan,
          items: itemSale.get(r.id) ?? [],
          status_oleh: r.statusOleh ?? null,
          status_pada: r.statusPada ? r.statusPada.toISOString() : null,
        })),
      ]
        .filter((r) => !q.status || r.status === q.status)
        // terbaru di atas: yang baru masuk paling perlu dilihat dapur
        .sort((a, b) => b.waktu.localeCompare(a.waktu));

      return c.json(hasil);
    },
  )
  /**
   * Ubah status pengerjaan. Guard balapan ada di klausa WHERE: dua orang di
   * dapur menekan tombol bersamaan → yang kedua tidak menimpa yang pertama,
   * dan mendapat 409 supaya layarnya menyegarkan diri.
   */
  .post(
    "/:jenis/:id/status",
    zValidator("json", z.object({ status: z.enum(["dikerjakan", "selesai", "batal"]) })),
    async (c) => {
      const auth = c.get("auth");
      const branchId = await resolveBranchId(c);
      const jenis = JenisParam.parse(c.req.param("jenis"));
      const id = c.req.param("id");
      const status = c.req.valid("json").status;
      const sekarang = new Date();

      if (jenis === "open_bill") {
        const [row] = await db
          .select({ status: openBills.pesananStatus, saleId: openBills.saleId })
          .from(openBills)
          .where(
            and(
              eq(openBills.id, id),
              eq(openBills.companyId, auth.company_id!),
              eq(openBills.branchId, branchId),
            ),
          );
        if (!row) throw new HTTPException(404, { message: "Pesanan tidak ditemukan" });
        // Bill yang sudah dibayar hidup sebagai penjualan; menandainya di sini
        // akan mengubah kartu yang tak lagi tampil dan meninggalkan kartu
        // penjualannya tak tersentuh.
        if (row.saleId) {
          throw new HTTPException(409, {
            message: "Pesanan sudah dibayar — ubah statusnya lewat kartu penjualan",
          });
        }
        if (row.status === status) return c.json({ ok: true, status });
        const ubah = await db
          .update(openBills)
          .set({
            pesananStatus: status,
            pesananStatusAt: sekarang,
            pesananStatusOleh: auth.sub,
            // Batal = tutup bill: hilang dari pemilih kasir supaya tak bisa
            // ditagihkan. Keluar dari batal membukanya kembali — tanpa ini bill
            // yang "dibatalkan lalu ternyata jadi" mustahil ditagih selamanya.
            closedAt: status === "batal" ? sekarang : null,
          })
          .where(and(eq(openBills.id, id), eq(openBills.pesananStatus, row.status)))
          .returning({ id: openBills.id });
        if (ubah.length === 0) {
          throw new HTTPException(409, {
            message: "Status pesanan baru saja diubah orang lain — muat ulang papan",
          });
        }
        await db.insert(pesananLogs).values({
          companyId: auth.company_id!,
          branchId,
          openBillId: id,
          aksi: LABEL_STATUS[status],
          statusLama: row.status,
          statusBaru: status,
          userId: auth.sub,
        });
        return c.json({ ok: true, status });
      }

      const [row] = await db
        .select({ status: sales.pesananStatus })
        .from(sales)
        .where(
          and(
            eq(sales.id, id),
            eq(sales.companyId, auth.company_id!),
            eq(sales.branchId, branchId),
            isNull(sales.deletedAt),
          ),
        );
      if (!row) throw new HTTPException(404, { message: "Pesanan tidak ditemukan" });
      if (row.status === status) return c.json({ ok: true, status });
      const ubah = await db
        .update(sales)
        .set({ pesananStatus: status, pesananStatusAt: sekarang, pesananStatusOleh: auth.sub })
        .where(and(eq(sales.id, id), eq(sales.pesananStatus, row.status)))
        .returning({ id: sales.id });
      if (ubah.length === 0) {
        throw new HTTPException(409, {
          message: "Status pesanan baru saja diubah orang lain — muat ulang papan",
        });
      }
      await db.insert(pesananLogs).values({
        companyId: auth.company_id!,
        branchId,
        saleId: id,
        aksi: LABEL_STATUS[status],
        statusLama: row.status,
        statusBaru: status,
        userId: auth.sub,
      });
      return c.json({ ok: true, status });
    },
  )
  /**
   * Tandai penyajian bawa pulang / makan di tempat.
   *
   * PENANDA SAJA. `is_dine_in`, `sale_consumptions`, dan `hpp_satuan` tidak
   * disentuh — angka-angka itu sudah dibukukan saat transaksi dibuat, dan
   * mengubahnya di sini membuat baris penjualan berbohong tentang pemakaian
   * bahannya sendiri. Yang berubah hanya instruksi untuk yang menyajikan.
   */
  .post(
    "/:jenis/:id/sajian",
    zValidator("json", z.object({ takeaway: z.boolean() })),
    async (c) => {
      const auth = c.get("auth");
      const branchId = await resolveBranchId(c);
      const jenis = JenisParam.parse(c.req.param("jenis"));
      const id = c.req.param("id");
      const takeaway = c.req.valid("json").takeaway;
      const aksi = takeaway ? "Diubah jadi bawa pulang" : "Dikembalikan jadi makan di tempat";

      if (jenis === "open_bill") {
        const ubah = await db
          .update(openBills)
          .set({ sajianTakeaway: takeaway })
          .where(
            and(
              eq(openBills.id, id),
              eq(openBills.companyId, auth.company_id!),
              eq(openBills.branchId, branchId),
              // sudah dibayar → penanda penyajiannya milik kartu penjualan
              isNull(openBills.saleId),
            ),
          )
          .returning({ id: openBills.id });
        if (ubah.length === 0) throw new HTTPException(404, { message: "Pesanan tidak ditemukan" });
        await db.insert(pesananLogs).values({
          companyId: auth.company_id!,
          branchId,
          openBillId: id,
          aksi,
          userId: auth.sub,
        });
        return c.json({ ok: true, sajian_takeaway: takeaway });
      }

      const ubah = await db
        .update(sales)
        .set({ sajianTakeaway: takeaway })
        .where(
          and(
            eq(sales.id, id),
            eq(sales.companyId, auth.company_id!),
            eq(sales.branchId, branchId),
            isNull(sales.deletedAt),
          ),
        )
        .returning({ id: sales.id });
      if (ubah.length === 0) throw new HTTPException(404, { message: "Pesanan tidak ditemukan" });
      await db.insert(pesananLogs).values({
        companyId: auth.company_id!,
        branchId,
        saleId: id,
        aksi,
        userId: auth.sub,
      });
      return c.json({ ok: true, sajian_takeaway: takeaway });
    },
  )
  /**
   * Riwayat perubahan status satu pesanan — "siapa menandai apa, kapan".
   *
   * Untuk pesanan yang lahir dari open bill, riwayat bill-nya ikut disertakan
   * lewat `asal_open_bill_id`; tanpa itu jejak sebelum pembayaran hilang dari
   * pandangan padahal barisnya masih ada.
   */
  .get("/:jenis/:id/log", async (c) => {
    const auth = c.get("auth");
    const branchId = await resolveBranchId(c);
    const jenis = JenisParam.parse(c.req.param("jenis"));
    const id = c.req.param("id");

    if (jenis === "open_bill") {
      const [ada] = await db
        .select({ id: openBills.id })
        .from(openBills)
        .where(
          and(
            eq(openBills.id, id),
            eq(openBills.companyId, auth.company_id!),
            eq(openBills.branchId, branchId),
          ),
        );
      if (!ada) throw new HTTPException(404, { message: "Pesanan tidak ditemukan" });
      return c.json(await riwayat("bill", id));
    }

    const [sale] = await db
      .select({ id: sales.id, asal: sales.asalOpenBillId })
      .from(sales)
      .where(
        and(
          eq(sales.id, id),
          eq(sales.companyId, auth.company_id!),
          eq(sales.branchId, branchId),
          isNull(sales.deletedAt),
        ),
      );
    if (!sale) throw new HTTPException(404, { message: "Pesanan tidak ditemukan" });
    const baris = await riwayat("sale", id);
    if (sale.asal) baris.push(...(await riwayat("bill", sale.asal)));
    baris.sort((a, b) => b.waktu.localeCompare(a.waktu));
    return c.json(baris satisfies PesananLogRow[]);
  });

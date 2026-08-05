import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  qtyDitagih,
  ringkasPesanan,
  turunkanStatusPesanan,
  urutkanPesanan,
  type PesananItemRow,
  type PesananLogRow,
  type PesananRow,
  type PesananStatus,
} from "@kakarut/shared";
import { db, type Tx } from "../../db/client";
import {
  companies,
  meja,
  openBillItems,
  openBills,
  pesananLogs,
  saleItems,
  sales,
  users,
} from "../../db/schema";
import { resolveBranchId, type AppEnv } from "../../middleware/auth";
import { tanggalDi } from "../../lib/time";
import {
  barisBerpindah,
  hitungUlangBiayaPenjualan,
  type HasilRekalkulasi,
} from "../penjualan/rekalkulasi";

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
 * mewarisi status & penanda penyajian TIAP BARIS, jadi papan tetap menampilkan
 * satu kartu dan pekerjaan yang sudah selesai tidak kembali ke antrean.
 *
 * SATUAN KERJANYA ADALAH BARIS, BUKAN KARTU. Satu bill berisi banyak sajian
 * yang selesai pada waktu berbeda; dengan status setingkat kartu dapur hanya
 * bisa bilang "semua atau tak satu pun", dan tak ada cara tahu mana yang sudah
 * keluar. Status kartu DITURUNKAN dari barisnya saat dibaca — bukan disimpan —
 * supaya tak ada agregat yang bisa ketinggalan zaman.
 */

/** Label aksi siap tampil untuk baris riwayat. */
const LABEL_STATUS: Record<PesananStatus, string> = {
  dikerjakan: "Dikembalikan ke antrean",
  selesai: "Ditandai selesai",
  batal: "Dibatalkan",
};

const JenisParam = z.enum(["open_bill", "penjualan"]);
const StatusBody = z.object({ status: z.enum(["dikerjakan", "selesai", "batal"]) });
const SajianBody = z.object({ takeaway: z.boolean() });

/**
 * Jejak perpindahan biaya untuk baris riwayat — mengubah penyajian sebuah
 * pesanan yang SUDAH DIBAYAR menggeser HPP dan stok kemasan, jadi angkanya
 * harus ikut tercatat "siapa mengubah apa" bukan cuma labelnya.
 *
 * `null` = open bill (belum ada biaya terbuku, tak ada yang digeser).
 */
function jejakBiaya(hasil: HasilRekalkulasi | null): string {
  if (!hasil) return "";
  if (hasil.alasanGagal) return ` (HPP tidak dihitung ulang: ${hasil.alasanGagal})`;
  if (hasil.hppLama === hasil.hppBaru) return "";
  const rp = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;
  return ` (HPP ${rp(hasil.hppLama)} → ${rp(hasil.hppBaru)})`;
}

/**
 * Status kartu = turunan barisnya.
 *
 * - semua baris `batal` → kartu `batal` (tak ada yang perlu dibuat lagi)
 * - tak ada lagi baris `dikerjakan` → kartu `selesai` (sisanya sudah keluar
 *   atau dibatalkan; dapur tak punya pekerjaan tersisa)
 * - selain itu `dikerjakan`
 *
 * Kartu tanpa baris dianggap `dikerjakan`: kalau tidak, bill kosong yang baru
 * dibuat kasir akan langsung mendarat di kolom Selesai.
 *
 * Aturannya tinggal di `@kakarut/shared` karena web ikut memakainya saat
 * memperbarui kartu secara optimistis — dua salinan berarti papan bisa
 * menampilkan kolom yang berbeda dari yang dikirim server.
 */
const turunkanStatus = turunkanStatusPesanan;

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
    .select({
      waktu: pesananLogs.waktu,
      aksi: pesananLogs.aksi,
      itemNama: pesananLogs.itemNama,
      oleh: users.nama,
    })
    .from(pesananLogs)
    .leftJoin(users, eq(pesananLogs.userId, users.id))
    .where(kolom === "sale" ? eq(pesananLogs.saleId, id) : eq(pesananLogs.openBillId, id))
    .orderBy(desc(pesananLogs.waktu))
    .limit(200);
  return rows.map((r) => ({
    waktu: r.waktu.toISOString(),
    aksi: r.aksi,
    oleh: r.oleh ?? null,
    item_nama: r.itemNama ?? null,
  }));
}

/**
 * Bill yang seluruh barisnya batal = bill selesai urusannya: ia harus lenyap
 * dari pemilih kasir supaya tak bisa ditagihkan. Sebaliknya, satu baris yang
 * dikembalikan ke antrean membukanya lagi — tanpa ini bill "dibatalkan lalu
 * ternyata jadi" mustahil ditagih selamanya.
 *
 * `sale_id IS NULL` di klausa WHERE menjaga bill yang sudah DIBAYAR: penutupan
 * miliknya berasal dari `createSale`, dan tak boleh dibuka lagi oleh papan.
 */
async function selaraskanTutupBill(
  tx: Tx,
  billId: string,
  sekarang: Date,
  ctx: { companyId: string; branchId: string; userId: string },
): Promise<PesananStatus> {
  const rows = await tx
    .select({ status: openBillItems.pesananStatus })
    .from(openBillItems)
    .where(eq(openBillItems.billId, billId));
  const kartu = turunkanStatus(rows);

  /**
   * MEMBUKA KEMBALI bill boleh menabrak "satu meja dine-in = satu bill".
   *
   * Urutannya wajar dan seluruhnya lewat tombol yang sah:
   *
   *   1. Bill A di Meja 5 dibatalkan (tamunya batal / salah input).
   *   2. Tamu baru duduk di Meja 5, kasir membuka Bill B — DIIZINKAN, karena
   *      penjaga di `POST /open-bill` hanya melihat bill yang `closed_at`-nya
   *      masih kosong, dan A sudah tertutup.
   *   3. Di papan, satu baris Bill A dikembalikan ke antrean — ternyata
   *      pesanannya jadi. Bill A hidup lagi, MASIH menempel di Meja 5.
   *
   * Hasilnya dua bill hidup di satu meja dine-in: persis keadaan yang dijaga
   * sampai `SELECT … FOR UPDATE` di dua tempat, dan yang risikonya justru satu
   * bill tertinggal tak tertagih saat tamunya pulang.
   *
   * Yang DIPILIH: bill-nya tetap dibuka (itu inti fiturnya — "dibatalkan lalu
   * ternyata jadi" tak boleh mustahil ditagih), tapi ia dilepas dari mejanya
   * dan pelepasannya dicatat. Alasannya: menolak pembukaan akan menggagalkan
   * tombol dapur karena bentrok meja yang dapur tak bisa selesaikan, sementara
   * memasangnya kembali ke meja adalah pekerjaan kasir — dan jalur itu sudah
   * ada dan sudah dijaga (`PUT /open-bill/:id` membalas `meja_sudah_ada_bill`
   * bila mejanya masih terisi).
   *
   * Hanya berlaku pada transisi tertutup → terbuka, hanya untuk meja
   * `dine_in`, dan hanya bila memang ada bill lain yang hidup di sana. Di luar
   * itu bill tetap memegang mejanya seperti biasa.
   */
  const [sebelum] = await tx
    .select({
      closedAt: openBills.closedAt,
      mejaId: openBills.mejaId,
      mejaLabel: openBills.mejaLabel,
      branchId: openBills.branchId,
    })
    .from(openBills)
    .where(and(eq(openBills.id, billId), isNull(openBills.saleId)));

  let lepasMeja = false;
  if (sebelum?.closedAt && kartu !== "batal" && sebelum.mejaId) {
    const [m] = await tx
      .select({ tipe: meja.tipe })
      .from(meja)
      .where(eq(meja.id, sebelum.mejaId));
    if (m?.tipe === "dine_in") {
      const [bentrok] = await tx
        .select({ id: openBills.id })
        .from(openBills)
        .where(
          and(
            eq(openBills.companyId, ctx.companyId),
            eq(openBills.branchId, sebelum.branchId),
            eq(openBills.mejaId, sebelum.mejaId),
            isNull(openBills.closedAt),
            ne(openBills.id, billId),
          ),
        )
        .limit(1);
      lepasMeja = bentrok != null;
    }
  }

  await tx
    .update(openBills)
    .set({
      closedAt: kartu === "batal" ? sekarang : null,
      ...(lepasMeja ? { mejaId: null, mejaLabel: null } : {}),
    })
    .where(and(eq(openBills.id, billId), isNull(openBills.saleId)));

  if (lepasMeja) {
    await tx.insert(pesananLogs).values({
      companyId: ctx.companyId,
      branchId: ctx.branchId,
      openBillId: billId,
      aksi: `Dibuka kembali & dilepas dari ${sebelum!.mejaLabel ?? "mejanya"} — meja itu sudah dipakai bill lain; pasang ulang mejanya dari kasir`,
      statusBaru: kartu,
      userId: ctx.userId,
    });
  }
  return kartu;
}

/** Pastikan kartunya ada, milik perusahaan & cabang penggunanya. */
async function pastikanKartu(
  jenis: "open_bill" | "penjualan",
  id: string,
  companyId: string,
  branchId: string,
  { untukUbah }: { untukUbah: boolean },
): Promise<void> {
  if (jenis === "open_bill") {
    const [row] = await db
      .select({ saleId: openBills.saleId })
      .from(openBills)
      .where(
        and(
          eq(openBills.id, id),
          eq(openBills.companyId, companyId),
          eq(openBills.branchId, branchId),
        ),
      );
    if (!row) throw new HTTPException(404, { message: "Pesanan tidak ditemukan" });
    // Bill yang sudah dibayar hidup sebagai penjualan; menandainya di sini akan
    // mengubah kartu yang tak lagi tampil dan meninggalkan kartu penjualannya
    // tak tersentuh.
    if (untukUbah && row.saleId) {
      throw new HTTPException(409, {
        message: "Pesanan sudah dibayar — ubah statusnya lewat kartu penjualan",
      });
    }
    return;
  }
  const [row] = await db
    .select({ id: sales.id })
    .from(sales)
    .where(
      and(
        eq(sales.id, id),
        eq(sales.companyId, companyId),
        eq(sales.branchId, branchId),
        isNull(sales.deletedAt),
      ),
    );
  if (!row) throw new HTTPException(404, { message: "Pesanan tidak ditemukan" });
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
   * Item disertakan inline: papan menampilkan isi tiap pesanan DAN status tiap
   * barisnya, dan memuatnya satu per satu lewat `GET /penjualan/:id` akan jadi
   * N+1 pada jam ramai — persis saat halaman ini paling dibutuhkan.
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
        })
        .from(openBills)
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
        })
        .from(sales)
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
            id: openBillItems.id,
            nama: openBillItems.menuNama,
            qty: openBillItems.qty,
            harga: openBillItems.hargaSatuan,
            catatan: openBillItems.catatan,
            dineInOverride: openBillItems.dineInOverride,
            status: openBillItems.pesananStatus,
            sajianTakeaway: openBillItems.sajianTakeaway,
            statusPada: openBillItems.pesananStatusAt,
            statusOleh: users.nama,
          })
          .from(openBillItems)
          .leftJoin(users, eq(openBillItems.pesananStatusOleh, users.id))
          .where(inArray(openBillItems.billId, billIds));
        for (const r of rows) {
          const arr = itemBill.get(r.billId) ?? [];
          arr.push({
            id: r.id,
            nama: r.nama,
            qty: r.qty,
            // Bill belum dibayar → belum ada uang yang bisa dikembalikan.
            // Pembatalan barisnya diungkapkan lewat `status: "batal"`.
            qty_refund: 0,
            catatan: r.catatan,
            // null = ikut mode transaksi; bill belum dibayar jadi belum ada
            // keputusan final — tampilkan dine-in sebagai bawaan.
            is_dine_in: r.dineInOverride ?? true,
            status: r.status,
            sajian_takeaway: r.sajianTakeaway,
            status_oleh: r.statusOleh ?? null,
            status_pada: r.statusPada ? r.statusPada.toISOString() : null,
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
            id: saleItems.id,
            nama: saleItems.menuNama,
            qty: saleItems.qty,
            qtyRefund: saleItems.qtyRefund,
            catatan: saleItems.catatan,
            isDineIn: saleItems.isDineIn,
            status: saleItems.pesananStatus,
            sajianTakeaway: saleItems.sajianTakeaway,
            statusPada: saleItems.pesananStatusAt,
            statusOleh: users.nama,
          })
          .from(saleItems)
          .leftJoin(users, eq(saleItems.pesananStatusOleh, users.id))
          .where(inArray(saleItems.saleId, saleIds));
        for (const r of rows) {
          const arr = itemSale.get(r.saleId) ?? [];
          arr.push({
            id: r.id,
            nama: r.nama,
            // PORSI YANG DITAGIH. Sajian yang uangnya sudah dikembalikan tak
            // jadi dibuat — bahannya habis, itu justru sebab refundnya. Mengirim
            // `qty` mentah membuat papan menyuruh dapur memasak porsi yang sudah
            // dibatalkan, dan porsi itu tak pernah dibayar siapa pun.
            qty: qtyDitagih(r),
            qty_refund: r.qtyRefund,
            catatan: r.catatan,
            is_dine_in: r.isDineIn,
            status: r.status,
            sajian_takeaway: r.sajianTakeaway,
            status_oleh: r.statusOleh ?? null,
            status_pada: r.statusPada ? r.statusPada.toISOString() : null,
          });
          itemSale.set(r.saleId, arr);
        }
      }

      /**
       * Ringkasan kartu — seluruhnya turunan barisnya, tak satu pun disimpan.
       * Implementasinya di `@kakarut/shared` supaya web bisa memakai aturan yang
       * SAMA saat memperbarui kartu secara optimistis.
       */
      const ringkas = ringkasPesanan;

      const hasil: PesananRow[] = urutkanPesanan([
        ...billRows.map((r) => {
          const items = itemBill.get(r.id) ?? [];
          return {
            id: r.id,
            jenis: "open_bill" as const,
            nomor: null,
            meja: r.meja,
            customer: r.customer,
            waktu: r.waktu.toISOString(),
            total: totalBill.get(r.id) ?? 0,
            dibayar: false,
            is_dine_in: true,
            catatan: r.catatan,
            items,
            ...ringkas(items),
          };
        }),
        ...saleRows.map((r) => {
          const items = itemSale.get(r.id) ?? [];
          return {
            id: r.id,
            jenis: "penjualan" as const,
            nomor: r.nomor,
            meja: r.meja,
            customer: r.customer,
            waktu: r.waktu.toISOString(),
            total: r.total,
            dibayar: true,
            is_dine_in: r.isDineIn,
            catatan: r.catatan,
            items,
            ...ringkas(items),
          };
        }),
      ]).filter((r) => !q.status || r.status === q.status);

      return c.json(hasil);
    },
  )
  /**
   * Ubah status SATU BARIS — tombol utama papan.
   *
   * Guard balapan ada di klausa WHERE: dua orang di dapur menekan tombol baris
   * yang sama → yang kedua tidak menimpa yang pertama, dan mendapat 409 supaya
   * layarnya menyegarkan diri.
   */
  .post(
    "/:jenis/:id/item/:itemId/status",
    zValidator("json", StatusBody),
    async (c) => {
      const auth = c.get("auth");
      const branchId = await resolveBranchId(c);
      const jenis = JenisParam.parse(c.req.param("jenis"));
      const id = c.req.param("id");
      const itemId = c.req.param("itemId");
      const status = c.req.valid("json").status;
      const sekarang = new Date();
      await pastikanKartu(jenis, id, auth.company_id!, branchId, { untukUbah: true });

      if (jenis === "open_bill") {
        const hasil = await db.transaction(async (tx) => {
          const [baris] = await tx
            .select({ nama: openBillItems.menuNama, status: openBillItems.pesananStatus })
            .from(openBillItems)
            .where(and(eq(openBillItems.id, itemId), eq(openBillItems.billId, id)));
          if (!baris) throw new HTTPException(404, { message: "Baris pesanan tidak ditemukan" });
          if (baris.status !== status) {
            const ubah = await tx
              .update(openBillItems)
              .set({
                pesananStatus: status,
                pesananStatusAt: sekarang,
                pesananStatusOleh: auth.sub,
              })
              .where(
                and(eq(openBillItems.id, itemId), eq(openBillItems.pesananStatus, baris.status)),
              )
              .returning({ id: openBillItems.id });
            if (ubah.length === 0) {
              throw new HTTPException(409, {
                message: "Status baris ini baru saja diubah orang lain — muat ulang papan",
              });
            }
            await tx.insert(pesananLogs).values({
              companyId: auth.company_id!,
              branchId,
              openBillId: id,
              aksi: LABEL_STATUS[status],
              itemNama: baris.nama,
              statusLama: baris.status,
              statusBaru: status,
              userId: auth.sub,
            });
          }
          return {
            kartu: await selaraskanTutupBill(tx, id, sekarang, {
            companyId: auth.company_id!,
            branchId,
            userId: auth.sub,
          }),
          };
        });
        return c.json({ ok: true, status, kartu_status: hasil.kartu });
      }

      const hasil = await db.transaction(async (tx) => {
        const [baris] = await tx
          .select({ nama: saleItems.menuNama, status: saleItems.pesananStatus })
          .from(saleItems)
          .where(and(eq(saleItems.id, itemId), eq(saleItems.saleId, id)));
        if (!baris) throw new HTTPException(404, { message: "Baris pesanan tidak ditemukan" });
        if (baris.status !== status) {
          const ubah = await tx
            .update(saleItems)
            .set({ pesananStatus: status, pesananStatusAt: sekarang, pesananStatusOleh: auth.sub })
            .where(and(eq(saleItems.id, itemId), eq(saleItems.pesananStatus, baris.status)))
            .returning({ id: saleItems.id });
          if (ubah.length === 0) {
            throw new HTTPException(409, {
              message: "Status baris ini baru saja diubah orang lain — muat ulang papan",
            });
          }
          await tx.insert(pesananLogs).values({
            companyId: auth.company_id!,
            branchId,
            saleId: id,
            aksi: LABEL_STATUS[status],
            itemNama: baris.nama,
            statusLama: baris.status,
            statusBaru: status,
            userId: auth.sub,
          });
        }
        const rows = await tx
          .select({ status: saleItems.pesananStatus })
          .from(saleItems)
          .where(eq(saleItems.saleId, id));
        return { kartu: turunkanStatus(rows) };
      });
      return c.json({ ok: true, status, kartu_status: hasil.kartu });
    },
  )
  /**
   * Tandai penyajian SATU BARIS bawa pulang / makan di tempat.
   *
   * `is_dine_in` TIDAK disentuh — itu fakta pembukuan (di mana pesanan dimakan;
   * dasar pemisahan omzet dan label meja pada struk). Yang berubah adalah
   * BASIS BIAYA-nya: sebuah porsi yang dibungkus benar-benar memakai kemasan
   * take away, jadi:
   *
   * - open bill (belum dibayar): tak ada yang dihitung ulang di sini. Belum ada
   *   biaya terbuku; penandanya ikut ke baris penjualan saat dibayar dan
   *   `createSale` memakainya sebagai basis biaya.
   * - penjualan (sudah dibayar): `hpp_satuan`, `sales.total_hpp`, dan
   *   `sale_consumptions` DIHITUNG ULANG (lihat `hitungUlangBiayaPenjualan`) —
   *   supaya laba-rugi memakai biaya yang benar dan stok kemasan berkurang.
   */
  .post(
    "/:jenis/:id/item/:itemId/sajian",
    zValidator("json", SajianBody),
    async (c) => {
      const auth = c.get("auth");
      const branchId = await resolveBranchId(c);
      const jenis = JenisParam.parse(c.req.param("jenis"));
      const id = c.req.param("id");
      const itemId = c.req.param("itemId");
      const takeaway = c.req.valid("json").takeaway;
      const aksi = takeaway ? "Diubah jadi bawa pulang" : "Dikembalikan jadi makan di tempat";
      await pastikanKartu(jenis, id, auth.company_id!, branchId, { untukUbah: true });

      const hasil = await db.transaction(async (tx) => {
        if (jenis === "open_bill") {
          const [baris] = await tx
            .update(openBillItems)
            .set({ sajianTakeaway: takeaway })
            .where(and(eq(openBillItems.id, itemId), eq(openBillItems.billId, id)))
            .returning({ nama: openBillItems.menuNama });
          if (!baris) throw new HTTPException(404, { message: "Baris pesanan tidak ditemukan" });
          return { nama: baris.nama, biaya: null };
        }
        // Nilai LAMA dibaca dulu: menandai TA sebuah baris yang memang sudah TA
        // bukan perpindahan basis, dan melaporkannya sebagai perpindahan akan
        // menambahkan biaya kemasan untuk kedua kalinya.
        const [baris] = await tx
          .select({ nama: saleItems.menuNama, ta: saleItems.sajianTakeaway })
          .from(saleItems)
          .where(and(eq(saleItems.id, itemId), eq(saleItems.saleId, id)));
        if (!baris) throw new HTTPException(404, { message: "Baris pesanan tidak ditemukan" });
        await tx
          .update(saleItems)
          .set({ sajianTakeaway: takeaway })
          .where(and(eq(saleItems.id, itemId), eq(saleItems.saleId, id)));
        return {
          nama: baris.nama,
          // Hanya baris ini yang mungkin berpindah; harga pokok baris lain
          // tetap angka historisnya.
          biaya: await hitungUlangBiayaPenjualan(
            tx,
            id,
            auth.company_id!,
            barisBerpindah([{ id: itemId, sajianTakeaway: baris.ta }], takeaway),
          ),
        };
      });

      await db.insert(pesananLogs).values({
        companyId: auth.company_id!,
        branchId,
        ...(jenis === "open_bill" ? { openBillId: id } : { saleId: id }),
        aksi: `${aksi}${jejakBiaya(hasil.biaya)}`,
        itemNama: hasil.nama,
        userId: auth.sub,
      });
      return c.json({
        ok: true,
        sajian_takeaway: takeaway,
        total_hpp: hasil.biaya?.hppBaru ?? null,
      });
    },
  )
  /**
   * Ubah status SELURUH baris sekaligus — pintasan "pesanan ini kelar semua".
   *
   * Sengaja TANPA guard balapan: perintahnya bukan "ubah dari X ke Y" melainkan
   * "jadikan semuanya Y", jadi dua orang yang menekannya bersamaan sampai di
   * hasil yang sama. Yang butuh guard adalah tombol per baris, karena di sanalah
   * dua orang bisa punya maksud berbeda atas satu sajian.
   *
   * SATU PENGECUALIAN: `selesai` TIDAK menyentuh baris yang sudah `batal`.
   * Menandai sebuah pesanan kelar bukan alasan untuk menghidupkan lagi sajian
   * yang dibatalkan — porsinya tak pernah keluar dari dapur, dan membuatnya
   * "selesai" membuat papan berbohong tentang apa yang benar-benar disajikan.
   * Kartunya tetap pindah ke kolom Selesai, karena status kartu hanya menuntut
   * tak ada lagi baris `dikerjakan`.
   */
  .post("/:jenis/:id/status", zValidator("json", StatusBody), async (c) => {
    const auth = c.get("auth");
    const branchId = await resolveBranchId(c);
    const jenis = JenisParam.parse(c.req.param("jenis"));
    const id = c.req.param("id");
    const status = c.req.valid("json").status;
    const sekarang = new Date();
    await pastikanKartu(jenis, id, auth.company_id!, branchId, { untukUbah: true });

    const kartu = await db.transaction(async (tx) => {
      /**
       * Baris mana yang ikut berubah. Untuk `selesai` hanya yang masih
       * `dikerjakan` — baris `batal` dibiarkan (lihat catatan di atas). Untuk
       * status lain: semua yang belum bernilai itu.
       */
      const sasaran = (kolom: typeof openBillItems.pesananStatus | typeof saleItems.pesananStatus) =>
        status === "selesai"
          ? sql`${kolom} = 'dikerjakan'`
          : sql`${kolom} <> ${status}`;

      if (jenis === "open_bill") {
        const ubah = await tx
          .update(openBillItems)
          .set({ pesananStatus: status, pesananStatusAt: sekarang, pesananStatusOleh: auth.sub })
          .where(and(eq(openBillItems.billId, id), sasaran(openBillItems.pesananStatus)))
          .returning({ id: openBillItems.id });
        if (ubah.length > 0) {
          await tx.insert(pesananLogs).values({
            companyId: auth.company_id!,
            branchId,
            openBillId: id,
            aksi: `${LABEL_STATUS[status]} (${ubah.length} baris)`,
            statusBaru: status,
            userId: auth.sub,
          });
        }
        return await selaraskanTutupBill(tx, id, sekarang, {
          companyId: auth.company_id!,
          branchId,
          userId: auth.sub,
        });
      }
      const ubah = await tx
        .update(saleItems)
        .set({ pesananStatus: status, pesananStatusAt: sekarang, pesananStatusOleh: auth.sub })
        .where(and(eq(saleItems.saleId, id), sasaran(saleItems.pesananStatus)))
        .returning({ id: saleItems.id });
      if (ubah.length > 0) {
        await tx.insert(pesananLogs).values({
          companyId: auth.company_id!,
          branchId,
          saleId: id,
          aksi: `${LABEL_STATUS[status]} (${ubah.length} baris)`,
          statusBaru: status,
          userId: auth.sub,
        });
      }
      const rows = await tx
        .select({ status: saleItems.pesananStatus })
        .from(saleItems)
        .where(eq(saleItems.saleId, id));
      return turunkanStatus(rows);
    });
    return c.json({ ok: true, status: kartu });
  })
  /**
   * Tandai penyajian SELURUH baris sekaligus. Aturan biaya identik dengan versi
   * per baris — lihat catatan di sana.
   */
  .post("/:jenis/:id/sajian", zValidator("json", SajianBody), async (c) => {
    const auth = c.get("auth");
    const branchId = await resolveBranchId(c);
    const jenis = JenisParam.parse(c.req.param("jenis"));
    const id = c.req.param("id");
    const takeaway = c.req.valid("json").takeaway;
    const aksi = takeaway ? "Diubah jadi bawa pulang" : "Dikembalikan jadi makan di tempat";
    await pastikanKartu(jenis, id, auth.company_id!, branchId, { untukUbah: true });

    const biaya = await db.transaction(async (tx) => {
      if (jenis === "open_bill") {
        await tx
          .update(openBillItems)
          .set({ sajianTakeaway: takeaway })
          .where(eq(openBillItems.billId, id));
        return null;
      }
      // "Semua baris ditulis" bukan "semua baris berubah": pesanan campur —
      // satu porsi sudah dibungkus kasir, sisanya belum — akan kena biaya
      // kemasan dua kali pada baris yang memang sudah bawa pulang. Yang
      // dilaporkan berpindah hanya baris yang nilainya benar-benar beda.
      const lama = await tx
        .select({ id: saleItems.id, sajianTakeaway: saleItems.sajianTakeaway })
        .from(saleItems)
        .where(eq(saleItems.saleId, id));
      await tx.update(saleItems).set({ sajianTakeaway: takeaway }).where(eq(saleItems.saleId, id));
      return await hitungUlangBiayaPenjualan(
        tx,
        id,
        auth.company_id!,
        barisBerpindah(lama, takeaway),
      );
    });

    await db.insert(pesananLogs).values({
      companyId: auth.company_id!,
      branchId,
      ...(jenis === "open_bill" ? { openBillId: id } : { saleId: id }),
      aksi: `${aksi} (semua baris)${jejakBiaya(biaya)}`,
      userId: auth.sub,
    });
    return c.json({ ok: true, sajian_takeaway: takeaway, total_hpp: biaya?.hppBaru ?? null });
  })
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
    await pastikanKartu(jenis, id, auth.company_id!, branchId, { untukUbah: false });

    if (jenis === "open_bill") return c.json(await riwayat("bill", id));

    const [sale] = await db
      .select({ asal: sales.asalOpenBillId })
      .from(sales)
      .where(eq(sales.id, id));
    const baris = await riwayat("sale", id);
    if (sale?.asal) baris.push(...(await riwayat("bill", sale.asal)));
    baris.sort((a, b) => b.waktu.localeCompare(a.waktu));
    return c.json(baris satisfies PesananLogRow[]);
  });

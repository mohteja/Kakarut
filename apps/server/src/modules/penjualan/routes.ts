import { zValidator } from "../../lib/validator";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { db } from "../../db/client";
import { branches, companies, saleItems, sales, shifts, users } from "../../db/schema";
import { qtyDitagih, waktuKertas } from "@kakarut/shared";
import { opsiSlipDariQuery, responsSlip } from "../print/slip";
import {
  branchUntukTulis,
  requireRole,
  resolveBranchId,
  terikatCabang,
  type AppEnv,
} from "../../middleware/auth";
import { tanggalDi } from "../../lib/time";
import {
  clientRefField,
  denganKlaimIdempoten,
  deviceIdField,
} from "../sync/idempoten";
import { refundSajian } from "./refund";
import { createSale, PenjualanGagal } from "./service";

export const SaleBody = z.object({
  branch_id: z.string().uuid().optional(),
  is_dine_in: z.boolean().default(false),
  meja_id: z.string().uuid().optional(),
  catatan: z.string().nullish(),
  /** diskon per transaksi (opsional) */
  diskon_tipe: z.enum(["persen", "nominal"]).optional(),
  diskon_nilai: z.number().nonnegative().optional(),
  /** identitas konsumen/member (opsional) */
  customer_nama: z.string().nullish(),
  customer_wa: z.string().nullish(),
  /** pembayaran */
  metode_bayar: z.enum(["tunai", "qris", "transfer"]).optional(),
  uang_diterima: z.number().nonnegative().optional(),
  /** idempotensi antarjalur (online ↔ /sync) — UUID v4 dari perangkat, opsional */
  client_ref: clientRefField,
  device_id: deviceIdField,
  /**
   * Open bill yang sedang dibayar. Bila diisi, baris ber-`open_bill_item_id`
   * ditagih dengan harga yang DIKUNCI di bill saat dipesan — bukan harga menu
   * hari ini.
   */
  open_bill_id: z.string().uuid().optional(),
  items: z
    .array(
      z.object({
        menu_id: z.string().uuid(),
        qty: z.number().positive(),
        is_dine_in: z.boolean().optional(),
        catatan: z.string().nullish(),
        /** baris asal di open bill — pembawa harga terkunci */
        open_bill_item_id: z.string().uuid().nullish(),
      }),
    )
    .min(1),
});

export const penjualanRoutes = new Hono<AppEnv>()
  // Transaksi POS HANYA peran kasir (owner/admin/tim tak boleh menjual —
  // manajemen memantau lewat Riwayat/Laporan, tak meng-input transaksi).
  .post("/", requireRole("cashier"), zValidator("json", SaleBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    // Idempotensi lintas jalur: bila client_ref ini SUDAH sukses (online sebelumnya
    // atau via /sync), balas sale yang ada — JANGAN buat ulang. Klaimnya diambil
    // PALING AWAL supaya retry (mis. setelah receiveTimeout) tak gagal hanya karena
    // shift sudah ditutup / validasi lain berubah — DAN supaya dua permintaan
    // ber-ref sama yang datang bersamaan tak sama-sama menerbitkan penjualan.
    const { data, baru } = await denganKlaimIdempoten(
      {
        companyId: auth.company_id!,
        clientRef: body.client_ref,
        userId: auth.sub,
        deviceId: body.device_id ?? null,
        tipe: "penjualan",
      },
      async () => {
        const branchId = await branchUntukTulis(
          c,
          body.branch_id,
          "Kasir hanya boleh transaksi di cabangnya",
        );
        // Kasir wajib DIBUKA dulu: tanpa shift terbuka di cabang, transaksi ditolak
        // (409) — frontend menampilkan modal "Buka Kasir".
        const [shiftAktif] = await db
          .select({ id: shifts.id })
          .from(shifts)
          .where(
            and(
              eq(shifts.companyId, auth.company_id!),
              eq(shifts.branchId, branchId),
              isNull(shifts.closedAt),
            ),
          );
        if (!shiftAktif) {
          throw new PenjualanGagal(
            409,
            "Kasir belum dibuka — buka kasir dulu sebelum bertransaksi",
            "kasir_belum_dibuka",
          );
        }
        const result = await createSale({
          companyId: auth.company_id!,
          branchId,
          cashierUserId: auth.sub,
          isDineIn: body.is_dine_in,
          mejaId: body.meja_id,
          catatan: body.catatan,
          diskonTipe: body.diskon_tipe,
          diskonNilai: body.diskon_nilai,
          customerNama: body.customer_nama,
          customerWa: body.customer_wa,
          metodeBayar: body.metode_bayar,
          uangDiterima: body.uang_diterima,
          openBillId: body.open_bill_id,
          items: body.items,
        });
        return { ...result, kasir: auth.nama };
      },
    );
    return c.json(data, baru ? 201 : 200);
  })
  .get("/", async (c) => {
    const auth = c.get("auth");
    // Kantor = pusat data penjualan: owner/admin boleh "?branch_id=all" untuk
    // melihat transaksi SEMUA cabang sekaligus (kasir/tim tetap terkunci).
    const semuaCabang = !terikatCabang(auth.role) && c.req.query("branch_id") === "all";
    const branchId = semuaCabang ? null : await resolveBranchId(c);
    const [company] = await db
      .select({ timezone: companies.timezone })
      .from(companies)
      .where(eq(companies.id, auth.company_id!));
    const tanggalQ = c.req.query("tanggal");
    if (tanggalQ && !/^\d{4}-\d{2}-\d{2}$/.test(tanggalQ)) {
      throw new HTTPException(400, { message: "Format tanggal tidak valid (YYYY-MM-DD)" });
    }
    const tanggal = tanggalQ ?? tanggalDi(company?.timezone ?? "Asia/Jakarta");
    // Riwayat transaksi untuk kasir: cek pesanan / cetak ulang struk.
    const rows = await db
      .select({
        id: sales.id,
        nomor: sales.nomor,
        waktu: sales.waktu,
        total: sales.total,
        is_dine_in: sales.isDineIn,
        // Penanda penyajian hidup PER BARIS sejak papan pesanan jadi per-baris.
        // Riwayat cuma butuh satu badge, jadi diturunkan: "bawa pulang" hanya
        // bila SEMUA barisnya begitu — satu piring yang tetap di tempat sudah
        // cukup membuat pesanan ini bukan pesanan bawa pulang.
        sajian_takeaway: sql<boolean>`COALESCE((SELECT bool_and(si.sajian_takeaway) FROM sale_items si WHERE si.sale_id = ${sales.id}), false)`,
        // Cacah per cara penyajian: `bool_and` di atas tak bisa membedakan
        // "semuanya di piring" dari "sebagian dibungkus" — keduanya false.
        item_takeaway: sql<number>`(SELECT COUNT(*)::int FROM sale_items si WHERE si.sale_id = ${sales.id} AND si.sajian_takeaway)`,
        item_dine_in: sql<number>`(SELECT COUNT(*)::int FROM sale_items si WHERE si.sale_id = ${sales.id} AND NOT si.sajian_takeaway)`,
        meja: sales.mejaLabel,
        kasir: users.nama,
        konsumen: sales.customerNama,
        metode: sales.metodeBayar,
        cabang: branches.nama,
        jumlah_item: sql<number>`(SELECT COUNT(*)::int FROM sale_items si WHERE si.sale_id = ${sales.id})`,
        /*
         * LAMA PESANAN RAMPUNG — "berapa lama tamu menunggu sampai semuanya
         * keluar", bukan jumlah waktu tiap sajian. Dapur mengerjakan beberapa
         * sajian sekaligus; menjumlahkannya melaporkan penantian yang tak
         * pernah terjadi.
         *
         * `FILTER (WHERE ... <> 'batal')` di kedua sisi: baris batal tak
         * menahan pesanan jadi rampung dan tak ikut menentukan kapan mulai atau
         * selesai. `NULL` bila masih ada yang dikerjakan, bila seluruh barisnya
         * batal, atau bila dapur tak pernah menandai apa pun — dan NULL itu
         * disengaja. Nol berarti "keluar seketika", yang justru membuat
         * transaksi lama yang tak pernah dicatat terlihat paling cepat.
         *
         * `GREATEST(..., 0)` menjaga jam server yang pernah mundur tak
         * melahirkan durasi negatif.
         */
        pesanan_durasi_detik: sql<number | null>`(
          SELECT GREATEST(0, EXTRACT(EPOCH FROM (
                   MAX(si.pesanan_status_at) - MIN(si.pesanan_masuk_at)))::int)
          FROM sale_items si
          WHERE si.sale_id = ${sales.id} AND si.pesanan_status <> 'batal'
          HAVING COUNT(*) > 0
             AND COUNT(*) FILTER (WHERE si.pesanan_status <> 'selesai') = 0
             AND COUNT(*) FILTER (WHERE si.pesanan_status_at IS NULL) = 0
        )`,
        pesanan_selesai_pada: sql<string | null>`(
          SELECT MAX(si.pesanan_status_at)
          FROM sale_items si
          WHERE si.sale_id = ${sales.id} AND si.pesanan_status <> 'batal'
          HAVING COUNT(*) > 0
             AND COUNT(*) FILTER (WHERE si.pesanan_status <> 'selesai') = 0
             AND COUNT(*) FILTER (WHERE si.pesanan_status_at IS NULL) = 0
        )`,
      })
      .from(sales)
      .leftJoin(users, eq(sales.cashierUserId, users.id))
      .leftJoin(branches, eq(sales.branchId, branches.id))
      .where(
        and(
          eq(sales.companyId, auth.company_id!),
          ...(branchId ? [eq(sales.branchId, branchId)] : []),
          eq(sales.saleDate, tanggal),
          isNull(sales.deletedAt),
        ),
      )
      .orderBy(desc(sales.waktu));
    return c.json(
      rows.map((r) => ({
        ...r,
        /*
         * Dinormalkan ke ISO. Kolom Drizzle (`waktu` di baris yang sama) sudah
         * berupa `Date` dan ikut jadi ISO sendiri, tapi medan ini lahir dari
         * `sql<...>` mentah sehingga driver memulangkannya apa adanya:
         * "2026-08-18 23:59:59.467+00" — spasi, bukan "T". `Date.parse` di
         * Safari menolak bentuk itu, jadi satu baris riwayat bisa tampil
         * "Invalid Date" hanya di sebagian perangkat.
         */
        pesanan_selesai_pada: r.pesanan_selesai_pada
          ? new Date(r.pesanan_selesai_pada).toISOString()
          : null,
        // Driver memulangkan agregat numerik sebagai string pada sebagian tipe;
        // DTO-nya menjanjikan number.
        pesanan_durasi_detik:
          r.pesanan_durasi_detik == null ? null : Number(r.pesanan_durasi_detik),
      })),
    );
  })
  .get("/:id", async (c) => {
    const auth = c.get("auth");
    const [sale] = await db
      .select()
      .from(sales)
      .where(
        and(
          eq(sales.id, c.req.param("id")),
          eq(sales.companyId, auth.company_id!),
          isNull(sales.deletedAt),
        ),
      );
    if (!sale) throw new HTTPException(404, { message: "Transaksi tidak ditemukan" });
    // Kasir hanya boleh melihat transaksi di cabangnya.
    if (terikatCabang(auth.role) && sale.branchId !== auth.branch_id) {
      throw new HTTPException(403, { message: "Kasir hanya boleh melihat transaksi cabangnya" });
    }
    const items = await db.select().from(saleItems).where(eq(saleItems.saleId, sale.id));
    const [branch] = await db
      .select({ nama: branches.nama })
      .from(branches)
      .where(eq(branches.id, sale.branchId));
    const [kasirUser] = await db
      .select({ nama: users.nama })
      .from(users)
      .where(eq(users.id, sale.cashierUserId));
    return c.json({ sale, items, branch_nama: branch?.nama ?? "", kasir: kasirUser?.nama ?? null });
  })
  /**
   * SLIP PESANAN penjualan ini — menu & jumlah saja, TANPA HARGA.
   *
   * Untuk klien yang tak bisa memakai `@kakarut/shared` (mobile Flutter): byte
   * ESC/POS-nya dirender server dan dipulangkan base64, siap dikirim ke printer.
   * Web menyusunnya sendiri dari paket shared.
   *
   * Memakai pemuat & gerbang yang SAMA dengan `GET /:id` di atas — termasuk
   * kunci cabang bagi kasir. Endpoint yang memuat datanya sendiri akan jadi
   * salinan kedua dari aturan "boleh melihat transaksi mana".
   */
  .get("/:id/slip", async (c) => {
    const auth = c.get("auth");
    const [sale] = await db
      .select()
      .from(sales)
      .where(
        and(
          eq(sales.id, c.req.param("id")),
          eq(sales.companyId, auth.company_id!),
          isNull(sales.deletedAt),
        ),
      );
    if (!sale) throw new HTTPException(404, { message: "Transaksi tidak ditemukan" });
    if (terikatCabang(auth.role) && sale.branchId !== auth.branch_id) {
      throw new HTTPException(403, { message: "Kasir hanya boleh melihat transaksi cabangnya" });
    }
    const items = await db.select().from(saleItems).where(eq(saleItems.saleId, sale.id));
    const [branch] = await db
      .select({ nama: branches.nama })
      .from(branches)
      .where(eq(branches.id, sale.branchId));
    const [comp] = await db
      .select({ nama: companies.nama, timezone: companies.timezone })
      .from(companies)
      .where(eq(companies.id, auth.company_id!));
    const [kasirUser] = await db
      .select({ nama: users.nama })
      .from(users)
      .where(eq(users.id, sale.cashierUserId));

    return c.json(
      responsSlip(
        {
          companyNama: comp?.nama ?? "",
          branchNama: branch?.nama ?? "",
          nomor: sale.nomor,
          waktu: waktuKertas(sale.waktu, comp?.timezone ?? "Asia/Jakarta"),
          isDineIn: sale.isDineIn,
          mejaLabel: sale.mejaLabel,
          customerNama: sale.customerNama,
          items: items.map((it) => ({
            nama: it.menuNama,
            // Porsi yang DITAGIH: sajian yang sudah dikembalikan tak perlu
            // dimasak lagi, dan slip ini dibaca dapur.
            qty: qtyDitagih(it),
            tag: it.isDineIn !== sale.isDineIn ? (it.isDineIn ? "DI" : "TA") : null,
            catatan: it.catatan,
          })),
          catatan: sale.catatan,
          kasir: kasirUser?.nama ?? null,
        },
        opsiSlipDariQuery(c),
      ),
    );
  })
  .delete(
    "/:id",
    requireRole("owner", "admin"),
    async (c) => {
      const auth = c.get("auth");
      // Cukup konfirmasi (tanpa password): SOFT-DELETE → Tempat Sampah,
      // bisa dipulihkan. Baris & item/konsumsi tetap ada (audit),
      // saldo stok pulih karena semua agregasi memfilter deleted_at IS NULL.
      const [row] = await db
        .update(sales)
        .set({ deletedAt: new Date(), deletedBy: auth.sub })
        .where(
          and(
            eq(sales.id, c.req.param("id")),
            eq(sales.companyId, auth.company_id!),
            isNull(sales.deletedAt),
          ),
        )
        .returning();
      if (!row) throw new HTTPException(404, { message: "Transaksi tidak ditemukan" });
      return c.json({ ok: true, nomor: row.nomor });
  })
  /**
   * REFUND SEBAGIAN — sajian yang tak jadi dibuat karena bahannya habis.
   *
   * KASIR BOLEH, dan itu disengaja: pembelinya sedang berdiri di depan kasir,
   * memanggil owner berarti menahan antrean. Wewenangnya ditukar dengan jejak —
   * `sale_refunds` menyimpan siapa, kapan, berapa, dan alasannya, dan owner
   * memeriksanya belakangan.
   *
   * Peran terikat cabang otomatis terkunci ke cabangnya sendiri lewat
   * `resolveBranchId`; owner/admin bisa merefund transaksi cabang mana pun.
   */
  .post(
    "/:id/refund",
    requireRole("owner", "admin", "cashier"),
    zValidator(
      "json",
      z.object({
        alasan: z.string().nullish(),
        client_ref: clientRefField,
        device_id: deviceIdField,
        items: z
          .array(
            z.object({
              sale_item_id: z.string().uuid(),
              qty: z.number().positive(),
            }),
          )
          .min(1),
      }),
    ),
    async (c) => {
      const auth = c.get("auth");
      const body = c.req.valid("json");
      const saleId = c.req.param("id");
      /**
       * IDEMPOTENSI — sama pentingnya di sini seperti di `POST /penjualan`,
       * dan akibat salahnya justru lebih buruk: refund yang terkirim dua kali
       * MENGEMBALIKAN UANG DUA KALI. Validasi "melebihi sisa porsi" tak
       * menolongnya — selama masih ada porsi tersisa, permintaan kedua sah
       * secara aturan dan langsung dieksekusi.
       *
       * Kejadiannya sama persis: jaringan putus sesudah server menyimpan tapi
       * sebelum balasannya sampai. Dan itu TIDAK SELALU BUTUH MANUSIA — terukur
       * di Chromium, browser mengulang sendiri POST yang soketnya ditutup pada
       * koneksi keep-alive yang dipakai ulang. Klien tanpa `client_ref` bisa
       * merefund dua kali walau kasirnya menekan tombol sekali.
       */
      /*
       * Klaimnya diambil SEBELUM eksekusi, bukan sekadar diperiksa. Memeriksa
       * saja tak menutup apa pun di sini: `refundSajian` mengunci barisnya
       * dengan `FOR UPDATE`, jadi permintaan kedua yang ber-ref sama tidak
       * ditolak — ia MENUNGGU yang pertama selesai, lalu membaca sisa porsi
       * yang memang masih ada, lalu mengembalikan uang untuk kedua kalinya.
       * Penguncian barisnya justru yang membuat urutannya rapi dan salah.
       *
       * Bila `refundSajian` melempar, klaimnya DILEPAS (lihat kontraknya di
       * `denganKlaimIdempoten`) — persis niat yang sudah ditulis di sini
       * sebelumnya: ledger tak boleh menyimpan apa pun untuk refund yang tak
       * pernah terjadi, supaya percobaan ulang benar-benar dijalankan.
       */
      const { data } = await denganKlaimIdempoten(
        {
          companyId: auth.company_id!,
          clientRef: body.client_ref,
          userId: auth.sub,
          deviceId: body.device_id ?? null,
          tipe: "refund",
        },
        async () => {
          // Kasir hanya boleh menyentuh transaksi CABANGNYA. Tanpa ini, id
          // transaksi cabang lain yang bocor ke tangan kasir cukup untuk
          // mengembalikan uang di pembukuan yang bukan urusannya.
          if (terikatCabang(auth.role)) {
            const [milik] = await db
              .select({ branchId: sales.branchId })
              .from(sales)
              .where(and(eq(sales.id, saleId), eq(sales.companyId, auth.company_id!)));
            if (!milik || milik.branchId !== auth.branch_id) {
              throw new HTTPException(404, { message: "Transaksi tidak ditemukan" });
            }
          }
          const hasil = await db.transaction((tx) =>
            refundSajian(tx, {
              saleId,
              companyId: auth.company_id!,
              userId: auth.sub,
              alasan: body.alasan,
              items: body.items.map((i) => ({ saleItemId: i.sale_item_id, qty: i.qty })),
            }),
          );
          return {
            ok: true,
            nominal: hasil.nominal,
            total_lama: hasil.totalLama,
            total_baru: hasil.totalBaru,
          };
        },
      );
      return c.json(data);
    },
  );

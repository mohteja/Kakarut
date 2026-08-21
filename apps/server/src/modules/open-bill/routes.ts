import { zValidator } from "../../lib/validator";
import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { OpenBillDetail, OpenBillRow } from "@kakarut/shared";
import { db } from "../../db/client";
import { formatAngkaId, waktuKertas } from "@kakarut/shared";
import { opsiSlipDariQuery, responsSlip } from "../print/slip";
import { loadKatalog, tambahKebutuhanBahan } from "../menu/service";
import { bahanKurang } from "../stok/service";
import {
  branches,
  companies,
  meja,
  menuBranches,
  menus,
  openBillItems,
  openBills,
  pesananLogs,
} from "../../db/schema";
import {
  branchUntukTulis,
  resolveBranchId,
  terikatCabang,
  type AppEnv,
} from "../../middleware/auth";

const BillBody = z.object({
  branch_id: z.string().uuid().optional(),
  meja_id: z.string().uuid().nullish(),
  customer_nama: z.string().nullish(),
  customer_wa: z.string().nullish(),
  catatan: z.string().nullish(),
  items: z
    .array(
      z.object({
        /**
         * id baris yang SUDAH ada di bill (dari GET). Baris ber-id
         * mempertahankan harga terkuncinya; baris tanpa id = baris baru dan
         * memakai harga katalog hari ini.
         */
        id: z.string().uuid().optional(),
        /**
         * PISAH PORSI: baris ini adalah baris BARU, tapi harga terkunci &
         * status dapurnya diwarisi dari baris bill yang disebut di sini.
         *
         * Sengaja TERPISAH dari `id`: `id` adalah kunci PASANGAN (baris lama
         * mana yang diperbarui baris ini) dan hakikatnya satu-ke-satu — dikirim
         * dua kali ditolak 400. `pisah_dari` adalah kunci WARISAN dan memang
         * boleh berulang: 3 porsi bisa jadi 2 + 1 yang dua-duanya menunjuk
         * baris asal yang sama.
         *
         * Tanpa jalur ini, memecah porsi di `PUT` memaksa porsi pecahannya jadi
         * baris baru berharga HARI INI — pembeli ditagih lebih mahal hanya
         * karena kasir menekan "bungkus satu", dan porsi yang sudah matang
         * kembali ke antrean dapur.
         */
        pisah_dari: z.string().uuid().nullish(),
        menu_id: z.string().uuid(),
        qty: z.number().positive(),
        dine_in_override: z.boolean().nullish(),
        catatan: z.string().nullish(),
      }),
    )
    .min(1),
});

/**
 * Pastikan semua menu milik perusahaan pemanggil & tersedia di cabang bill,
 * lalu kembalikan harga + nama katalognya untuk di-snapshot ke baris bill.
 * Harga SELALU dari server — nilai kiriman klien tidak dipercaya karena ini
 * yang nanti ditagih ke pembeli.
 */
async function validateMenus(
  companyId: string,
  branchId: string,
  items: { menu_id: string }[],
): Promise<Map<string, { nama: string; hargaJual: number }>> {
  const ids = [...new Set(items.map((i) => i.menu_id))];
  const rows = await db
    .select({ id: menus.id, nama: menus.nama, hargaJual: menus.hargaJual })
    .from(menus)
    .where(and(eq(menus.companyId, companyId), inArray(menus.id, ids)));
  if (rows.length !== ids.length) {
    throw new HTTPException(400, { message: "Ada menu yang tidak valid" });
  }
  // Pembatasan lokasi: tanpa baris = semua cabang; ada baris = whitelist.
  const batasan = await db
    .select({ menuId: menuBranches.menuId, branchId: menuBranches.branchId })
    .from(menuBranches)
    .where(inArray(menuBranches.menuId, ids));
  const cabangByMenu = new Map<string, string[]>();
  for (const b of batasan) {
    const list = cabangByMenu.get(b.menuId) ?? [];
    list.push(b.branchId);
    cabangByMenu.set(b.menuId, list);
  }
  for (const r of rows) {
    const cabang = cabangByMenu.get(r.id);
    if (cabang && !cabang.includes(branchId)) {
      throw new HTTPException(400, { message: `Menu "${r.nama}" tidak tersedia di cabang ini` });
    }
  }
  return new Map(rows.map((r) => [r.id, { nama: r.nama, hargaJual: r.hargaJual }]));
}

/** Resolusi meja → label snapshot (validasi milik cabang). */
async function resolveMeja(companyId: string, branchId: string, mejaId?: string | null) {
  if (!mejaId) {
    return {
      mejaId: null as string | null,
      mejaLabel: null as string | null,
      tipe: null as "dine_in" | "takeaway" | null,
    };
  }
  const [m] = await db
    .select({ id: meja.id, nama: meja.nama, tipe: meja.tipe })
    .from(meja)
    .where(and(eq(meja.id, mejaId), eq(meja.companyId, companyId), eq(meja.branchId, branchId)));
  if (!m) throw new HTTPException(404, { message: "Meja tidak ditemukan" });
  return { mejaId: m.id, mejaLabel: m.nama, tipe: m.tipe };
}

async function loadDetail(companyId: string, id: string): Promise<OpenBillDetail | null> {
  const [bill] = await db.select().from(openBills).where(eq(openBills.id, id));
  // Bill yang sudah ditutup (dibayar atau dibatalkan) tak lagi bisa dilanjutkan
  // kasir — sama seperti ia tak muncul di daftar. Barisnya tetap ada untuk
  // papan pesanan & jejak audit, tapi jalur kasir memperlakukannya hilang.
  if (!bill || bill.companyId !== companyId || bill.closedAt) return null;
  const items = await db.select().from(openBillItems).where(eq(openBillItems.billId, id));
  return {
    id: bill.id,
    meja_id: bill.mejaId,
    meja_label: bill.mejaLabel,
    customer_nama: bill.customerNama,
    customer_wa: bill.customerWa,
    catatan: bill.catatan,
    items: items.map((it) => ({
      id: it.id,
      menu_id: it.menuId,
      menu_nama: it.menuNama,
      harga_satuan: it.hargaSatuan,
      qty: it.qty,
      dine_in_override: it.dineInOverride,
      catatan: it.catatan,
      // Baris yang dibatalkan dapur (bahan habis) tetap dikirim — ia wajib ada
      // saat PUT, dan kasir perlu melihatnya — tapi statusnya ikut supaya
      // klien tahu baris itu tidak boleh ditagih.
      pesanan_status: it.pesananStatus,
    })),
  };
}

type BillItemInput = z.infer<typeof BillBody>["items"][number];
type KatalogHarga = Map<string, { nama: string; hargaJual: number }>;

/**
 * Penanda penyajian awal untuk papan dapur, DITURUNKAN dari perkataan kasir.
 *
 * `dine_in_override === false` berarti kasir sudah bilang "porsi ini dibungkus".
 * Dapur harus melihatnya dari kartu, bukan menebak: dulu `sajian_takeaway`
 * dibiarkan default `false`, jadi papan menandai SEMUA baris "🍽 Di tempat"
 * meski kasir sudah menandai salah satunya take away. Barisnya baru jadi benar
 * setelah dibayar (`createSale` memakai aturan yang sama) — dan itu terlambat:
 * makanannya sudah keluar di piring.
 */
function sajianDariKasir(dineInOverride: boolean | null | undefined): boolean {
  return !(dineInOverride ?? true);
}

/**
 * GERBANG "TOLAK PESANAN MELEBIHI STOK" pada titik MEMESAN.
 *
 * Setelan `companies.blokir_jual_minus` (bawaan MATI). Diperiksa di sini —
 * saat baris masuk bill — dan BUKAN saat bill dibayar: begitu bill disimpan
 * ia tayang di papan dapur dan masakannya dikerjakan. Menolak di kasir
 * berarti tamu yang sudah makan tak bisa membayar; menolak di sini berarti
 * pesanannya tak pernah masuk dapur, dan itu yang bisa ditindaklanjuti.
 *
 * `dineIn` per baris memakai basis yang sama dengan `createSale`: penanda
 * take-away baris (bila ada) mengalahkan tipe transaksi, sebab kemasan hanya
 * terpakai pada porsi yang benar-benar dibungkus.
 */
async function pastikanStokCukup(
  companyId: string,
  branchId: string,
  items: { menu_id: string; qty: number; dine_in_override?: boolean | null }[],
  billDineIn: boolean,
): Promise<void> {
  if (items.length === 0) return;
  const [company] = await db
    .select({ blokir: companies.blokirJualMinus })
    .from(companies)
    .where(eq(companies.id, companyId));
  if (!company?.blokir) return;
  const katalog = await loadKatalog(db, companyId);
  const menuById = new Map(katalog.rows.map((m) => [m.id, m]));
  const butuh = new Map<string, number>();
  for (const it of items) {
    const menu = menuById.get(it.menu_id);
    if (!menu) continue;
    // `dine_in_override` per baris mengalahkan tipe bill — persis dasar biaya
    // yang dipakai `createSale` saat bill ini kelak dibayar.
    const dineIn = it.dine_in_override ?? billDineIn;
    tambahKebutuhanBahan(butuh, katalog, menu, it.qty, dineIn);
  }
  const kurang = await bahanKurang(db, companyId, branchId, butuh);
  if (kurang.length > 0) {
    throw new HTTPException(400, {
      message: `Stok tidak cukup: ${kurang
        .map((k) => `${k.nama} (sisa ${formatAngkaId(k.saldo)} ${k.satuan}, butuh ${formatAngkaId(k.butuh)})`)
        .join("; ")}`,
    });
  }
}

/** Baris BARU: nama + harga di-snapshot dari katalog saat ini. */
function barisBaru(billId: string, it: BillItemInput, katalog: KatalogHarga) {
  const m = katalog.get(it.menu_id)!;
  return {
    billId,
    menuId: it.menu_id,
    menuNama: m.nama,
    hargaSatuan: m.hargaJual,
    qty: it.qty,
    dineInOverride: it.dine_in_override ?? null,
    sajianTakeaway: sajianDariKasir(it.dine_in_override),
    catatan: it.catatan?.trim() || null,
  };
}

export const openBillRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const auth = c.get("auth");
    const branchId = await resolveBranchId(c);
    const rows = await db
      .select({
        id: openBills.id,
        // `meja_id` DI SAMPING label: label itu snapshot saat bill dibuat, jadi
        // mencocokkan bill ke meja lewat label akan gagal begitu mejanya diganti
        // nama — dan gagalnya SUNYI (kasir cuma tak melihat peringatan bill
        // ganda). Klien mencocokkan lewat id.
        meja_id: openBills.mejaId,
        meja_label: openBills.mejaLabel,
        customer_nama: openBills.customerNama,
        waktu: openBills.updatedAt,
        jumlah_item: sql<number>`COUNT(${openBillItems.id})::int`,
      })
      .from(openBills)
      .leftJoin(openBillItems, eq(openBillItems.billId, openBills.id))
      .where(
        and(
          eq(openBills.companyId, auth.company_id!),
          eq(openBills.branchId, branchId),
          // bill yang sudah dibayar/dibatalkan tidak lagi bisa dilanjutkan
          isNull(openBills.closedAt),
        ),
      )
      .groupBy(openBills.id)
      .orderBy(desc(openBills.updatedAt));
    const dto: OpenBillRow[] = rows.map((r) => ({
      id: r.id,
      meja_id: r.meja_id,
      meja_label: r.meja_label,
      customer_nama: r.customer_nama,
      jumlah_item: r.jumlah_item,
      waktu: (r.waktu as Date).toISOString(),
    }));
    return c.json(dto);
  })
  .get("/:id", async (c) => {
    const auth = c.get("auth");
    const detail = await loadDetail(auth.company_id!, c.req.param("id"));
    if (!detail) throw new HTTPException(404, { message: "Bill tidak ditemukan" });
    return c.json(detail);
  })
  /**
   * SLIP PESANAN bill ini — menu & jumlah saja, TANPA HARGA.
   *
   * Untuk klien yang tak bisa memakai `@kakarut/shared` (mobile Flutter): byte
   * ESC/POS-nya dirender server dan dipulangkan base64, siap dikirim ke printer.
   * Web menyusunnya sendiri dari paket shared.
   *
   * Memakai `loadDetail` yang sama dengan `GET /:id` — termasuk aturan bahwa
   * bill yang sudah ditutup diperlakukan hilang. Bill yang sudah dibayar punya
   * nomor nota, dan slipnya diambil dari `GET /penjualan/:id/slip`.
   */
  .get("/:id/slip", async (c) => {
    const auth = c.get("auth");
    const detail = await loadDetail(auth.company_id!, c.req.param("id"));
    if (!detail) throw new HTTPException(404, { message: "Bill tidak ditemukan" });

    const [comp] = await db
      .select({ nama: companies.nama, timezone: companies.timezone })
      .from(companies)
      .where(eq(companies.id, auth.company_id!));
    const branchId = await resolveBranchId(c);
    const [branch] = await db
      .select({ nama: branches.nama })
      .from(branches)
      .where(eq(branches.id, branchId));
    // Dine-in ditentukan TIPE MEJANYA, sama seperti di layar kasir — bill tak
    // menyimpan penandanya sendiri.
    const [m] = detail.meja_id
      ? await db.select({ tipe: meja.tipe }).from(meja).where(eq(meja.id, detail.meja_id))
      : [undefined];
    const dineIn = m ? m.tipe === "dine_in" : true;

    return c.json(
      responsSlip(
        {
          companyNama: comp?.nama ?? "",
          branchNama: branch?.nama ?? "",
          // Open bill belum bernomor — mejanya yang jadi identitas antar.
          nomor: null,
          waktu: waktuKertas(new Date(), comp?.timezone ?? "Asia/Jakarta"),
          isDineIn: dineIn,
          mejaLabel: detail.meja_label,
          customerNama: detail.customer_nama,
          /*
           * Baris yang DIBATALKAN dapur tidak ikut. Slip ini perintah memasak,
           * bukan daftar tagihan: mencetak ulang baris yang sudah dibatalkan
           * (bahan habis) menyuruh dapur membuatnya lagi — persis yang
           * pembatalannya hendak cegah.
           */
          items: detail.items
            .filter((it) => it.pesanan_status !== "batal")
            .map((it) => ({
              nama: it.menu_nama,
              qty: it.qty,
              tag:
                it.dine_in_override !== null && it.dine_in_override !== dineIn
                  ? it.dine_in_override
                    ? "DI"
                    : "TA"
                  : null,
              catatan: it.catatan,
            })),
          catatan: detail.catatan,
          kasir: null,
        },
        opsiSlipDariQuery(c),
      ),
    );
  })
  .post("/", zValidator("json", BillBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const branchId = await branchUntukTulis(
      c,
      body.branch_id,
      "Kasir hanya boleh bill di cabangnya",
    );
    if (body.items.some((i) => i.pisah_dari)) {
      // Bill baru belum punya baris apa pun untuk diwarisi — mengizinkannya
      // hanya akan diam-diam memakai harga hari ini, jadi lebih jujur ditolak.
      throw new HTTPException(400, { message: "pisah_dari hanya berlaku saat memperbarui bill" });
    }
    const katalog = await validateMenus(auth.company_id!, branchId, body.items);
    const { mejaId, mejaLabel, tipe } = await resolveMeja(auth.company_id!, branchId, body.meja_id);
    // Sesudah `resolveMeja`: tipe meja yang menentukan dine-in bill, dan
    // dine-in menentukan apakah bahan kemasan ikut terpakai.
    await pastikanStokCukup(auth.company_id!, branchId, body.items, tipe === "dine_in");
    /**
     * SATU MEJA DINE-IN = SATU BILL BERJALAN.
     *
     * Selama masih ada bill belum dibayar di meja itu, pesanan tambahan WAJIB
     * masuk ke bill itu lewat `PUT /open-bill/:id` — bukan jadi bill kedua.
     * Alasannya dari lapangan: dua bill di satu meja bikin salah satu
     * tertinggal tak tertagih saat tamu pulang, dan kasir tak punya cara tahu
     * sampai selisih muncul di tutup kasir.
     *
     * `bill_id` ikut dikirim supaya klien bisa langsung menawarkan
     * "tambahkan ke bill ini" tanpa mencari sendiri.
     *
     * DUA PENGECUALIAN, keduanya penting:
     *
     * 1. **Meja takeaway (Ruang Tunggu) DIKECUALIKAN.** Seluruh pesanan bawa
     *    pulang cabang menunjuk ke satu baris takeaway yang tak bisa dihapus.
     *    Kalau ia ikut dijaga, satu bill bawa pulang yang terparkir akan
     *    memblokir SEMUA pesanan bawa pulang berikutnya — jalur itu mati.
     * 2. **Bill tanpa meja** tak punya apa pun untuk bertabrakan.
     *
     * Baris mejanya di-LOCK (`FOR UPDATE`) di dalam transaksi: tanpa itu dua
     * perangkat yang menyimpan bill bersamaan sama-sama melihat "belum ada
     * bill" lalu keduanya menyisipkan, dan aturan ini bocor persis di kondisi
     * yang paling mungkin terjadi — jam ramai.
     */
    type HasilSimpan =
      | { bentrok: { id: string; mejaLabel: string | null }; id?: undefined }
      | { id: string; bentrok?: undefined };
    const hasil: HasilSimpan = await db.transaction(async (tx): Promise<HasilSimpan> => {
      // Kunci + periksa + sisipkan dalam SATU transaksi. Kalau pemeriksaannya
      // di transaksi terpisah, kuncinya lepas begitu transaksi itu commit dan
      // celah balapannya terbuka lagi tepat sebelum penyisipan.
      if (mejaId && tipe === "dine_in") {
        await tx.execute(sql`SELECT 1 FROM meja WHERE id = ${mejaId} FOR UPDATE`);
        const [ada] = await tx
          .select({ id: openBills.id, mejaLabel: openBills.mejaLabel })
          .from(openBills)
          .where(
            and(
              eq(openBills.companyId, auth.company_id!),
              eq(openBills.branchId, branchId),
              eq(openBills.mejaId, mejaId),
              isNull(openBills.closedAt),
            ),
          )
          .limit(1);
        if (ada) return { bentrok: ada };
      }
      const [bill] = await tx
        .insert(openBills)
        .values({
          companyId: auth.company_id!,
          branchId,
          mejaId,
          mejaLabel,
          customerNama: body.customer_nama?.trim() || null,
          customerWa: body.customer_wa?.trim() || null,
          catatan: body.catatan?.trim() || null,
          createdBy: auth.sub,
        })
        .returning({ id: openBills.id });
      await tx
        .insert(openBillItems)
        .values(body.items.map((it) => barisBaru(bill.id, it, katalog)));
      return { id: bill.id };
    });
    if (hasil.bentrok) {
      // Badan galat BERKODE — klien membaca `kode`, bukan teks pesannya.
      return c.json(
        {
          error: `${hasil.bentrok.mejaLabel ?? "Meja ini"} masih punya bill yang belum dibayar — tambahkan pesanan ke bill itu`,
          kode: "meja_sudah_ada_bill",
          bill_id: hasil.bentrok.id,
        },
        409,
      );
    }
    return c.json(await loadDetail(auth.company_id!, hasil.id), 201);
  })
  .put("/:id", zValidator("json", BillBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const id = c.req.param("id");
    const [existing] = await db.select().from(openBills).where(eq(openBills.id, id));
    if (!existing || existing.companyId !== auth.company_id!) {
      throw new HTTPException(404, { message: "Bill tidak ditemukan" });
    }
    /**
     * BILL YANG SUDAH DITUTUP TAK BISA DISUNTING LAGI.
     *
     * Setiap jalur lain sudah menjaganya: `GET /open-bill/:id` memulangkan 404
     * (`loadDetail` menyaring `closedAt`), `DELETE` menyaring `closedAt` di
     * WHERE-nya, dan `createSale` menolak menagih bill yang sudah tertutup.
     * Hanya `PUT` yang tak ikut — dan itu jalur yang PALING mungkin dilewati,
     * karena layar kasir bisa saja masih memegang bill yang baru saja dibayar
     * atau dibatalkan perangkat lain.
     *
     * Akibatnya dua-duanya sunyi:
     *
     *   - Bill sudah DIBAYAR: barisnya sudah disalin ke `sale_items`, jadi
     *     tambahan yang ditulis ke sini tak pernah ditagih dan tak pernah tampil
     *     di kartu penjualan. Pesanannya hilang, tanpa galat.
     *   - Bill sudah DIBATALKAN: seluruh barisnya bertanda `batal`, lalu baris
     *     baru masuk dengan status hidup ke bill yang tak akan ditagih siapa pun.
     *
     * Dan di kedua kasus `loadDetail` di akhir handler memulangkan `null` —
     * jadi klien menerima 200 berisi `null` untuk tipe `OpenBillDetail`, lalu
     * `onSuccess` mengosongkan keranjang. Kasir melihat "tersimpan"; yang
     * tersimpan tak ada.
     *
     * 409 berkode, bukan 404: bill-nya ADA di layar kasir, jadi "tidak
     * ditemukan" cuma membingungkan. Dengan galat ini keranjang tak
     * dikosongkan, sehingga pesanannya masih bisa disimpan sebagai bill baru.
     */
    if (existing.closedAt) {
      return c.json(
        {
          error: existing.saleId
            ? "Bill ini sudah dibayar — pesanan tambahan harus dibuat sebagai transaksi baru."
            : "Bill ini sudah dibatalkan — buat bill baru untuk pesanan ini.",
          kode: "bill_sudah_ditutup",
          sudah_dibayar: existing.saleId !== null,
        },
        409,
      );
    }
    const katalog = await validateMenus(auth.company_id!, existing.branchId, body.items);
    const { mejaId, mejaLabel, tipe } = await resolveMeja(
      auth.company_id!,
      existing.branchId,
      body.meja_id,
    );
    /**
     * PINDAH MEJA ikut dijaga aturan "satu meja dine-in = satu bill".
     *
     * Tanpa ini larangan di `POST` cuma menutup pintu depan: kasir tetap bisa
     * membuat bill di meja lain lalu MEMINDAHKANNYA ke meja yang sudah punya
     * bill, dan mendarat di keadaan yang justru dilarang. `ne(id)` mengecualikan
     * bill ini sendiri — menyimpan ulang bill di mejanya sendiri harus tetap
     * boleh, itu justru jalur "tambahkan pesanan ke bill yang ada".
     */
    /**
     * BARIS BILL TAK BISA DIHAPUS LEWAT `PUT` — diperiksa SEBELUM apa pun
     * ditulis. Mengembalikan galat di tengah transaksi TIDAK me-rollback apa
     * yang sudah di-`update`, jadi pemasangan barisnya dihitung dulu di sini,
     * di luar transaksi penulisan.
     *
     * Bill tayang di papan dapur begitu disimpan, jadi setiap barisnya sudah
     * dilihat — bisa jadi sudah dimasak. Dulu baris yang tak berpasangan
     * di-hard-delete: pekerjaan dapur lenyap dari papan tanpa jejak siapa pun.
     *
     * Membatalkan satu sajian jalurnya
     * `POST /pesanan/open_bill/:id/item/:itemId/status {status:"batal"}` —
     * barisnya tetap ada, lengkap dengan pelaku & waktunya. Membatalkan SELURUH
     * bill tetap lewat `DELETE /open-bill/:id`.
     */
    const lamaCek = await db
      .select({ id: openBillItems.id, menuId: openBillItems.menuId })
      .from(openBillItems)
      .where(eq(openBillItems.billId, id));
    const terpakaiCek = new Set<string>();
    for (const it of body.items) {
      if (it.id && lamaCek.some((r) => r.id === it.id)) terpakaiCek.add(it.id);
    }
    const sisaCek = new Map<string, string[]>();
    for (const r of lamaCek) {
      if (terpakaiCek.has(r.id)) continue;
      const antre = sisaCek.get(r.menuId) ?? [];
      antre.push(r.id);
      sisaCek.set(r.menuId, antre);
    }
    for (const it of body.items) {
      if (it.id || it.pisah_dari) continue;
      const cocok = sisaCek.get(it.menu_id)?.shift();
      if (cocok) terpakaiCek.add(cocok);
    }
    /*
     * Gerbang stok pada PUT hanya menimbang baris yang BENAR-BENAR BARU.
     *
     * Baris ber-`id` adalah baris lama yang dipertahankan, dan `pisah_dari`
     * adalah porsi yang dipecah dari baris yang sudah ada — dua-duanya sudah
     * masuk dapur saat dipesan dulu. Menghitungnya ulang di sini akan menolak
     * penyimpanan ulang bill yang tak menambah pesanan apa pun, hanya karena
     * stoknya sudah menipis sejak tadi.
     */
    await pastikanStokCukup(
      auth.company_id!,
      existing.branchId,
      body.items.filter((it) => !it.id && !it.pisah_dari),
      tipe === "dine_in",
    );
    const akanTerhapus = lamaCek.filter((r) => !terpakaiCek.has(r.id));
    if (akanTerhapus.length > 0) {
      // Pesan ditulis untuk KASIR, bukan developer: klien menampilkan `error`
      // apa adanya di snackbar, jadi yang membacanya orang yang sedang berdiri
      // di depan pelanggan.
      return c.json(
        {
          error:
            "Pesanan yang sudah masuk dapur tidak bisa dihapus dari sini — batalkan per sajian di Papan Pesanan.",
          kode: "baris_bill_tak_bisa_dihapus",
          item_ids: akanTerhapus.map((r) => r.id),
        },
        400,
      );
    }
    const konflik = await db.transaction(async (tx) => {
      /*
       * PEMERIKSAAN ULANG DI DALAM TRANSAKSI, di bawah kunci baris.
       *
       * `existing` di atas dibaca TANPA kunci dan di LUAR transaksi ini, jadi
       * penjaga `closedAt` yang memakainya hanya menangkap bill yang sudah
       * tertutup SEBELUM permintaan ini masuk. Bill yang dibayar atau
       * dibatalkan di sela pemeriksaan dan penulisan lolos begitu saja — dan
       * `UPDATE … WHERE id = :id` di bawah tak menyaring `closed_at`, jadi
       * tulisannya benar-benar mendarat.
       *
       * Jendelanya bukan teori: di antara keduanya ada `validateMenus`,
       * `resolveMeja`, dan pemeriksaan baris-tak-boleh-dihapus — semuanya
       * query terpisah. Dan justru inilah jalur yang paling mungkin dilewati,
       * karena layar kasir bisa saja masih memegang bill yang baru dibayar
       * perangkat lain.
       *
       * `FOR UPDATE` menyerempak dengan `createSale`, yang mengunci bill yang
       * sama saat menagihnya. Yang kalah menunggu lalu membaca keadaan yang
       * benar: kalau pembayaran menang, PUT ini membalas 409; kalau PUT
       * menang, pembayarannya ikut menagih baris yang baru ditambahkan.
       */
      const [kini] = await tx
        .select({ closedAt: openBills.closedAt, saleId: openBills.saleId })
        .from(openBills)
        .where(eq(openBills.id, id))
        .for("update");
      if (!kini || kini.closedAt) {
        // Sebab & bentuk badan persis sama dengan penjaga di atas — klien
        // sudah menanganinya, dan sebab baru justru terbaca asing olehnya.
        return {
          error: kini?.saleId
            ? "Bill ini sudah dibayar — pesanan tambahan harus dibuat sebagai transaksi baru."
            : "Bill ini sudah dibatalkan — buat bill baru untuk pesanan ini.",
          kode: "bill_sudah_ditutup",
          sudah_dibayar: kini?.saleId != null,
        };
      }

      /**
       * PINDAH MEJA ikut dijaga aturan "satu meja dine-in = satu bill".
       *
       * Tanpa ini larangan di `POST` cuma menutup pintu depan: kasir tetap bisa
       * membuat bill di meja lain lalu MEMINDAHKANNYA ke meja yang sudah punya
       * bill, dan mendarat di keadaan yang justru dilarang. `ne(id)` mengecualikan
       * bill ini sendiri — menyimpan ulang bill di mejanya sendiri harus tetap
       * boleh, itu justru jalur "tambahkan pesanan ke bill yang ada".
       *
       * Diperiksa DI DALAM transaksi penulisan, bukan di transaksi tersendiri
       * seperti dulu: kunci meja yang diambil lalu dilepas sebelum menulis tak
       * menjaga apa pun di antara keduanya — bill lain bisa mendarat di meja
       * itu tepat di sela tersebut. Sekarang kuncinya bertahan sampai
       * tulisannya selesai.
       */
      if (mejaId && tipe === "dine_in") {
        await tx.execute(sql`SELECT 1 FROM meja WHERE id = ${mejaId} FOR UPDATE`);
        const [ada] = await tx
          .select({ id: openBills.id, mejaLabel: openBills.mejaLabel })
          .from(openBills)
          .where(
            and(
              eq(openBills.companyId, auth.company_id!),
              eq(openBills.branchId, existing.branchId),
              eq(openBills.mejaId, mejaId),
              isNull(openBills.closedAt),
              ne(openBills.id, id),
            ),
          )
          .limit(1);
        if (ada) {
          return {
            error: `${ada.mejaLabel ?? "Meja itu"} masih punya bill yang belum dibayar — gabungkan pesanannya ke bill itu`,
            kode: "meja_sudah_ada_bill",
            bill_id: ada.id,
          };
        }
      }

      /**
       * KUNCI YANG TAK DIKIRIM = JANGAN SENTUH.
       *
       * Dulu setiap kolom di atas ditimpa tanpa syarat, jadi `PUT` menghapus
       * apa pun yang tak ikut dikirim klien — walau klien itu tak tahu-menahu
       * soal kolomnya. Pola persis yang sudah dicabut dari `PUT /menu/:id`
       * (yang dulu menghapus resep, foto, dan arsip menu).
       *
       * Dua kerugiannya nyata dan sunyi:
       *
       *   - `catatan` BILL tayang di kartu papan dapur
       *     (`pesanan/routes.ts` mengambil `openBills.catatan`), tapi layar
       *     kasir web tak pernah mengirimnya. Jadi catatan seperti "tamu
       *     alergi udang" — yang boleh jadi ditulis dari aplikasi mobile —
       *     lenyap dari layar dapur begitu kasir menambah satu pesanan lagi.
       *   - `meja_id` yang dihilangkan melepas bill dari mejanya. Mejanya lalu
       *     terlihat kosong, orang membuka bill kedua di sana, dan aturan
       *     "satu meja dine-in = satu bill" — yang dijaga ketat sampai
       *     `SELECT … FOR UPDATE` di dua tempat — bocor lewat pintu belakang.
       *     Bill yang terlepas itu justru yang paling mungkin tertinggal tak
       *     tertagih saat tamunya pulang.
       *
       * `null` EKSPLISIT tetap berarti "kosongkan" — zod membedakan kunci yang
       * absen (undefined) dari yang bernilai null, dan JSON tak bisa
       * mengirimkan undefined. Jadi menghapus nama tamu tetap bisa; yang
       * hilang hanyalah penghapusan yang tak pernah diminta siapa pun.
       */
      await tx
        .update(openBills)
        .set({
          ...(body.meja_id !== undefined && { mejaId, mejaLabel }),
          ...(body.customer_nama !== undefined && {
            customerNama: body.customer_nama?.trim() || null,
          }),
          ...(body.customer_wa !== undefined && {
            customerWa: body.customer_wa?.trim() || null,
          }),
          ...(body.catatan !== undefined && { catatan: body.catatan?.trim() || null }),
          updatedAt: new Date(),
        })
        // `isNull(closedAt)` sebagai sabuk kedua di samping kunci di atas:
        // kalau kelak ada yang memindahkan pemeriksaannya, WHERE ini tetap
        // menolak menulis ke bill yang sudah ditutup.
        .where(and(eq(openBills.id, id), isNull(openBills.closedAt)));

      // Dulu: hapus-semua lalu sisipkan ulang. Itu membuang harga yang sudah
      // dikunci setiap kali bill disunting — persis bug yang sedang diperbaiki.
      // Sekarang tiap baris kiriman DIPASANGKAN ke baris lama:
      //   1. `id` eksplisit (dikirim klien baru) — pasangan yang pasti;
      //   2. sisanya dicocokkan per menu, urut, dari baris lama yang belum
      //      terpakai. Ini menjaga klien LAMA (yang tak tahu soal `id`) tetap
      //      mempertahankan harga terkunci alih-alih diam-diam menagih ulang
      //      dengan harga hari ini.
      // Baris lama yang tak berpasangan dihapus; baris kiriman yang tak dapat
      // pasangan = tambahan baru → memakai harga katalog hari ini.
      const lama = await tx
        .select({
          id: openBillItems.id,
          menuId: openBillItems.menuId,
          menuNama: openBillItems.menuNama,
          hargaSatuan: openBillItems.hargaSatuan,
          pesananStatus: openBillItems.pesananStatus,
          pesananStatusAt: openBillItems.pesananStatusAt,
          pesananStatusOleh: openBillItems.pesananStatusOleh,
          dineInOverride: openBillItems.dineInOverride,
        })
        .from(openBillItems)
        .where(eq(openBillItems.billId, id));
      const lamaById = new Map(lama.map((r) => [r.id, r]));
      const pasangan = new Map<number, string>(); // indeks item kiriman → id baris lama
      const terpakai = new Set<string>();

      for (const [i, it] of body.items.entries()) {
        if (it.id && it.pisah_dari) {
          throw new HTTPException(400, {
            message: "Baris tidak boleh sekaligus memperbarui baris lama dan pisah dari baris lain",
          });
        }
        if (!it.pisah_dari) continue;
        const asal = lamaById.get(it.pisah_dari);
        if (!asal) throw new HTTPException(400, { message: "Baris asal pisah porsi tidak ditemukan" });
        if (asal.menuId !== it.menu_id) {
          throw new HTTPException(400, { message: "Baris asal pisah porsi beda menu" });
        }
        void i;
      }
      for (const [i, it] of body.items.entries()) {
        if (!it.id) continue;
        const row = lamaById.get(it.id);
        // id asing / milik bill lain → jangan diam-diam jadi baris baru
        if (!row) throw new HTTPException(400, { message: "Baris bill tidak ditemukan" });
        if (row.menuId !== it.menu_id) {
          throw new HTTPException(400, { message: "Baris bill tidak cocok dengan menunya" });
        }
        if (terpakai.has(it.id)) {
          throw new HTTPException(400, { message: "Baris bill dikirim lebih dari sekali" });
        }
        terpakai.add(it.id);
        pasangan.set(i, it.id);
      }
      const sisaPerMenu = new Map<string, string[]>();
      for (const r of lama) {
        if (terpakai.has(r.id)) continue;
        const antre = sisaPerMenu.get(r.menuId) ?? [];
        antre.push(r.id);
        sisaPerMenu.set(r.menuId, antre);
      }
      for (const [i, it] of body.items.entries()) {
        // Baris pisah porsi SELALU baris baru — kalau ia ikut pencocokan
        // per-menu, ia akan merebut baris lama yang seharusnya jadi pasangan
        // baris lain, dan hasilnya bill kehilangan satu baris tanpa sebab.
        if (it.id || it.pisah_dari) continue;
        const cocok = sisaPerMenu.get(it.menu_id)?.shift();
        if (cocok) {
          terpakai.add(cocok);
          pasangan.set(i, cocok);
        }
      }

      for (const [i, it] of body.items.entries()) {
        const barisId = pasangan.get(i);
        if (!barisId) continue;
        // hargaSatuan & menuNama SENGAJA tidak ikut diperbarui — itulah kuncinya
        const baruOverride = it.dine_in_override ?? null;
        /*
         * Penanda penyajian hanya ikut BERUBAH bila kasir memang mengubah
         * `dine_in_override` baris ini. Kalau nilainya sama, jangan disentuh:
         * dapur boleh sudah menekan 🥡/🍽 sendiri di papan, dan menimpanya
         * dengan nilai kasir yang tak berubah akan membatalkan keputusan itu
         * setiap kali kasir menambah satu pesanan lain ke bill yang sama.
         */
        const overrideBerubah = (lamaById.get(barisId)?.dineInOverride ?? null) !== baruOverride;
        await tx
          .update(openBillItems)
          .set({
            qty: it.qty,
            dineInOverride: baruOverride,
            catatan: it.catatan?.trim() || null,
            ...(overrideBerubah ? { sajianTakeaway: sajianDariKasir(baruOverride) } : {}),
          })
          .where(eq(openBillItems.id, barisId));
      }
      // Penjaga terakhir. Kasus ini sudah ditolak 400 di atas sebelum transaksi
      // dibuka; kalau sampai ke sini berarti perhitungan pasangan di kedua
      // tempat berbeda — lebih baik gagal terdengar daripada menghapus baris
      // yang mungkin sudah dimasak.
      const dibuang = lama.filter((r) => !terpakai.has(r.id)).map((r) => r.id);
      if (dibuang.length > 0) {
        throw new HTTPException(500, {
          message: "Perhitungan baris bill tidak konsisten — perubahan dibatalkan",
        });
      }
      const baru = body.items.filter((_, i) => !pasangan.has(i));
      if (baru.length > 0) {
        await tx.insert(openBillItems).values(
          baru.map((it) => {
            const dasar = barisBaru(id, it, katalog);
            const asal = it.pisah_dari ? lamaById.get(it.pisah_dari) : undefined;
            if (!asal) return dasar;
            // `sajianTakeaway` SENGAJA tidak diwarisi: memecah porsi justru
            // dilakukan supaya penyajiannya BERBEDA. Penandanya lahir dari
            // `dine_in_override` baris ini saat bill dibayar.
            return {
              ...dasar,
              menuNama: asal.menuNama,
              hargaSatuan: asal.hargaSatuan,
              pesananStatus: asal.pesananStatus,
              pesananStatusAt: asal.pesananStatusAt,
              pesananStatusOleh: asal.pesananStatusOleh,
            };
          }),
        );
      }
      return null;
    });
    if (konflik) return c.json(konflik, 409);
    return c.json(await loadDetail(auth.company_id!, id));
  })
  /**
   * BATALKAN bill (bukan hapus keras lagi).
   *
   * Sejak papan pesanan menayangkan bill ke seluruh cabang, penghapusan keras
   * membuat kartu lenyap tanpa jejak siapa pun — kebalikan dari riwayat
   * perubahan status yang justru diminta. Bill ditandai `batal` + `closed_at`,
   * jadi hilang dari pemilih kasir persis seperti dulu, tapi papan masih bisa
   * menampilkannya di kolom Batal lengkap dengan pelakunya.
   */
  .delete("/:id", async (c) => {
    const auth = c.get("auth");
    const sekarang = new Date();
    const row = await db.transaction(async (tx) => {
      const [bill] = await tx
        .update(openBills)
        .set({ closedAt: sekarang })
        .where(
          and(
            eq(openBills.id, c.req.param("id")),
            eq(openBills.companyId, auth.company_id!),
            isNull(openBills.closedAt),
          ),
        )
        .returning({ id: openBills.id, branchId: openBills.branchId });
      if (!bill) return null;
      // Status pengerjaan hidup PER BARIS, jadi membatalkan bill berarti
      // membatalkan setiap barisnya — kalau tidak, papan akan menurunkan status
      // kartunya dari baris yang masih "dikerjakan" dan menyuruh dapur membuat
      // pesanan yang sudah tak akan ditagih.
      await tx
        .update(openBillItems)
        .set({
          pesananStatus: "batal",
          pesananStatusAt: sekarang,
          pesananStatusOleh: auth.sub,
        })
        .where(eq(openBillItems.billId, bill.id));
      await tx.insert(pesananLogs).values({
        companyId: auth.company_id!,
        branchId: bill.branchId,
        openBillId: bill.id,
        aksi: "Dibatalkan (semua baris)",
        statusBaru: "batal",
        userId: auth.sub,
      });
      return bill;
    });
    if (!row) throw new HTTPException(404, { message: "Bill tidak ditemukan" });
    return c.json({ ok: true });
  });

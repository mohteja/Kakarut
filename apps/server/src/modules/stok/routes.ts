import { randomUUID } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { alias } from "drizzle-orm/pg-core";
import { and, desc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  clientRefField,
  denganKlaimIdempoten,
  deviceIdField,
} from "../sync/idempoten";
import { z } from "zod";
import type { OpnameRingkasan, OpnameSesiStatus } from "@kakarut/shared";
import { db } from "../../db/client";
import {
  companies,
  ingredients,
  memberships,
  stockOpnames,
  storageLocationPetugas,
  users,
} from "../../db/schema";
import {
  branchUntukTulis,
  pastikanCabang,
  requireRole,
  resolveBranchId,
  terikatCabang,
  type AppEnv,
} from "../../middleware/auth";
import { hargaPerUnit } from "@kakarut/shared";
import { awalHariDi, tanggalDi } from "../../lib/time";
import { nomorUntukRefs, terbitkanNomor } from "../dokumen/nomor";
import { fifoBahan, hitungSaldoCabang, kartuStok, qtyDiJalan } from "./service";

const OpnameBody = z.object({
  branch_id: z.string().uuid().optional(),
  catatan: z.string().nullish(),
  /**
   * Idempotensi satu SESI opname (UUID v4 dari perangkat), lewat ledger yang
   * sama dengan penjualan/refund/sync.
   *
   * Tanpa ini, jaringan yang putus SESUDAH server menyimpan tapi SEBELUM
   * balasannya sampai membuat petugas menekan Simpan lagi — dan sesi kedua
   * lahir dengan hitungan yang sama persis. Nilainya memang tak ikut salah
   * (opname adalah baseline MUTLAK, bukan selisih, jadi dua baseline identik
   * mendarat di angka yang sama), tapi riwayatnya jadi dua sesi kembar dan
   * owner harus meng-ACC dua kali untuk satu penghitungan.
   *
   * Sama seperti jalur lain: kosong/absen → diabaikan, jadi klien lama tak
   * berubah perilakunya.
   */
  client_ref: clientRefField,
  device_id: deviceIdField,
  items: z
    .array(
      z.object({
        ingredient_id: z.string().uuid(),
        qty: z.number().min(0),
        /**
         * Bukti foto + alasan selisih dilampirkan LANGSUNG saat pengecekan
         * (bukan lewat langkah klarifikasi terpisah). Hanya dipakai untuk baris
         * yang berselisih; baris cocok mengabaikannya. Foto membuat baris
         * "sudah diklarifikasi" → siap di-ACC owner/admin. Opsional di API demi
         * kompatibilitas (mis. mobile lama); web mewajibkan foto tiap selisih.
         */
        foto_url: z.string().nullish(),
        alasan: z.string().nullish(),
      }),
    )
    .min(1),
});

// Stok Awal (saldo pembuka) = OpnameBody + tanggal berlaku. Berbeda dari opname
// fisik: stok awal itu SATU saldo pembuka per bahan yang terkunci pada tanggal
// tertentu (bukan tumpukan reset di banyak tanggal) — diganti (upsert), bukan
// ditambah. Ubah nilai / tanggal = simpan ulang di tanggal itu.
const StokAwalBody = OpnameBody.omit({ client_ref: true, device_id: true }).extend({
  /**
   * `client_ref`/`device_id` SENGAJA TIDAK diwarisi dari `OpnameBody`.
   *
   * Endpoint ini sudah idempoten SECARA KONSTRUKSI: penulisannya
   * hapus-lalu-sisip atas kunci `(company, branch, session_id IS NULL,
   * ingredient_id)`, jadi kiriman yang sama dua kali mendarat di baris yang
   * sama persis — tak ada sesi kembar yang bisa lahir (sessionId memang null di
   * sini, jadi ia bahkan tak muncul di Riwayat Opname).
   *
   * Mewarisi kuncinya akan membuat skema MENERIMA field yang rutenya abaikan:
   * klien yang mengirimkannya mengira dilindungi padahal tidak, dan diamnya
   * jauh lebih buruk daripada tidak menawarkannya sama sekali. Kalau suatu
   * saat penulisan di sini berubah jadi menambah (bukan mengganti), kuncinya
   * ditambahkan BERSAMA penanganannya — bukan mendahului.
   */
  /** tanggal berlaku saldo pembuka (YYYY-MM-DD, zona perusahaan). Default hari ini. */
  tanggal: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal harus YYYY-MM-DD")
    .optional(),
});

/**
 * Status ACC sesi opname dari agregat baris: sesi menunggu ACC bila ada baris
 * berselisih yang masih 'menunggu'; disetujui bila selisih sudah diterapkan;
 * ditolak bila selisih dibuang; cocok bila tak ada selisih sama sekali.
 */
function statusSesi(r: {
  n_menunggu: number;
  n_disetujui: number;
  n_ditolak: number;
}): OpnameSesiStatus {
  if (r.n_menunggu > 0) return "menunggu";
  if (r.n_disetujui > 0) return "disetujui";
  if (r.n_ditolak > 0) return "ditolak";
  return "cocok";
}

export const stokRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const auth = c.get("auth");
    const branchId = await resolveBranchId(c);
    return c.json(await hitungSaldoCabang(auth.company_id!, branchId));
  })
  /** Kartu stok: buku besar mutasi satu bahan (halaman terpisah di web). */
  .get("/kartu/:ingredientId", async (c) => {
    const auth = c.get("auth");
    const branchId = await resolveBranchId(c);

    const [ing] = await db
      .select()
      .from(ingredients)
      .where(
        and(
          eq(ingredients.id, c.req.param("ingredientId")),
          eq(ingredients.companyId, auth.company_id!),
        ),
      );
    if (!ing) throw new HTTPException(404, { message: "Bahan tidak ditemukan" });
    if (!ing.trackStok) {
      throw new HTTPException(400, {
        message: `Stok "${ing.nama}" tidak dilacak — tidak ada kartu stok`,
      });
    }

    const [company] = await db
      .select({ timezone: companies.timezone })
      .from(companies)
      .where(eq(companies.id, auth.company_id!));
    const tz = company?.timezone ?? "Asia/Jakarta";
    const tanggalValid = /^\d{4}-\d{2}-\d{2}$/;
    const sampaiQ = c.req.query("sampai");
    const dariQ = c.req.query("dari");
    const sampai = sampaiQ && tanggalValid.test(sampaiQ) ? sampaiQ : tanggalDi(tz);
    const dari =
      dariQ && tanggalValid.test(dariQ)
        ? dariQ
        : tanggalDi(tz, new Date(Date.now() - 29 * 24 * 3600 * 1000));

    return c.json(
      await kartuStok({
        branchId,
        ingredientId: ing.id,
        dari,
        sampai,
        bahan: { id: ing.id, nama: ing.nama, slug: ing.slug, satuan: ing.satuan },
      }),
    );
  })
  /**
   * KARTU FIFO satu bahan pada satu cabang: riwayat penggunaan barang dari lot
   * PALING AWAL masuk (First-In First-Out) — lot masuk + terpakai/sisa per lot
   * + rincian tiap pemakaian mengambil dari lot mana. Saldo akhir walk sama
   * dengan saldo ledger (sumber peristiwa identik dgn hitungSaldoCabang).
   */
  .get("/fifo/:ingredientId", async (c) => {
    const auth = c.get("auth");
    const branchId = await resolveBranchId(c);

    const [ing] = await db
      .select()
      .from(ingredients)
      .where(
        and(
          eq(ingredients.id, c.req.param("ingredientId")),
          eq(ingredients.companyId, auth.company_id!),
        ),
      );
    if (!ing) throw new HTTPException(404, { message: "Bahan tidak ditemukan" });
    if (!ing.trackStok) {
      throw new HTTPException(400, {
        message: `Stok "${ing.nama}" tidak dilacak — tidak ada kartu FIFO`,
      });
    }

    const [company] = await db
      .select({ metodeHpp: companies.metodeHpp })
      .from(companies)
      .where(eq(companies.id, auth.company_id!));

    return c.json(
      await fifoBahan({
        companyId: auth.company_id!,
        branchId,
        bahan: { id: ing.id, nama: ing.nama, satuan: ing.satuan },
        hargaAcuan: hargaPerUnit(ing.hargaBeli, ing.isi),
        metodeHpp: company?.metodeHpp ?? "average",
      }),
    );
  })
  /**
   * PERINGATAN EXP: lot (baris faktur masuk stok) yang hampir/lewat tanggal
   * kedaluwarsa dalam `hari` ke depan (default 7, clamp 0–60). APROKSIMASI:
   * ledger stok agregat tanpa FIFO — qty_masuk = qty saat lot masuk, BUKAN
   * sisa lot; saldo live bahan disandingkan agar user menilai sendiri.
   * Lot sebelum baseline opname terakhir bahan itu dikecualikan (predikat
   * HARUS identik dengan hitungSaldoCabang: waktu > baseline.created_at,
   * penyesuaian_status 'disetujui') — opname me-reset lot juga.
   */
  .get("/exp", async (c) => {
    const auth = c.get("auth");
    const branchId = await resolveBranchId(c);
    const hariQ = Number(c.req.query("hari") ?? 7);
    const hari = Number.isFinite(hariQ) ? Math.min(60, Math.max(0, Math.trunc(hariQ))) : 7;

    const [company] = await db
      .select({ timezone: companies.timezone })
      .from(companies)
      .where(eq(companies.id, auth.company_id!));
    const today = tanggalDi(company?.timezone ?? "Asia/Jakarta");

    const result = await db.execute(sql`
      SELECT
        pr.id            AS production_id,
        pr.ingredient_id AS ingredient_id,
        i.nama           AS nama,
        i.satuan         AS satuan,
        pr.qty           AS qty_masuk,
        pr.exp_date      AS exp_date,
        pr.prod_date     AS prod_date,
        pr.tipe          AS tipe,
        pr.faktur_id     AS faktur_id,
        dn.nomor_teks    AS nomor,
        slk.nama         AS tempat,
        (pr.exp_date - ${today}::date) AS sisa_hari
      FROM productions pr
      JOIN ingredients i ON i.id = pr.ingredient_id
        AND i.is_active AND i.track_stok
      LEFT JOIN storage_locations slk ON slk.id = pr.storage_location_id
      LEFT JOIN dokumen_nomor dn
        ON dn.company_id = pr.company_id AND dn.ref_id = pr.faktur_id
      LEFT JOIN LATERAL (
        SELECT so.created_at
        FROM stock_opnames so
        WHERE so.branch_id = pr.branch_id AND so.ingredient_id = pr.ingredient_id
          AND so.penyesuaian_status = 'disetujui'
        ORDER BY so.created_at DESC
        LIMIT 1
      ) b ON TRUE
      WHERE pr.company_id = ${auth.company_id!} AND pr.branch_id = ${branchId}
        AND pr.status = 'dikonfirmasi' AND pr.deleted_at IS NULL
        AND pr.exp_date IS NOT NULL
        AND pr.exp_date <= ${today}::date + ${hari}::int
        AND (b.created_at IS NULL OR pr.waktu > b.created_at)
      ORDER BY pr.exp_date ASC, i.nama ASC
      LIMIT 300
    `);

    // saldo live per bahan (semua lot) — konteks menilai sisa
    const saldoRows = await hitungSaldoCabang(auth.company_id!, branchId);
    const saldoById = new Map(saldoRows.map((r) => [r.ingredient_id, r.saldo]));
    const items = result.rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        production_id: String(row.production_id),
        ingredient_id: String(row.ingredient_id),
        nama: String(row.nama),
        satuan: String(row.satuan),
        qty_masuk: Number(row.qty_masuk),
        exp_date: String(row.exp_date),
        prod_date: String(row.prod_date),
        tipe: row.tipe as "beli" | "produksi",
        faktur_id: row.faktur_id ? String(row.faktur_id) : null,
        nomor: row.nomor ? String(row.nomor) : null,
        tempat: row.tempat ? String(row.tempat) : null,
        saldo: saldoById.get(String(row.ingredient_id)) ?? 0,
        sisa_hari: Number(row.sisa_hari),
      };
    });
    return c.json(items);
  })
  /**
   * CATAT WASTE (mis. bahan kedaluwarsa): memotong stok lewat mekanisme
   * penyesuaian yang SUDAH ADA — satu baris stock_opnames (sesi tersendiri)
   * dengan qty fisik = saldo − qty waste, kategori 'waste_bahan', bukti foto
   * WAJIB, status 'menunggu' → efektif SETELAH di-ACC owner/admin di Riwayat
   * SO (stok tidak langsung berubah). Catatan: dua waste beruntun sebelum ACC
   * saling menimpa baseline (semantik opname "fisik terakhir menang") — UI
   * meng-invalidate agresif untuk meminimalkan.
   */
  .post(
    "/waste",
    requireRole("owner", "admin", "cashier", "tim", "kitchen", "bar"),
    zValidator(
      "json",
      z.object({
        branch_id: z.string().uuid().optional(),
        ingredient_id: z.string().uuid(),
        qty: z.number().positive(),
        foto_url: z.string().trim().min(1, "Bukti foto wajib dilampirkan"),
        catatan: z.string().trim().max(300).nullish(),
      }),
    ),
    async (c) => {
      const auth = c.get("auth");
      const body = c.req.valid("json");
      const branchId = await branchUntukTulis(
        c,
        body.branch_id,
        "Anda hanya boleh mencatat waste di cabang Anda",
      );

      const [ing] = await db
        .select({ id: ingredients.id, nama: ingredients.nama, trackStok: ingredients.trackStok })
        .from(ingredients)
        .where(
          and(eq(ingredients.id, body.ingredient_id), eq(ingredients.companyId, auth.company_id!)),
        );
      if (!ing || !ing.trackStok) {
        throw new HTTPException(400, { message: "Bahan tidak valid atau stoknya tidak dilacak" });
      }

      const saldoRows = await hitungSaldoCabang(auth.company_id!, branchId);
      const saldo = saldoRows.find((r) => r.ingredient_id === ing.id)?.saldo ?? 0;
      if (body.qty > saldo + 1e-9) {
        throw new HTTPException(400, {
          message: `Qty waste melebihi saldo (${saldo}) — periksa lagi jumlahnya`,
        });
      }

      const [company] = await db
        .select({ timezone: companies.timezone })
        .from(companies)
        .where(eq(companies.id, auth.company_id!));
      const today = tanggalDi(company?.timezone ?? "Asia/Jakarta");
      const sessionId = randomUUID();
      const nowTs = new Date();
      const { nomor } = await db.transaction(async (tx) => {
        await tx.insert(stockOpnames).values({
          companyId: auth.company_id!,
          branchId,
          ingredientId: ing.id,
          qty: saldo - body.qty,
          opnameDate: today,
          catatan: "Catat waste",
          sessionId,
          systemQty: saldo,
          selisih: -body.qty,
          klarifikasiStatus: "sudah",
          penyesuaianKategori: "waste_bahan",
          klarifikasiCatatan: body.catatan?.trim() || null,
          klarifikasiFotoUrl: body.foto_url.trim(),
          klarifikasiBy: auth.sub,
          klarifikasiAt: nowTs,
          penyesuaianStatus: "menunggu",
          userId: auth.sub,
        });
        const nomorTeks = await terbitkanNomor(tx, auth.company_id!, "opname", sessionId);
        return { nomor: nomorTeks };
      });
      return c.json({ ok: true, session_id: sessionId, nomor }, 201);
    },
  )
  /**
   * Stock opname: bandingkan fisik vs sistem. owner/admin + peran terikat
   * cabang (kasir & tim, terkunci cabangnya + hanya tempat yang ditugaskan).
   * Menyimpan snapshot saldo sistem + selisih per sesi, qty fisik jadi
   * baseline saldo baru. Persetujuan selisih tetap owner/admin.
   */
  .post("/opname", requireRole("owner", "admin", "cashier", "tim", "kitchen", "bar"), zValidator("json", OpnameBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    /*
     * KLAIM ATOMIK sebelum eksekusi — cabang belum di-resolve dan penjaga
     * petugas belum jalan di sini, dan itu disengaja: yang dijaga SELURUH
     * badan handler, termasuk pemeriksaan yang bisa melempar.
     */
    const { data } = await denganKlaimIdempoten(
      {
        companyId: auth.company_id!,
        clientRef: body.client_ref,
        userId: auth.sub,
        deviceId: body.device_id ?? null,
        tipe: "opname",
      },
      async () => {
        const branchId = await branchUntukTulis(
          c,
          body.branch_id,
          "Anda hanya boleh opname di cabang Anda",
        );

        // Gabungkan duplikat (entri terakhir menang)
        const qtyByIngredient = new Map<string, number>();
        // Bukti foto + alasan selisih per bahan (dilampirkan saat pengecekan)
        const fotoByIngredient = new Map<string, string | null>();
        const alasanByIngredient = new Map<string, string | null>();
        for (const item of body.items) {
          qtyByIngredient.set(item.ingredient_id, item.qty);
          fotoByIngredient.set(item.ingredient_id, item.foto_url?.trim() || null);
          alasanByIngredient.set(item.ingredient_id, item.alasan?.trim() || null);
        }

        const ids = [...qtyByIngredient.keys()];
        const valid = await db
          .select({ id: ingredients.id })
          .from(ingredients)
          .where(
            and(
              eq(ingredients.companyId, auth.company_id!),
              eq(ingredients.trackStok, true),
              inArray(ingredients.id, ids),
            ),
          );
        if (valid.length !== ids.length) {
          throw new HTTPException(400, {
            message: "Ada bahan yang tidak valid atau stoknya tidak dilacak",
          });
        }

        const [company] = await db
          .select({ timezone: companies.timezone })
          .from(companies)
          .where(eq(companies.id, auth.company_id!));
        const today = tanggalDi(company?.timezone ?? "Asia/Jakarta");

        // Snapshot saldo sistem per bahan (sebelum opname mengubahnya)
        const saldoRows = await hitungSaldoCabang(auth.company_id!, branchId);
        /*
         * BARANG YANG SUDAH BERANGKAT BUKAN BARANG YANG SEHARUSNYA ADA DI RAK.
         *
         * `hitungSaldoCabang` sengaja masih memuat kiriman yang belum diterima —
         * pengurangannya baru terjadi saat statusnya `dikonfirmasi` (subquery
         * `kirim_keluar`). Itu benar untuk perencanaan dan agar barangnya tak
         * "hilang" dari pembukuan selagi di jalan. Tapi opname membandingkan buku
         * dengan APA YANG ADA DI RAK, dan barang yang sudah dimuat ke kendaraan
         * tak bisa dihitung petugas. Tanpa potongan ini, tiap kiriman yang sedang
         * berjalan muncul sebagai SELISIH KURANG: petugas menghitung benar, sistem
         * tetap melaporkan barang hilang, dan selisih hantu itu harus di-ACC owner
         * sebagai penyusutan — catatan yang menuduh kehilangan.
         *
         * YANG DIPOTONG HANYA `qtyDiJalan`, BUKAN `qtyDalamJalan`. Keduanya beda,
         * dan memakai yang salah justru merusak: `qtyDalamJalan` ikut menghitung
         * baris "siap dikirim" dan "selesai diproduksi", yang barangnya MASIH DI
         * RAK. Memotongnya membuat baseline opname mengecualikan barang yang
         * sebenarnya ada, lalu penerimaannya menguranginya sekali lagi — saldo CK
         * jatuh ke MINUS. Itu bukan dugaan; versi pertama perbaikan ini
         * melakukannya persis begitu dan verify-api menangkapnya di −10.
         *
         * Tak ada pengurangan ganda di sini: `kirim_keluar` menyaring
         * `pr.waktu > b.created_at`, sementara `waktu` tetap waktu baris dibuat
         * (mengirim hanya menyentuh `branch_id`/`updated_at`). Kiriman yang sudah
         * berangkat sebelum opname karena itu jatuh di luar jendela baseline.
         *
         * Cabang toko tak terpengaruh: penyaringnya `asal_branch_id = cabang ini`,
         * dan toko tak mengirim ke mana-mana.
         */
        const diJalanById = await qtyDiJalan(db, auth.company_id!, branchId);
        const saldoById = new Map(
          saldoRows.map((r) => [
            r.ingredient_id,
            Math.max(0, r.saldo - (diJalanById.get(r.ingredient_id) ?? 0)),
          ]),
        );
        const infoById = new Map(saldoRows.map((r) => [r.ingredient_id, r]));

        // Batasan petugas: peran terikat cabang (kasir/tim) hanya boleh opname
        // bahan di tempat yang terbuka (belum ada petugas) atau tempat yang
        // ditugaskan padanya. Bahan tanpa tempat boleh siapa saja. Owner/admin
        // selalu boleh. HANYA petugas yang masih ANGGOTA AKTIF yang dihitung —
        // penugasan basi (akun dihapus/nonaktif/diarsip/dibuat ulang) tidak boleh
        // mengunci rak diam-diam untuk semua orang.
        if (terikatCabang(auth.role)) {
          const petugasRows = await db
            .select({
              locId: storageLocationPetugas.storageLocationId,
              userId: storageLocationPetugas.userId,
            })
            .from(storageLocationPetugas)
            .innerJoin(
              users,
              and(
                eq(storageLocationPetugas.userId, users.id),
                eq(users.isActive, true),
                isNull(users.deletedAt),
              ),
            )
            .innerJoin(
              memberships,
              and(
                eq(memberships.userId, users.id),
                eq(memberships.companyId, auth.company_id!),
                isNull(memberships.archivedAt),
              ),
            )
            .where(eq(storageLocationPetugas.companyId, auth.company_id!));
          const lockedSet = new Set(petugasRows.map((r) => r.locId));
          const mineSet = new Set(
            petugasRows.filter((r) => r.userId === auth.sub).map((r) => r.locId),
          );
          for (const ingredientId of ids) {
            const info = infoById.get(ingredientId);
            const tempatId = info?.tempat_id ?? null;
            if (tempatId && lockedSet.has(tempatId) && !mineSet.has(tempatId)) {
              throw new HTTPException(403, {
                message: `Anda bukan petugas opname tempat "${info?.tempat ?? "?"}" (bahan ${info?.nama ?? ""})`,
              });
            }
          }
        }

        const sessionId = randomUUID();
        const ringkasan: OpnameRingkasan = {
          dihitung: qtyByIngredient.size,
          cocok: 0,
          lebih: 0,
          kurang: 0,
          total_selisih: 0,
        };
        const nowTs = new Date();
        const values = [...qtyByIngredient].map(([ingredientId, fisik]) => {
          const sistem = saldoById.get(ingredientId) ?? 0;
          const selisih = fisik - sistem;
          const adaSelisih = Math.abs(selisih) > 1e-9;
          if (!adaSelisih) ringkasan.cocok++;
          else if (selisih > 0) ringkasan.lebih++;
          else ringkasan.kurang++;
          ringkasan.total_selisih += selisih;
          // Bukti foto + alasan hanya bermakna untuk baris berselisih. Bila foto
          // dilampirkan saat pengecekan → baris langsung "sudah" (siap di-ACC);
          // tanpa foto → "belum" (jalur klarifikasi terpisah, kompatibel lama).
          const foto = adaSelisih ? (fotoByIngredient.get(ingredientId) ?? null) : null;
          const alasan = adaSelisih ? (alasanByIngredient.get(ingredientId) ?? null) : null;
          return {
            companyId: auth.company_id!,
            branchId,
            ingredientId,
            qty: fisik,
            opnameDate: today,
            catatan: body.catatan ?? null,
            sessionId,
            systemQty: sistem,
            selisih,
            // selisih ≠ 0 → wajib diklarifikasi; foto inline menuntaskannya langsung.
            klarifikasiStatus: adaSelisih ? (foto ? ("sudah" as const) : ("belum" as const)) : null,
            klarifikasiCatatan: alasan,
            klarifikasiFotoUrl: foto,
            ...(foto ? { klarifikasiBy: auth.sub, klarifikasiAt: nowTs } : {}),
            // selisih ≠ 0 → menunggu persetujuan owner/admin sebelum jadi baseline
            // saldo (stok belum berubah); selisih = 0 langsung efektif (no-op).
            penyesuaianStatus: adaSelisih ? ("menunggu" as const) : ("disetujui" as const),
            userId: auth.sub,
          };
        });

        const { rows, nomor } = await db.transaction(async (tx) => {
          const inserted = await tx.insert(stockOpnames).values(values).returning();
          const nomorTeks = await terbitkanNomor(tx, auth.company_id!, "opname", sessionId);
          return { rows: inserted, nomor: nomorTeks };
        });
        const hasil = { ok: true, jumlah: rows.length, session_id: sessionId, nomor, ringkasan };
        return hasil;
      },
    );
    return c.json(data, 201);
  })
  /**
   * Nilai Stok Awal (saldo pembuka) yang tersimpan per bahan + tanggalnya —
   * untuk mengisi ulang form (edit), bukan saldo live. Satu entri per bahan
   * (session_id NULL = baris stok awal, bukan sesi opname fisik). Owner/admin.
   */
  .get("/awal", requireRole("owner", "admin"), async (c) => {
    const auth = c.get("auth");
    const branchId = await resolveBranchId(c);
    const [company] = await db
      .select({ timezone: companies.timezone })
      .from(companies)
      .where(eq(companies.id, auth.company_id!));
    const today = tanggalDi(company?.timezone ?? "Asia/Jakarta");
    const res = await db.execute(sql`
      SELECT DISTINCT ON (so.ingredient_id)
        so.ingredient_id, so.qty, so.opname_date
      FROM stock_opnames so
      WHERE so.company_id = ${auth.company_id!} AND so.branch_id = ${branchId}
        AND so.session_id IS NULL AND so.penyesuaian_status = 'disetujui'
      ORDER BY so.ingredient_id, so.created_at DESC
    `);
    const items = res.rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        ingredient_id: String(row.ingredient_id),
        qty: Number(row.qty),
        tanggal: String(row.opname_date),
      };
    });
    // Tanggal default form = tanggal saldo pembuka terkini (terkunci), atau hari ini
    const tanggal = items.length ? items.map((i) => i.tanggal).sort().at(-1)! : today;
    return c.json({ tanggal, items });
  })
  /**
   * Stok Awal (saldo pembuka): SATU saldo pembuka per bahan, terkunci pada
   * tanggal tertentu. Ditulis sebagai baris opname langsung DISETUJUI (tanpa
   * selisih / persetujuan) → baseline saldo seketika via hitungSaldoCabang
   * (menetapkan, bukan menambah). Bersifat UPSERT: entri stok awal (session_id
   * NULL) lama bahan yang sama diganti, jadi tak menumpuk di banyak tanggal —
   * ubah nilai/tanggal = simpan ulang. Owner/admin.
   */
  .post("/awal", requireRole("owner", "admin"), zValidator("json", StokAwalBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const branchId = body.branch_id
      ? await pastikanCabang(body.branch_id, auth.company_id!)
      : await resolveBranchId(c);

    // Gabungkan duplikat (entri terakhir menang)
    const qtyByIngredient = new Map<string, number>();
    for (const item of body.items) qtyByIngredient.set(item.ingredient_id, item.qty);

    const ids = [...qtyByIngredient.keys()];
    const valid = await db
      .select({ id: ingredients.id })
      .from(ingredients)
      .where(
        and(
          eq(ingredients.companyId, auth.company_id!),
          eq(ingredients.trackStok, true),
          inArray(ingredients.id, ids),
        ),
      );
    if (valid.length !== ids.length) {
      throw new HTTPException(400, {
        message: "Ada bahan yang tidak valid atau stoknya tidak dilacak",
      });
    }

    const [company] = await db
      .select({ timezone: companies.timezone })
      .from(companies)
      .where(eq(companies.id, auth.company_id!));
    const tz = company?.timezone ?? "Asia/Jakarta";
    const today = tanggalDi(tz);
    const tanggal = body.tanggal ?? today;
    // Waktu baris: saldo pembuka bertanggal LAMPAU dicatat pada AWAL hari itu
    // DI ZONA PERUSAHAAN, agar tampil di kartu stok pada tanggal itu &
    // aktivitas sesudahnya dihitung di atasnya. Tengah malam UTC hanya
    // TERLIHAT seperti awal hari: di WIB ia jam 07:00, sehingga mutasi antara
    // 00:00–07:00 pada tanggal itu jatuh SEBELUM baseline dan hilang dari
    // saldo — persis jam barang datang. Tanggal = hari ini (reset) → pakai
    // waktu kini agar mutasi yang sudah terjadi hari ini tetap dianggap
    // SETELAH baseline (perilaku reset saldo tak berubah).
    const createdAt = tanggal < today ? awalHariDi(tz, tanggal) : new Date();

    // Baris baseline: systemQty/selisih/klarifikasi DIBIARKAN null → bukan
    // penyesuaian; penyesuaian_status 'disetujui' → langsung efektif. sessionId
    // sengaja null agar TIDAK muncul di Riwayat Opname (bukan sesi hitung fisik;
    // tetap terekam di kartu stok bahan).
    const rows = await db.transaction(async (tx) => {
      // UPSERT: ganti entri stok awal (session_id NULL) lama bahan-bahan ini →
      // hanya ada SATU saldo pembuka per bahan (opname fisik/session_id NOT NULL
      // tak tersentuh).
      await tx.delete(stockOpnames).where(
        and(
          eq(stockOpnames.companyId, auth.company_id!),
          eq(stockOpnames.branchId, branchId),
          isNull(stockOpnames.sessionId),
          inArray(stockOpnames.ingredientId, ids),
        ),
      );
      const values = [...qtyByIngredient].map(([ingredientId, qty]) => ({
        companyId: auth.company_id!,
        branchId,
        ingredientId,
        qty,
        opnameDate: tanggal,
        catatan: body.catatan?.trim() || "Stok awal",
        penyesuaianStatus: "disetujui" as const,
        userId: auth.sub,
        createdAt,
      }));
      return tx.insert(stockOpnames).values(values).returning();
    });
    return c.json({ ok: true, jumlah: rows.length, tanggal }, 201);
  })
  /**
   * Daftar penyesuaian stok: baris opname dengan selisih ≠ 0 yang perlu
   * diklarifikasi karyawan (waste vs koreksi pencatatan).
   */
  .get("/penyesuaian", async (c) => {
    const auth = c.get("auth");
    const branchId = await resolveBranchId(c);
    const status = c.req.query("status"); // 'belum' | 'menunggu_persetujuan' | undefined
    const inputUser = alias(users, "input_user");
    const klarUser = alias(users, "klar_user");
    const setujuUser = alias(users, "setuju_user");

    const conds = [
      eq(stockOpnames.companyId, auth.company_id!),
      eq(stockOpnames.branchId, branchId),
      isNotNull(stockOpnames.selisih),
      ne(stockOpnames.selisih, 0),
    ];
    if (status === "belum") {
      // perlu klarifikasi karyawan
      conds.push(eq(stockOpnames.klarifikasiStatus, "belum"));
    } else if (status === "menunggu_persetujuan") {
      // sudah diklarifikasi, menunggu owner/admin menyetujui
      conds.push(eq(stockOpnames.klarifikasiStatus, "sudah"));
      conds.push(eq(stockOpnames.penyesuaianStatus, "menunggu"));
    }

    const rows = await db
      .select({
        id: stockOpnames.id,
        waktu: stockOpnames.createdAt,
        bahan: ingredients.nama,
        satuan: ingredients.satuan,
        system_qty: stockOpnames.systemQty,
        qty_fisik: stockOpnames.qty,
        selisih: stockOpnames.selisih,
        klarifikasi_status: stockOpnames.klarifikasiStatus,
        penyesuaian_status: stockOpnames.penyesuaianStatus,
        kategori: stockOpnames.penyesuaianKategori,
        catatan: stockOpnames.klarifikasiCatatan,
        foto_url: stockOpnames.klarifikasiFotoUrl,
        tolak_alasan: stockOpnames.tolakAlasan,
        oleh: inputUser.nama,
        diklarifikasi_oleh: klarUser.nama,
        disetujui_oleh: setujuUser.nama,
      })
      .from(stockOpnames)
      .innerJoin(ingredients, eq(stockOpnames.ingredientId, ingredients.id))
      .leftJoin(inputUser, eq(stockOpnames.userId, inputUser.id))
      .leftJoin(klarUser, eq(stockOpnames.klarifikasiBy, klarUser.id))
      .leftJoin(setujuUser, eq(stockOpnames.disetujuiBy, setujuUser.id))
      .where(and(...conds))
      .orderBy(desc(stockOpnames.createdAt))
      .limit(300);
    return c.json(
      rows.map((r) => ({
        ...r,
        klarifikasi_status: r.klarifikasi_status ?? "belum",
      })),
    );
  })
  /**
   * Klarifikasi satu penyesuaian: pilih kategori (waste/koreksi) + catatan.
   * HANYA owner/admin — kasir cukup melakukan opname; penilaian selisih
   * (waste vs koreksi) diputuskan manajemen.
   */
  .post(
    "/penyesuaian/:id/klarifikasi",
    requireRole("owner", "admin"),
    zValidator(
      "json",
      z.object({
        kategori: z.enum([
          "waste_bahan",
          "waste_matang",
          "waste_gagal",
          "koreksi_pencatatan",
          "lainnya",
        ]),
        catatan: z.string().nullish(),
        /** bukti foto WAJIB */
        foto_url: z.string().min(1, "Bukti foto wajib dilampirkan"),
      }),
    ),
    async (c) => {
      const auth = c.get("auth");
      const body = c.req.valid("json");

      const [row] = await db
        .select({
          branchId: stockOpnames.branchId,
          selisih: stockOpnames.selisih,
          penyesuaianStatus: stockOpnames.penyesuaianStatus,
        })
        .from(stockOpnames)
        .where(
          and(
            eq(stockOpnames.id, c.req.param("id")),
            eq(stockOpnames.companyId, auth.company_id!),
          ),
        );
      if (!row) throw new HTTPException(404, { message: "Penyesuaian tidak ditemukan" });
      if (!row.selisih || Math.abs(row.selisih) < 1e-9) {
        throw new HTTPException(400, { message: "Baris ini tidak punya selisih" });
      }
      if (row.penyesuaianStatus === "disetujui") {
        throw new HTTPException(400, {
          message: "Penyesuaian sudah disetujui — klarifikasi terkunci",
        });
      }

      /*
       * PAGARNYA DI SINI, BUKAN DI PRA-CEK DI ATAS.
       *
       * Pra-cek `SELECT` dan penulisan `UPDATE` adalah dua pernyataan;
       * persetujuan yang commit di antaranya tak terlihat oleh keputusan yang
       * sudah diambil. Yang tertimpa bukan angka stoknya melainkan BUKTINYA —
       * kategori, catatan, foto, dan siapa yang mengklarifikasi — pada baris
       * yang sudah disetujui. Penyetujunya menyetujui bukti A; catatannya
       * berakhir berbunyi B, tanpa jejak bahwa itu pernah berubah.
       *
       * `ne(…, "disetujui")` dan bukan `eq(…, "menunggu")`: baris yang DITOLAK
       * memang dimaksudkan untuk diklarifikasi ulang — itu sebabnya
       * `tolakAlasan` dibersihkan di bawah.
       *
       * Lima dari enam penulisan ke tabel ini sudah memagari dirinya di WHERE;
       * yang ini pintu yang terlewat. Dijaga `test/penyesuaian-terkunci.test.ts`.
       */
      const ubah = await db
        .update(stockOpnames)
        .set({
          klarifikasiStatus: "sudah",
          penyesuaianKategori: body.kategori,
          klarifikasiCatatan: body.catatan ?? null,
          klarifikasiFotoUrl: body.foto_url,
          klarifikasiBy: auth.sub,
          klarifikasiAt: new Date(),
          // klarifikasi baru → bersihkan alasan penolakan sebelumnya
          tolakAlasan: null,
        })
        .where(
          and(
            eq(stockOpnames.id, c.req.param("id")),
            eq(stockOpnames.companyId, auth.company_id!),
            ne(stockOpnames.penyesuaianStatus, "disetujui"),
          ),
        )
        .returning({ id: stockOpnames.id });
      if (ubah.length === 0) {
        // Kalah balapan dengan persetujuan. Pesannya SENGAJA sama dengan
        // pra-cek di atas — bagi pengirimnya kejadiannya memang satu hal yang
        // sama, dan sebab baru justru terbaca asing.
        throw new HTTPException(409, {
          message: "Penyesuaian sudah disetujui — klarifikasi terkunci",
        });
      }
      return c.json({ ok: true });
    },
  )
  /**
   * Setujui penyesuaian: owner/admin memeriksa selisih yang sudah diklarifikasi
   * lalu menyetujuinya — baru saat itu baris opname jadi baseline saldo (stok
   * disesuaikan ke fisik). Idempoten via predikat status 'menunggu'.
   */
  .post("/penyesuaian/:id/setujui", requireRole("owner", "admin"), async (c) => {
    const auth = c.get("auth");
    const [row] = await db
      .select({
        klarifikasiStatus: stockOpnames.klarifikasiStatus,
        selisih: stockOpnames.selisih,
      })
      .from(stockOpnames)
      .where(
        and(eq(stockOpnames.id, c.req.param("id")), eq(stockOpnames.companyId, auth.company_id!)),
      );
    if (!row) throw new HTTPException(404, { message: "Penyesuaian tidak ditemukan" });
    if (!row.selisih || Math.abs(row.selisih) < 1e-9) {
      throw new HTTPException(400, { message: "Baris ini tidak punya selisih" });
    }
    if (row.klarifikasiStatus !== "sudah") {
      throw new HTTPException(400, { message: "Harus diklarifikasi dulu sebelum disetujui" });
    }
    const done = await db
      .update(stockOpnames)
      .set({ penyesuaianStatus: "disetujui", disetujuiBy: auth.sub, disetujuiAt: new Date() })
      .where(
        and(
          eq(stockOpnames.id, c.req.param("id")),
          eq(stockOpnames.companyId, auth.company_id!),
          eq(stockOpnames.penyesuaianStatus, "menunggu"),
        ),
      )
      .returning({ id: stockOpnames.id });
    if (done.length === 0) {
      throw new HTTPException(404, { message: "Penyesuaian sudah disetujui atau tidak ditemukan" });
    }
    return c.json({ ok: true });
  })
  /**
   * Tolak penyesuaian: owner/admin mengembalikan ke karyawan untuk klarifikasi
   * ulang (stok tidak berubah). Wajib menyertakan alasan.
   */
  .post(
    "/penyesuaian/:id/tolak",
    requireRole("owner", "admin"),
    zValidator("json", z.object({ alasan: z.string().min(1, "Alasan penolakan wajib diisi") })),
    async (c) => {
      const auth = c.get("auth");
      const body = c.req.valid("json");
      const done = await db
        .update(stockOpnames)
        .set({ klarifikasiStatus: "belum", tolakAlasan: body.alasan })
        .where(
          and(
            eq(stockOpnames.id, c.req.param("id")),
            eq(stockOpnames.companyId, auth.company_id!),
            eq(stockOpnames.klarifikasiStatus, "sudah"),
            eq(stockOpnames.penyesuaianStatus, "menunggu"),
          ),
        )
        .returning({ id: stockOpnames.id });
      if (done.length === 0) {
        throw new HTTPException(404, {
          message: "Penyesuaian tidak menunggu persetujuan / tidak ditemukan",
        });
      }
      return c.json({ ok: true });
    },
  )
  /** Setujui semua penyesuaian yang sudah diklarifikasi pada satu cabang. */
  .post("/penyesuaian/setujui-massal", requireRole("owner", "admin"), async (c) => {
    const auth = c.get("auth");
    const branchId = await resolveBranchId(c);
    const done = await db
      .update(stockOpnames)
      .set({ penyesuaianStatus: "disetujui", disetujuiBy: auth.sub, disetujuiAt: new Date() })
      .where(
        and(
          eq(stockOpnames.companyId, auth.company_id!),
          eq(stockOpnames.branchId, branchId),
          eq(stockOpnames.klarifikasiStatus, "sudah"),
          eq(stockOpnames.penyesuaianStatus, "menunggu"),
        ),
      )
      .returning({ id: stockOpnames.id });
    return c.json({ ok: true, jumlah: done.length });
  })
  /** Riwayat sesi opname (digroup per session_id). */
  .get("/opname/riwayat", async (c) => {
    const auth = c.get("auth");
    const branchId = await resolveBranchId(c);
    const rows = await db
      .select({
        session_id: stockOpnames.sessionId,
        waktu: sql<string>`max(${stockOpnames.createdAt})`,
        user_id: sql<string>`max(${stockOpnames.userId}::text)`,
        catatan: sql<string>`max(${stockOpnames.catatan})`,
        // nomor sesi (SO-0001) — lookup terpisah di bawah (grup per sesi)
        jumlah_item: sql<number>`count(*)::int`,
        jumlah_selisih: sql<number>`count(*) FILTER (WHERE abs(coalesce(${stockOpnames.selisih}, 0)) > 1e-9)::int`,
        // agregat status ACC per sesi (hanya baris berselisih yang butuh ACC)
        n_menunggu: sql<number>`count(*) FILTER (WHERE ${stockOpnames.penyesuaianStatus} = 'menunggu' AND abs(coalesce(${stockOpnames.selisih}, 0)) > 1e-9)::int`,
        n_disetujui: sql<number>`count(*) FILTER (WHERE ${stockOpnames.penyesuaianStatus} = 'disetujui' AND abs(coalesce(${stockOpnames.selisih}, 0)) > 1e-9)::int`,
        n_ditolak: sql<number>`count(*) FILTER (WHERE ${stockOpnames.penyesuaianStatus} = 'ditolak')::int`,
      })
      .from(stockOpnames)
      .where(
        and(
          eq(stockOpnames.companyId, auth.company_id!),
          eq(stockOpnames.branchId, branchId),
          isNotNull(stockOpnames.sessionId),
        ),
      )
      .groupBy(stockOpnames.sessionId)
      .orderBy(desc(sql`max(${stockOpnames.createdAt})`))
      .limit(200);

    // resolusi nama user (opsional)
    const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))] as string[];
    const namaById = new Map<string, string>();
    if (userIds.length > 0) {
      const us = await db
        .select({ id: users.id, nama: users.nama })
        .from(users)
        .where(inArray(users.id, userIds));
      for (const u of us) namaById.set(u.id, u.nama);
    }

    const nomorBySesi = await nomorUntukRefs(
      db,
      auth.company_id!,
      rows.map((r) => r.session_id!).filter(Boolean),
    );

    return c.json(
      rows.map((r) => ({
        session_id: r.session_id,
        nomor: r.session_id ? (nomorBySesi.get(r.session_id) ?? null) : null,
        waktu: r.waktu,
        oleh: r.user_id ? (namaById.get(r.user_id) ?? null) : null,
        jumlah_item: r.jumlah_item,
        jumlah_selisih: r.jumlah_selisih,
        catatan: r.catatan,
        status: statusSesi(r),
      })),
    );
  })
  /** Detail satu sesi opname (fisik vs sistem vs selisih per bahan). */
  .get("/opname/sesi/:sessionId", async (c) => {
    const auth = c.get("auth");
    const rows = await db
      .select({
        id: stockOpnames.id,
        nama: ingredients.nama,
        satuan: ingredients.satuan,
        system_qty: stockOpnames.systemQty,
        qty_fisik: stockOpnames.qty,
        selisih: stockOpnames.selisih,
        waktu: stockOpnames.createdAt,
        catatan: stockOpnames.catatan,
        user_id: stockOpnames.userId,
        penyesuaian_status: stockOpnames.penyesuaianStatus,
        disetujui_by: stockOpnames.disetujuiBy,
        foto_url: stockOpnames.klarifikasiFotoUrl,
        alasan: stockOpnames.klarifikasiCatatan,
        tolak_alasan: stockOpnames.tolakAlasan,
      })
      .from(stockOpnames)
      .innerJoin(ingredients, eq(stockOpnames.ingredientId, ingredients.id))
      .where(
        and(
          eq(stockOpnames.companyId, auth.company_id!),
          eq(stockOpnames.sessionId, c.req.param("sessionId")),
        ),
      )
      .orderBy(desc(sql`abs(coalesce(${stockOpnames.selisih}, 0))`), ingredients.nama);
    if (rows.length === 0) throw new HTTPException(404, { message: "Sesi opname tidak ditemukan" });

    // agregat status dari baris (hanya baris berselisih yang butuh ACC)
    const agg = { n_menunggu: 0, n_disetujui: 0, n_ditolak: 0 };
    for (const r of rows) {
      const adaSelisih = Math.abs(r.selisih ?? 0) > 1e-9;
      if (r.penyesuaian_status === "menunggu" && adaSelisih) agg.n_menunggu++;
      else if (r.penyesuaian_status === "disetujui" && adaSelisih) agg.n_disetujui++;
      else if (r.penyesuaian_status === "ditolak") agg.n_ditolak++;
    }

    const reviewerId = rows.find((r) => r.disetujui_by)?.disetujui_by ?? null;
    const [oleh, ditinjau] = await Promise.all([
      rows[0].user_id
        ? db.select({ nama: users.nama }).from(users).where(eq(users.id, rows[0].user_id))
        : Promise.resolve([]),
      reviewerId
        ? db.select({ nama: users.nama }).from(users).where(eq(users.id, reviewerId))
        : Promise.resolve([]),
    ]);

    const nomorSesi = await nomorUntukRefs(db, auth.company_id!, [c.req.param("sessionId")]);
    return c.json({
      session_id: c.req.param("sessionId"),
      nomor: nomorSesi.get(c.req.param("sessionId")) ?? null,
      waktu: rows[0].waktu,
      oleh: oleh[0]?.nama ?? null,
      catatan: rows[0].catatan,
      status: statusSesi(agg),
      ditinjau_oleh: ditinjau[0]?.nama ?? null,
      items: rows.map((r) => ({
        id: r.id,
        nama: r.nama,
        satuan: r.satuan,
        system_qty: r.system_qty,
        qty_fisik: r.qty_fisik,
        selisih: r.selisih,
        penyesuaian_status: r.penyesuaian_status,
        foto_url: r.foto_url,
        alasan: r.alasan,
        tolak_alasan: r.tolak_alasan,
      })),
    });
  })
  /**
   * ACC (setujui) SATU sesi opname — HANYA owner/admin. Semua baris berselisih
   * yang masih 'menunggu' jadi 'disetujui' → selisih diterapkan ke stok
   * (baseline saldo). Tanpa langkah klarifikasi. Idempoten.
   */
  .post("/opname/sesi/:sessionId/acc", requireRole("owner", "admin"), async (c) => {
    const auth = c.get("auth");
    const sessionId = c.req.param("sessionId");
    // Body opsional { ids?: string[] }. Parse toleran: banyak pemanggil (verify,
    // tombol "ACC semua") POST tanpa body.
    const body = (await c.req.json().catch(() => ({}))) as { ids?: unknown };
    const ids = Array.isArray(body?.ids)
      ? body.ids.filter((x): x is string => typeof x === "string")
      : [];
    const [ada] = await db
      .select({ id: stockOpnames.id })
      .from(stockOpnames)
      .where(
        and(eq(stockOpnames.companyId, auth.company_id!), eq(stockOpnames.sessionId, sessionId)),
      )
      .limit(1);
    if (!ada) throw new HTTPException(404, { message: "Sesi opname tidak ditemukan" });
    // Per produk (ids diberikan): ACC baris itu saja, tanpa syarat status (boleh
    // membalik baris yang tadinya ditolak), dibatasi ke baris berselisih. Tanpa
    // ids: ACC semua baris berselisih yang masih 'menunggu' (perilaku lama).
    const filter =
      ids.length > 0
        ? and(
            eq(stockOpnames.companyId, auth.company_id!),
            eq(stockOpnames.sessionId, sessionId),
            inArray(stockOpnames.id, ids),
            sql`abs(coalesce(${stockOpnames.selisih}, 0)) > 1e-9`,
          )
        : and(
            eq(stockOpnames.companyId, auth.company_id!),
            eq(stockOpnames.sessionId, sessionId),
            eq(stockOpnames.penyesuaianStatus, "menunggu"),
          );
    const updated = await db
      .update(stockOpnames)
      .set({
        penyesuaianStatus: "disetujui",
        klarifikasiStatus: "sudah",
        disetujuiBy: auth.sub,
        disetujuiAt: new Date(),
        tolakAlasan: null,
      })
      .where(filter)
      .returning({ id: stockOpnames.id });
    return c.json({ ok: true, jumlah: updated.length });
  })
  /**
   * Tolak SATU sesi opname — HANYA owner/admin. Baris berselisih yang 'menunggu'
   * jadi 'ditolak' — stok TIDAK berubah (hitungan fisik dibuang). Idempoten.
   */
  .post(
    "/opname/sesi/:sessionId/tolak",
    requireRole("owner", "admin"),
    zValidator(
      "json",
      z.object({
        alasan: z.string().nullish(),
        ids: z.array(z.string().uuid()).optional(),
      }),
    ),
    async (c) => {
      const auth = c.get("auth");
      const sessionId = c.req.param("sessionId");
      const body = c.req.valid("json");
      const ids = body.ids ?? [];
      const [ada] = await db
        .select({ id: stockOpnames.id })
        .from(stockOpnames)
        .where(
          and(eq(stockOpnames.companyId, auth.company_id!), eq(stockOpnames.sessionId, sessionId)),
        )
        .limit(1);
      if (!ada) throw new HTTPException(404, { message: "Sesi opname tidak ditemukan" });
      // Per produk (ids diberikan): Tolak baris itu saja, tanpa syarat status
      // (boleh membalik baris yang tadinya disetujui), dibatasi ke baris
      // berselisih. Tanpa ids: Tolak semua baris berselisih yang masih 'menunggu'.
      const filter =
        ids.length > 0
          ? and(
              eq(stockOpnames.companyId, auth.company_id!),
              eq(stockOpnames.sessionId, sessionId),
              inArray(stockOpnames.id, ids),
              sql`abs(coalesce(${stockOpnames.selisih}, 0)) > 1e-9`,
            )
          : and(
              eq(stockOpnames.companyId, auth.company_id!),
              eq(stockOpnames.sessionId, sessionId),
              eq(stockOpnames.penyesuaianStatus, "menunggu"),
            );
      const updated = await db
        .update(stockOpnames)
        .set({
          penyesuaianStatus: "ditolak",
          klarifikasiStatus: "sudah",
          tolakAlasan: body.alasan ?? null,
          disetujuiBy: auth.sub,
          disetujuiAt: new Date(),
        })
        .where(filter)
        .returning({ id: stockOpnames.id });
      return c.json({ ok: true, jumlah: updated.length });
    },
  )
  /**
   * Hapus SATU sesi opname dari riwayat — HANYA owner/admin. Menghapus semua
   * baris sesi. Bila sesi sudah disetujui (jadi baseline saldo), menghapusnya
   * mengembalikan saldo seolah opname itu tak pernah ada (recompute otomatis).
   */
  .delete("/opname/sesi/:sessionId", requireRole("owner", "admin"), async (c) => {
    const auth = c.get("auth");
    const sessionId = c.req.param("sessionId");
    const deleted = await db
      .delete(stockOpnames)
      .where(
        and(
          eq(stockOpnames.companyId, auth.company_id!),
          eq(stockOpnames.sessionId, sessionId),
          isNotNull(stockOpnames.sessionId),
        ),
      )
      .returning({ id: stockOpnames.id });
    if (deleted.length === 0) {
      throw new HTTPException(404, { message: "Sesi opname tidak ditemukan" });
    }
    return c.json({ ok: true, jumlah: deleted.length });
  })
  .get("/opname", async (c) => {
    const auth = c.get("auth");
    const branchId = await resolveBranchId(c);
    const rows = await db
      .select({
        id: stockOpnames.id,
        ingredient_id: stockOpnames.ingredientId,
        bahan: ingredients.nama,
        qty: stockOpnames.qty,
        opname_date: stockOpnames.opnameDate,
        catatan: stockOpnames.catatan,
        created_at: stockOpnames.createdAt,
      })
      .from(stockOpnames)
      .innerJoin(ingredients, eq(stockOpnames.ingredientId, ingredients.id))
      .where(
        and(eq(stockOpnames.companyId, auth.company_id!), eq(stockOpnames.branchId, branchId)),
      )
      .orderBy(desc(stockOpnames.createdAt))
      .limit(200);
    return c.json(rows);
  });

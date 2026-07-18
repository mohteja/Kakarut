import { randomUUID } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { alias } from "drizzle-orm/pg-core";
import { and, desc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { OpnameRingkasan, OpnameSesiStatus } from "@kakarut/shared";
import { db } from "../../db/client";
import {
  companies,
  ingredients,
  stockOpnames,
  storageLocationPetugas,
  users,
} from "../../db/schema";
import { pastikanCabang, requireRole, resolveBranchId, terikatCabang, type AppEnv } from "../../middleware/auth";
import { tanggalDi } from "../../lib/time";
import { nomorUntukRefs, terbitkanNomor } from "../dokumen/nomor";
import { hitungSaldoCabang, kartuStok } from "./service";

const OpnameBody = z.object({
  branch_id: z.string().uuid().optional(),
  catatan: z.string().nullish(),
  items: z
    .array(
      z.object({
        ingredient_id: z.string().uuid(),
        qty: z.number().min(0),
      }),
    )
    .min(1),
});

// Stok Awal (saldo pembuka) = OpnameBody + tanggal berlaku. Berbeda dari opname
// fisik: stok awal itu SATU saldo pembuka per bahan yang terkunci pada tanggal
// tertentu (bukan tumpukan reset di banyak tanggal) — diganti (upsert), bukan
// ditambah. Ubah nilai / tanggal = simpan ulang di tanggal itu.
const StokAwalBody = OpnameBody.extend({
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
   * Stock opname: bandingkan fisik vs sistem. owner/admin + peran terikat
   * cabang (kasir & tim, terkunci cabangnya + hanya tempat yang ditugaskan).
   * Menyimpan snapshot saldo sistem + selisih per sesi, qty fisik jadi
   * baseline saldo baru. Persetujuan selisih tetap owner/admin.
   */
  .post("/opname", requireRole("owner", "admin", "cashier", "tim"), zValidator("json", OpnameBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const branchId = body.branch_id
      ? await pastikanCabang(body.branch_id, auth.company_id!)
      : await resolveBranchId(c);
    if (terikatCabang(auth.role) && branchId !== auth.branch_id) {
      throw new HTTPException(403, { message: "Anda hanya boleh opname di cabang Anda" });
    }

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
    const today = tanggalDi(company?.timezone ?? "Asia/Jakarta");

    // Snapshot saldo sistem per bahan (sebelum opname mengubahnya)
    const saldoRows = await hitungSaldoCabang(auth.company_id!, branchId);
    const saldoById = new Map(saldoRows.map((r) => [r.ingredient_id, r.saldo]));
    const infoById = new Map(saldoRows.map((r) => [r.ingredient_id, r]));

    // Batasan petugas: peran terikat cabang (kasir/tim) hanya boleh opname
    // bahan di tempat yang terbuka (belum ada petugas) atau tempat yang
    // ditugaskan padanya. Bahan tanpa tempat boleh siapa saja. Owner/admin
    // selalu boleh.
    if (terikatCabang(auth.role)) {
      const petugasRows = await db
        .select({
          locId: storageLocationPetugas.storageLocationId,
          userId: storageLocationPetugas.userId,
        })
        .from(storageLocationPetugas)
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
    const values = [...qtyByIngredient].map(([ingredientId, fisik]) => {
      const sistem = saldoById.get(ingredientId) ?? 0;
      const selisih = fisik - sistem;
      const adaSelisih = Math.abs(selisih) > 1e-9;
      if (!adaSelisih) ringkasan.cocok++;
      else if (selisih > 0) ringkasan.lebih++;
      else ringkasan.kurang++;
      ringkasan.total_selisih += selisih;
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
        // selisih ≠ 0 → wajib diklarifikasi karyawan (waste vs koreksi)
        klarifikasiStatus: adaSelisih ? ("belum" as const) : null,
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
    return c.json({ ok: true, jumlah: rows.length, session_id: sessionId, nomor, ringkasan }, 201);
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
    const today = tanggalDi(company?.timezone ?? "Asia/Jakarta");
    const tanggal = body.tanggal ?? today;
    // Waktu baris: saldo pembuka bertanggal LAMPAU dicatat pada tanggalnya
    // (00:00 UTC) agar tampil di kartu stok pada tanggal itu & aktivitas
    // sesudahnya dihitung di atasnya. Tanggal = hari ini (reset) → pakai waktu
    // kini agar mutasi yang sudah terjadi hari ini tetap dianggap SETELAH
    // baseline (perilaku reset saldo tak berubah).
    const createdAt = tanggal < today ? new Date(`${tanggal}T00:00:00Z`) : new Date();

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

      await db
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
        .where(eq(stockOpnames.id, c.req.param("id")));
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
        nama: r.nama,
        satuan: r.satuan,
        system_qty: r.system_qty,
        qty_fisik: r.qty_fisik,
        selisih: r.selisih,
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
    const [ada] = await db
      .select({ id: stockOpnames.id })
      .from(stockOpnames)
      .where(
        and(eq(stockOpnames.companyId, auth.company_id!), eq(stockOpnames.sessionId, sessionId)),
      )
      .limit(1);
    if (!ada) throw new HTTPException(404, { message: "Sesi opname tidak ditemukan" });
    const updated = await db
      .update(stockOpnames)
      .set({
        penyesuaianStatus: "disetujui",
        klarifikasiStatus: "sudah",
        disetujuiBy: auth.sub,
        disetujuiAt: new Date(),
        tolakAlasan: null,
      })
      .where(
        and(
          eq(stockOpnames.companyId, auth.company_id!),
          eq(stockOpnames.sessionId, sessionId),
          eq(stockOpnames.penyesuaianStatus, "menunggu"),
        ),
      )
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
    zValidator("json", z.object({ alasan: z.string().nullish() })),
    async (c) => {
      const auth = c.get("auth");
      const sessionId = c.req.param("sessionId");
      const body = c.req.valid("json");
      const [ada] = await db
        .select({ id: stockOpnames.id })
        .from(stockOpnames)
        .where(
          and(eq(stockOpnames.companyId, auth.company_id!), eq(stockOpnames.sessionId, sessionId)),
        )
        .limit(1);
      if (!ada) throw new HTTPException(404, { message: "Sesi opname tidak ditemukan" });
      const updated = await db
        .update(stockOpnames)
        .set({
          penyesuaianStatus: "ditolak",
          klarifikasiStatus: "sudah",
          tolakAlasan: body.alasan ?? null,
          disetujuiBy: auth.sub,
          disetujuiAt: new Date(),
        })
        .where(
          and(
            eq(stockOpnames.companyId, auth.company_id!),
            eq(stockOpnames.sessionId, sessionId),
            eq(stockOpnames.penyesuaianStatus, "menunggu"),
          ),
        )
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

import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { OpenBillDetail, OpenBillRow } from "@kakarut/shared";
import { db } from "../../db/client";
import { meja, menuBranches, menus, openBillItems, openBills } from "../../db/schema";
import { resolveBranchId, terikatCabang, type AppEnv } from "../../middleware/auth";

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
  if (!mejaId) return { mejaId: null as string | null, mejaLabel: null as string | null };
  const [m] = await db
    .select({ id: meja.id, nama: meja.nama })
    .from(meja)
    .where(and(eq(meja.id, mejaId), eq(meja.companyId, companyId), eq(meja.branchId, branchId)));
  if (!m) throw new HTTPException(404, { message: "Meja tidak ditemukan" });
  return { mejaId: m.id, mejaLabel: m.nama };
}

async function loadDetail(companyId: string, id: string): Promise<OpenBillDetail | null> {
  const [bill] = await db.select().from(openBills).where(eq(openBills.id, id));
  if (!bill || bill.companyId !== companyId) return null;
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
    })),
  };
}

type BillItemInput = z.infer<typeof BillBody>["items"][number];
type KatalogHarga = Map<string, { nama: string; hargaJual: number }>;

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
        meja_label: openBills.mejaLabel,
        customer_nama: openBills.customerNama,
        waktu: openBills.updatedAt,
        jumlah_item: sql<number>`COUNT(${openBillItems.id})::int`,
      })
      .from(openBills)
      .leftJoin(openBillItems, eq(openBillItems.billId, openBills.id))
      .where(and(eq(openBills.companyId, auth.company_id!), eq(openBills.branchId, branchId)))
      .groupBy(openBills.id)
      .orderBy(desc(openBills.updatedAt));
    const dto: OpenBillRow[] = rows.map((r) => ({
      id: r.id,
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
  .post("/", zValidator("json", BillBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const branchId = body.branch_id ?? (await resolveBranchId(c));
    if (terikatCabang(auth.role) && branchId !== auth.branch_id) {
      throw new HTTPException(403, { message: "Kasir hanya boleh bill di cabangnya" });
    }
    const katalog = await validateMenus(auth.company_id!, branchId, body.items);
    const { mejaId, mejaLabel } = await resolveMeja(auth.company_id!, branchId, body.meja_id);
    const id = await db.transaction(async (tx) => {
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
      return bill.id;
    });
    return c.json(await loadDetail(auth.company_id!, id), 201);
  })
  .put("/:id", zValidator("json", BillBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const id = c.req.param("id");
    const [existing] = await db.select().from(openBills).where(eq(openBills.id, id));
    if (!existing || existing.companyId !== auth.company_id!) {
      throw new HTTPException(404, { message: "Bill tidak ditemukan" });
    }
    const katalog = await validateMenus(auth.company_id!, existing.branchId, body.items);
    const { mejaId, mejaLabel } = await resolveMeja(
      auth.company_id!,
      existing.branchId,
      body.meja_id,
    );
    await db.transaction(async (tx) => {
      await tx
        .update(openBills)
        .set({
          mejaId,
          mejaLabel,
          customerNama: body.customer_nama?.trim() || null,
          customerWa: body.customer_wa?.trim() || null,
          catatan: body.catatan?.trim() || null,
          updatedAt: new Date(),
        })
        .where(eq(openBills.id, id));

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
        .select({ id: openBillItems.id, menuId: openBillItems.menuId })
        .from(openBillItems)
        .where(eq(openBillItems.billId, id));
      const lamaById = new Map(lama.map((r) => [r.id, r]));
      const pasangan = new Map<number, string>(); // indeks item kiriman → id baris lama
      const terpakai = new Set<string>();

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
        if (it.id) continue;
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
        await tx
          .update(openBillItems)
          .set({
            qty: it.qty,
            dineInOverride: it.dine_in_override ?? null,
            catatan: it.catatan?.trim() || null,
          })
          .where(eq(openBillItems.id, barisId));
      }
      const dibuang = lama.filter((r) => !terpakai.has(r.id)).map((r) => r.id);
      if (dibuang.length > 0) {
        await tx.delete(openBillItems).where(inArray(openBillItems.id, dibuang));
      }
      const baru = body.items.filter((_, i) => !pasangan.has(i));
      if (baru.length > 0) {
        await tx.insert(openBillItems).values(baru.map((it) => barisBaru(id, it, katalog)));
      }
    });
    return c.json(await loadDetail(auth.company_id!, id));
  })
  .delete("/:id", async (c) => {
    const auth = c.get("auth");
    const [row] = await db
      .delete(openBills)
      .where(and(eq(openBills.id, c.req.param("id")), eq(openBills.companyId, auth.company_id!)))
      .returning({ id: openBills.id });
    if (!row) throw new HTTPException(404, { message: "Bill tidak ditemukan" });
    return c.json({ ok: true });
  });

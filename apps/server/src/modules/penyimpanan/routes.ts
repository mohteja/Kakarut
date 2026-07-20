import { zValidator } from "@hono/zod-validator";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { PenyimpananDto, PetugasRingkas } from "@kakarut/shared";
import { db } from "../../db/client";
import {
  ingredients,
  memberships,
  storageLocationIngredients,
  storageLocationPetugas,
  storageLocations,
  users,
} from "../../db/schema";
import {
  pastikanCabang,
  requireRole,
  resolveBranchId,
  terikatCabang,
  type AppEnv,
} from "../../middleware/auth";

const PenyimpananBody = z.object({
  branch_id: z.string().uuid().optional(),
  nama: z.string().trim().min(1),
  catatan: z.string().nullish(),
  is_active: z.boolean().optional(),
});

function toDto(
  row: typeof storageLocations.$inferSelect,
  petugas: PetugasRingkas[] = [],
  jumlahBahan = 0,
): PenyimpananDto {
  return {
    id: row.id,
    branch_id: row.branchId,
    nama: row.nama,
    catatan: row.catatan,
    is_active: row.isActive,
    petugas,
    jumlah_bahan: jumlahBahan,
  };
}

/** Jumlah bahan baku yang ditugaskan per tempat penyimpanan. */
async function jumlahBahanByLokasi(
  companyId: string,
  locationIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (locationIds.length === 0) return map;
  const rows = await db
    .select({
      locId: storageLocationIngredients.storageLocationId,
      n: sql<number>`COUNT(*)::int`,
    })
    .from(storageLocationIngredients)
    .where(
      and(
        eq(storageLocationIngredients.companyId, companyId),
        inArray(storageLocationIngredients.storageLocationId, locationIds),
      ),
    )
    .groupBy(storageLocationIngredients.storageLocationId);
  for (const r of rows) map.set(r.locId, r.n);
  return map;
}

/** Petugas opname per tempat (untuk sekumpulan lokasi), digroup per lokasi. */
async function petugasByLokasi(
  companyId: string,
  locationIds: string[],
): Promise<Map<string, PetugasRingkas[]>> {
  const byLoc = new Map<string, PetugasRingkas[]>();
  if (locationIds.length === 0) return byLoc;
  const rows = await db
    .select({
      locId: storageLocationPetugas.storageLocationId,
      user_id: users.id,
      nama: users.nama,
      role: memberships.role,
    })
    .from(storageLocationPetugas)
    .innerJoin(users, eq(storageLocationPetugas.userId, users.id))
    .leftJoin(
      memberships,
      and(eq(memberships.userId, users.id), eq(memberships.companyId, companyId)),
    )
    .where(
      and(
        eq(storageLocationPetugas.companyId, companyId),
        inArray(storageLocationPetugas.storageLocationId, locationIds),
      ),
    );
  for (const r of rows) {
    const list = byLoc.get(r.locId) ?? [];
    list.push({ user_id: r.user_id, nama: r.nama, role: r.role ?? "cashier" });
    byLoc.set(r.locId, list);
  }
  return byLoc;
}

export const penyimpananRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const auth = c.get("auth");
    const branchId = await resolveBranchId(c);
    const rows = await db
      .select()
      .from(storageLocations)
      .where(
        and(
          eq(storageLocations.companyId, auth.company_id!),
          eq(storageLocations.branchId, branchId),
        ),
      )
      .orderBy(asc(storageLocations.nama));
    const ids = rows.map((r) => r.id);
    const [byLoc, byBahan] = await Promise.all([
      petugasByLokasi(auth.company_id!, ids),
      jumlahBahanByLokasi(auth.company_id!, ids),
    ]);
    return c.json(
      rows.map((r) => toDto(r, byLoc.get(r.id) ?? [], byBahan.get(r.id) ?? 0)),
    );
  })
  // POST boleh semua peran — dipakai quick-add saat mengisi faktur
  .post("/", zValidator("json", PenyimpananBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const branchId = body.branch_id
      ? await pastikanCabang(body.branch_id, auth.company_id!)
      : await resolveBranchId(c);
    if (terikatCabang(auth.role) && branchId !== auth.branch_id) {
      throw new HTTPException(403, { message: "Kasir hanya boleh menambah di cabangnya" });
    }
    const [row] = await db
      .insert(storageLocations)
      .values({
        companyId: auth.company_id!,
        branchId,
        nama: body.nama,
        catatan: body.catatan ?? null,
      })
      .onConflictDoNothing()
      .returning();
    if (!row) {
      throw new HTTPException(409, { message: `Tempat "${body.nama}" sudah ada di cabang ini` });
    }
    return c.json(toDto(row), 201);
  })
  .patch(
    "/:id",
    requireRole("owner", "admin"),
    zValidator("json", PenyimpananBody.partial()),
    async (c) => {
      const auth = c.get("auth");
      const body = c.req.valid("json");
      const [row] = await db
        .update(storageLocations)
        .set({
          ...(body.nama !== undefined && { nama: body.nama }),
          ...(body.catatan !== undefined && { catatan: body.catatan }),
          ...(body.is_active !== undefined && { isActive: body.is_active }),
        })
        .where(
          and(
            eq(storageLocations.id, c.req.param("id")),
            eq(storageLocations.companyId, auth.company_id!),
          ),
        )
        .returning();
      if (!row) throw new HTTPException(404, { message: "Tempat penyimpanan tidak ditemukan" });
      const byLoc = await petugasByLokasi(auth.company_id!, [row.id]);
      return c.json(toDto(row, byLoc.get(row.id) ?? []));
    },
  )
  /**
   * Atur petugas opname tempat penyimpanan (owner/admin). Body { user_ids }
   * mengganti seluruh daftar petugas. Kosong = tempat terbuka lagi.
   */
  .put(
    "/:id/petugas",
    requireRole("owner", "admin"),
    zValidator("json", z.object({ user_ids: z.array(z.string().uuid()) })),
    async (c) => {
      const auth = c.get("auth");
      const body = c.req.valid("json");
      const locId = c.req.param("id");

      const [loc] = await db
        .select({ id: storageLocations.id })
        .from(storageLocations)
        .where(
          and(
            eq(storageLocations.id, locId),
            eq(storageLocations.companyId, auth.company_id!),
          ),
        );
      if (!loc) throw new HTTPException(404, { message: "Tempat penyimpanan tidak ditemukan" });

      const uniqueIds = [...new Set(body.user_ids)];
      if (uniqueIds.length > 0) {
        const members = await db
          .select({ userId: memberships.userId })
          .from(memberships)
          .where(
            and(
              eq(memberships.companyId, auth.company_id!),
              inArray(memberships.userId, uniqueIds),
            ),
          );
        if (members.length !== uniqueIds.length) {
          throw new HTTPException(400, { message: "Ada akun yang bukan anggota perusahaan" });
        }
      }

      await db.transaction(async (tx) => {
        await tx
          .delete(storageLocationPetugas)
          .where(
            and(
              eq(storageLocationPetugas.companyId, auth.company_id!),
              eq(storageLocationPetugas.storageLocationId, locId),
            ),
          );
        if (uniqueIds.length > 0) {
          await tx.insert(storageLocationPetugas).values(
            uniqueIds.map((uid) => ({
              companyId: auth.company_id!,
              storageLocationId: locId,
              userId: uid,
            })),
          );
        }
      });
      const byLoc = await petugasByLokasi(auth.company_id!, [locId]);
      return c.json({ ok: true, petugas: byLoc.get(locId) ?? [] });
    },
  )
  /**
   * BAHAN BAKU yang ditugaskan disimpan di tempat (rak) ini — dipakai sebagai
   * RAK DEFAULT saat kiriman dari CK diterima di cabang. Terbuka semua peran
   * (dipakai tampilan/opname).
   */
  .get("/:id/bahan", async (c) => {
    const auth = c.get("auth");
    const locId = c.req.param("id");
    const [loc] = await db
      .select({ id: storageLocations.id, branchId: storageLocations.branchId })
      .from(storageLocations)
      .where(and(eq(storageLocations.id, locId), eq(storageLocations.companyId, auth.company_id!)));
    if (!loc) throw new HTTPException(404, { message: "Tempat penyimpanan tidak ditemukan" });
    const rows = await db
      .select({ ingredientId: storageLocationIngredients.ingredientId })
      .from(storageLocationIngredients)
      .where(
        and(
          eq(storageLocationIngredients.companyId, auth.company_id!),
          eq(storageLocationIngredients.storageLocationId, locId),
        ),
      );
    // bahan yang SUDAH disimpan di rak LAIN pada cabang yang sama — 1 bahan
    // hanya boleh di 1 rak per cabang, jadi ini disembunyikan dari picker.
    const lain = await db
      .select({ ingredientId: storageLocationIngredients.ingredientId })
      .from(storageLocationIngredients)
      .innerJoin(
        storageLocations,
        eq(storageLocations.id, storageLocationIngredients.storageLocationId),
      )
      .where(
        and(
          eq(storageLocationIngredients.companyId, auth.company_id!),
          eq(storageLocations.branchId, loc.branchId),
          ne(storageLocationIngredients.storageLocationId, locId),
        ),
      );
    return c.json({
      ingredient_ids: rows.map((r) => r.ingredientId),
      terpakai_lain: lain.map((r) => r.ingredientId),
    });
  })
  /**
   * Ganti seluruh daftar bahan baku yang disimpan di rak ini (owner/admin).
   * Satu bahan maksimal di SATU rak per cabang: bahan yang ditugaskan ke sini
   * otomatis dilepas dari rak lain di cabang yang sama.
   */
  .put(
    "/:id/bahan",
    requireRole("owner", "admin"),
    zValidator("json", z.object({ ingredient_ids: z.array(z.string().uuid()).max(2000) })),
    async (c) => {
      const auth = c.get("auth");
      const locId = c.req.param("id");
      const { ingredient_ids } = c.req.valid("json");
      const uniqueIds = [...new Set(ingredient_ids)];

      const [loc] = await db
        .select({ id: storageLocations.id, branchId: storageLocations.branchId })
        .from(storageLocations)
        .where(
          and(eq(storageLocations.id, locId), eq(storageLocations.companyId, auth.company_id!)),
        );
      if (!loc) throw new HTTPException(404, { message: "Tempat penyimpanan tidak ditemukan" });

      if (uniqueIds.length > 0) {
        const valid = await db
          .select({ id: ingredients.id })
          .from(ingredients)
          .where(
            and(
              eq(ingredients.companyId, auth.company_id!),
              eq(ingredients.isActive, true),
              inArray(ingredients.id, uniqueIds),
            ),
          );
        if (valid.length !== uniqueIds.length) {
          throw new HTTPException(400, { message: "Ada bahan yang tidak valid" });
        }
      }

      // rak lain di cabang yang sama (untuk menjaga 1 bahan = 1 rak per cabang)
      const rakCabang = await db
        .select({ id: storageLocations.id })
        .from(storageLocations)
        .where(
          and(
            eq(storageLocations.companyId, auth.company_id!),
            eq(storageLocations.branchId, loc.branchId),
          ),
        );
      const rakLainIds = rakCabang.map((r) => r.id).filter((id) => id !== locId);

      await db.transaction(async (tx) => {
        // ganti isi rak ini
        await tx
          .delete(storageLocationIngredients)
          .where(
            and(
              eq(storageLocationIngredients.companyId, auth.company_id!),
              eq(storageLocationIngredients.storageLocationId, locId),
            ),
          );
        // lepas bahan yang dipindah ke sini dari rak lain di cabang yang sama
        if (uniqueIds.length > 0 && rakLainIds.length > 0) {
          await tx
            .delete(storageLocationIngredients)
            .where(
              and(
                eq(storageLocationIngredients.companyId, auth.company_id!),
                inArray(storageLocationIngredients.storageLocationId, rakLainIds),
                inArray(storageLocationIngredients.ingredientId, uniqueIds),
              ),
            );
        }
        if (uniqueIds.length > 0) {
          await tx.insert(storageLocationIngredients).values(
            uniqueIds.map((ingredientId) => ({
              companyId: auth.company_id!,
              storageLocationId: locId,
              ingredientId,
            })),
          );
        }
      });
      return c.json({ ok: true, jumlah: uniqueIds.length });
    },
  );

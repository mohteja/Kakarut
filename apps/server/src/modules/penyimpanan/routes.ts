import { zValidator } from "@hono/zod-validator";
import { and, asc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { PenyimpananDto, PetugasRingkas } from "@kakarut/shared";
import { db } from "../../db/client";
import {
  memberships,
  storageLocationPetugas,
  storageLocations,
  users,
} from "../../db/schema";
import {
  pastikanCabang,
  requireRole,
  resolveBranchId,
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
): PenyimpananDto {
  return {
    id: row.id,
    branch_id: row.branchId,
    nama: row.nama,
    catatan: row.catatan,
    is_active: row.isActive,
    petugas,
  };
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
    const byLoc = await petugasByLokasi(
      auth.company_id!,
      rows.map((r) => r.id),
    );
    return c.json(rows.map((r) => toDto(r, byLoc.get(r.id) ?? [])));
  })
  // POST boleh semua peran — dipakai quick-add saat mengisi faktur
  .post("/", zValidator("json", PenyimpananBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const branchId = body.branch_id
      ? await pastikanCabang(body.branch_id, auth.company_id!)
      : await resolveBranchId(c);
    if (auth.role === "cashier" && branchId !== auth.branch_id) {
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
  );

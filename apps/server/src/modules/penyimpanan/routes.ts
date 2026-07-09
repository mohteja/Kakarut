import { zValidator } from "@hono/zod-validator";
import { and, asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { PenyimpananDto } from "@kakarut/shared";
import { db } from "../../db/client";
import { storageLocations } from "../../db/schema";
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

function toDto(row: typeof storageLocations.$inferSelect): PenyimpananDto {
  return {
    id: row.id,
    branch_id: row.branchId,
    nama: row.nama,
    catatan: row.catatan,
    is_active: row.isActive,
  };
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
    return c.json(rows.map(toDto));
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
      return c.json(toDto(row));
    },
  );

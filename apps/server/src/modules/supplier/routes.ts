import { zValidator } from "@hono/zod-validator";
import { and, asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { SupplierDto } from "@kakarut/shared";
import { db } from "../../db/client";
import { suppliers } from "../../db/schema";
import { requireRole, type AppEnv } from "../../middleware/auth";

const SupplierBody = z.object({
  nama: z.string().trim().min(1),
  telepon: z.string().nullish(),
  alamat: z.string().nullish(),
  catatan: z.string().nullish(),
  is_active: z.boolean().optional(),
});

function toDto(row: typeof suppliers.$inferSelect): SupplierDto {
  return {
    id: row.id,
    nama: row.nama,
    telepon: row.telepon,
    alamat: row.alamat,
    catatan: row.catatan,
    is_active: row.isActive,
  };
}

export const supplierRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const auth = c.get("auth");
    const rows = await db
      .select()
      .from(suppliers)
      .where(eq(suppliers.companyId, auth.company_id!))
      .orderBy(asc(suppliers.nama));
    return c.json(rows.map(toDto));
  })
  // POST boleh semua peran — dipakai quick-add saat mengisi faktur
  .post("/", zValidator("json", SupplierBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const [row] = await db
      .insert(suppliers)
      .values({
        companyId: auth.company_id!,
        nama: body.nama,
        telepon: body.telepon ?? null,
        alamat: body.alamat ?? null,
        catatan: body.catatan ?? null,
      })
      .onConflictDoNothing()
      .returning();
    if (!row) {
      throw new HTTPException(409, { message: `Supplier "${body.nama}" sudah ada` });
    }
    return c.json(toDto(row), 201);
  })
  .patch(
    "/:id",
    requireRole("owner", "admin"),
    zValidator("json", SupplierBody.partial()),
    async (c) => {
      const auth = c.get("auth");
      const body = c.req.valid("json");
      const [row] = await db
        .update(suppliers)
        .set({
          ...(body.nama !== undefined && { nama: body.nama }),
          ...(body.telepon !== undefined && { telepon: body.telepon }),
          ...(body.alamat !== undefined && { alamat: body.alamat }),
          ...(body.catatan !== undefined && { catatan: body.catatan }),
          ...(body.is_active !== undefined && { isActive: body.is_active }),
        })
        .where(
          and(eq(suppliers.id, c.req.param("id")), eq(suppliers.companyId, auth.company_id!)),
        )
        .returning();
      if (!row) throw new HTTPException(404, { message: "Supplier tidak ditemukan" });
      return c.json(toDto(row));
    },
  );

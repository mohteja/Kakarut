import { zValidator } from "@hono/zod-validator";
import { and, asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { MejaDto } from "@kakarut/shared";
import { db } from "../../db/client";
import { meja } from "../../db/schema";
import { pastikanCabang, resolveBranchId, type AppEnv } from "../../middleware/auth";

const MejaBody = z.object({
  branch_id: z.string().uuid().optional(),
  nama: z.string().trim().min(1),
  tipe: z.enum(["dine_in", "takeaway"]).optional(),
  is_active: z.boolean().optional(),
});

const TataLetakBody = z.object({
  items: z
    .array(
      z.object({
        id: z.string().uuid(),
        pos_x: z.number().int().min(0).max(100),
        pos_y: z.number().int().min(0).max(100),
      }),
    )
    .max(500),
});

function toDto(row: typeof meja.$inferSelect): MejaDto {
  return {
    id: row.id,
    branch_id: row.branchId,
    nama: row.nama,
    tipe: row.tipe,
    pos_x: row.posX,
    pos_y: row.posY,
    is_active: row.isActive,
  };
}

/**
 * Master meja per cabang. Bisa diakses kasir (untuk cabangnya sendiri) agar
 * kasir mengatur meja + tata letak denah; owner/admin bisa untuk cabang mana pun
 * lewat ?branch_id. Meja "Ruang Tunggu" (tipe takeaway) tidak boleh dihapus.
 */
export const mejaRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const auth = c.get("auth");
    const branchId = await resolveBranchId(c);
    const rows = await db
      .select()
      .from(meja)
      .where(and(eq(meja.companyId, auth.company_id!), eq(meja.branchId, branchId)))
      .orderBy(asc(meja.posY), asc(meja.posX), asc(meja.nama));
    return c.json(rows.map(toDto));
  })
  .post("/", zValidator("json", MejaBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const branchId = body.branch_id
      ? await pastikanCabang(body.branch_id, auth.company_id!)
      : await resolveBranchId(c);
    if (auth.role === "cashier" && branchId !== auth.branch_id) {
      throw new HTTPException(403, { message: "Kasir hanya boleh menambah meja di cabangnya" });
    }
    const [row] = await db
      .insert(meja)
      .values({
        companyId: auth.company_id!,
        branchId,
        nama: body.nama,
        tipe: body.tipe ?? "dine_in",
      })
      .onConflictDoNothing()
      .returning();
    if (!row) {
      throw new HTTPException(409, { message: `Meja "${body.nama}" sudah ada di cabang ini` });
    }
    return c.json(toDto(row), 201);
  })
  // Simpan tata letak denah sekaligus (posisi persen 0..100). Kasir untuk cabangnya.
  .put("/tata-letak", zValidator("json", TataLetakBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const branchId = await resolveBranchId(c);
    await db.transaction(async (tx) => {
      for (const it of body.items) {
        await tx
          .update(meja)
          .set({ posX: it.pos_x, posY: it.pos_y })
          .where(
            and(
              eq(meja.id, it.id),
              eq(meja.companyId, auth.company_id!),
              eq(meja.branchId, branchId),
            ),
          );
      }
    });
    const rows = await db
      .select()
      .from(meja)
      .where(and(eq(meja.companyId, auth.company_id!), eq(meja.branchId, branchId)))
      .orderBy(asc(meja.posY), asc(meja.posX), asc(meja.nama));
    return c.json(rows.map(toDto));
  })
  .patch("/:id", zValidator("json", MejaBody.partial()), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const [existing] = await db
      .select()
      .from(meja)
      .where(and(eq(meja.id, c.req.param("id")), eq(meja.companyId, auth.company_id!)));
    if (!existing) throw new HTTPException(404, { message: "Meja tidak ditemukan" });
    if (auth.role === "cashier" && existing.branchId !== auth.branch_id) {
      throw new HTTPException(403, { message: "Kasir hanya boleh mengubah meja di cabangnya" });
    }
    const [row] = await db
      .update(meja)
      .set({
        ...(body.nama !== undefined && { nama: body.nama }),
        ...(body.is_active !== undefined && { isActive: body.is_active }),
      })
      .where(and(eq(meja.id, existing.id), eq(meja.companyId, auth.company_id!)))
      .returning();
    return c.json(toDto(row));
  })
  .delete("/:id", async (c) => {
    const auth = c.get("auth");
    const [existing] = await db
      .select()
      .from(meja)
      .where(and(eq(meja.id, c.req.param("id")), eq(meja.companyId, auth.company_id!)));
    if (!existing) throw new HTTPException(404, { message: "Meja tidak ditemukan" });
    if (auth.role === "cashier" && existing.branchId !== auth.branch_id) {
      throw new HTTPException(403, { message: "Kasir hanya boleh menghapus meja di cabangnya" });
    }
    if (existing.tipe === "takeaway") {
      throw new HTTPException(400, { message: "Meja Ruang Tunggu tidak bisa dihapus" });
    }
    await db.delete(meja).where(and(eq(meja.id, existing.id), eq(meja.companyId, auth.company_id!)));
    return c.json({ ok: true });
  });

import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { db } from "../../db/client";
import { companies } from "../../db/schema";
import { requireRole, type AppEnv } from "../../middleware/auth";

const PatchBody = z.object({
  nama: z.string().trim().min(1).optional(),
  alamat: z.string().nullish(),
  telepon: z.string().nullish(),
  logo_url: z.string().nullish(),
  pb1_enabled: z.boolean().optional(),
  pb1_rate: z.number().min(0).max(100).optional(),
});

export const companyRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const auth = c.get("auth");
    const [row] = await db
      .select()
      .from(companies)
      .where(eq(companies.id, auth.company_id!));
    if (!row) throw new HTTPException(404, { message: "Perusahaan tidak ditemukan" });
    return c.json(row);
  })
  .patch("/", requireRole("owner", "admin"), zValidator("json", PatchBody), async (c) => {
    const auth = c.get("auth");
    const body = c.req.valid("json");
    const [row] = await db
      .update(companies)
      .set({
        ...(body.nama !== undefined && { nama: body.nama }),
        ...(body.alamat !== undefined && { alamat: body.alamat }),
        ...(body.telepon !== undefined && { telepon: body.telepon }),
        ...(body.logo_url !== undefined && { logoUrl: body.logo_url }),
        ...(body.pb1_enabled !== undefined && { pb1Enabled: body.pb1_enabled }),
        ...(body.pb1_rate !== undefined && { pb1Rate: body.pb1_rate }),
        updatedAt: new Date(),
      })
      .where(eq(companies.id, auth.company_id!))
      .returning();
    return c.json(row);
  });

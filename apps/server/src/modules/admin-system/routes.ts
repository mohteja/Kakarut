import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { sql } from "drizzle-orm";
import { db } from "../../db/client";
import { migrationStatus, runMigrations } from "../../db/migrate";
import { getStorage } from "../upload/storage";
import type { AppEnv } from "../../middleware/auth";

/** Panel sistem super-admin: status database & migrasi, jalankan migrasi. */
export const adminSystemRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    let databaseOk = true;
    try {
      await db.execute(sql`SELECT 1`);
    } catch {
      databaseOk = false;
    }
    return c.json({
      database_ok: databaseOk,
      storage_mode: getStorage().mode,
      node_version: process.version,
      migrations: await migrationStatus(),
    });
  })
  .post("/migrate", async (c) => {
    try {
      await runMigrations();
    } catch (e) {
      console.error("Migrasi manual gagal:", e);
      throw new HTTPException(500, {
        message: `Migrasi gagal: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
    return c.json({ ok: true, migrations: await migrationStatus() });
  });

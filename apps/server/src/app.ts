import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import { db } from "./db/client";
import {
  requireAuth,
  requireCompany,
  requireRole,
  requireSuperAdmin,
  type AppEnv,
} from "./middleware/auth";
import { adminSystemRoutes } from "./modules/admin-system/routes";
import { adminTenantsRoutes } from "./modules/admin-tenants/routes";
import { authRoutes } from "./modules/auth/routes";
import { bahanRoutes } from "./modules/bahan/routes";
import { cabangRoutes } from "./modules/branches/routes";
import { companyRoutes } from "./modules/company/routes";
import { kategoriRoutes } from "./modules/kategori/routes";
import { laporanRoutes } from "./modules/laporan/routes";
import { menuRoutes } from "./modules/menu/routes";
import { penjualanRoutes } from "./modules/penjualan/routes";
import { produksiRoutes } from "./modules/produksi/routes";
import { stokRoutes } from "./modules/stok/routes";
import { uploadRoutes } from "./modules/upload/routes";
import { karyawanRoutes } from "./modules/users/routes";
import { getStorage } from "./modules/upload/storage";

export function createApp() {
  const api = new Hono<AppEnv>()
    .get("/health", async (c) => {
      await db.execute(sql`SELECT 1`);
      return c.json({ ok: true, storage: getStorage().mode });
    })
    .route("/auth", authRoutes)
    // Platform super-admin
    .use("/admin/*", requireAuth, requireSuperAdmin)
    .route("/admin/tenants", adminTenantsRoutes)
    .route("/admin/sistem", adminSystemRoutes);

  // Rute internal perusahaan (butuh membership)
  const tenant = new Hono<AppEnv>()
    .use("*", requireAuth, requireCompany)
    .route("/company", companyRoutes)
    .route("/cabang", cabangRoutes)
    .route("/bahan", bahanRoutes)
    .route("/kategori", kategoriRoutes)
    .route("/menu", menuRoutes)
    .route("/penjualan", penjualanRoutes)
    .route("/produksi", produksiRoutes)
    .route("/stok", stokRoutes)
    .route("/laporan", laporanRoutes)
    .route("/upload", uploadRoutes);
  tenant.use("/karyawan/*", requireRole("owner", "admin"));
  tenant.route("/karyawan", karyawanRoutes);

  api.route("/", tenant);

  const app = new Hono<AppEnv>();
  app.use("*", logger());
  app.route("/api", api);

  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json({ error: err.message }, err.status);
    }
    console.error(err);
    return c.json({ error: "Terjadi kesalahan pada server" }, 500);
  });

  return app;
}

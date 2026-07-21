import { eq, sql } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import { db } from "./db/client";
import { branches } from "./db/schema";
import { getBuildId } from "./lib/build";
import {
  requireAuth,
  requireCompany,
  requireRole,
  requireSuperAdmin,
  type AppEnv,
} from "./middleware/auth";
import { absensiRoutes } from "./modules/absensi/routes";
import { adminSystemRoutes } from "./modules/admin-system/routes";
import { adminTenantsRoutes } from "./modules/admin-tenants/routes";
import { authRoutes } from "./modules/auth/routes";
import { bahanRoutes } from "./modules/bahan/routes";
import { cabangRoutes } from "./modules/branches/routes";
import { companyRoutes } from "./modules/company/routes";
import { customerRoutes, memberCariRoutes } from "./modules/customer/routes";
import { kategoriRoutes } from "./modules/kategori/routes";
import { kategoriBahanRoutes } from "./modules/kategori-bahan/routes";
import { perlengkapanRoutes } from "./modules/perlengkapan/routes";
import { satuanRoutes } from "./modules/satuan/routes";
import { laporanRoutes } from "./modules/laporan/routes";
import { mejaRoutes } from "./modules/meja/routes";
import { menuRoutes } from "./modules/menu/routes";
import { onboardingRoutes } from "./modules/onboarding/routes";
import { openBillRoutes } from "./modules/open-bill/routes";
import { penjualanRoutes } from "./modules/penjualan/routes";
import { syncRoutes } from "./modules/sync/routes";
import { penyimpananRoutes } from "./modules/penyimpanan/routes";
import { printRoutes } from "./modules/print/routes";
import { profilRoutes } from "./modules/profil/routes";
import { pembelianRoutes, produksiRoutes } from "./modules/produksi/routes";
import { penerimaanRoutes } from "./modules/penerimaan/routes";
import { rekomendasiRoutes } from "./modules/rekomendasi/routes";
import { sampahRoutes } from "./modules/sampah/routes";
import { shiftRoutes } from "./modules/shift/routes";
import { supplierRoutes } from "./modules/supplier/routes";
import { stokRoutes } from "./modules/stok/routes";
import { uploadRoutes } from "./modules/upload/routes";
import { karyawanRoutes } from "./modules/users/routes";
import { getStorage } from "./modules/upload/storage";

export function createApp() {
  const api = new Hono<AppEnv>()
    // Tandai tiap respons API dengan build id frontend saat ini → klien tahu
    // ada versi baru (build server ≠ build tab yang dimuat) tanpa polling khusus.
    .use("*", async (c, next) => {
      await next();
      const build = getBuildId();
      if (build) c.header("X-Kakarut-Build", build);
    })
    .get("/health", async (c) => {
      await db.execute(sql`SELECT 1`);
      return c.json({ ok: true, storage: getStorage().mode, build: getBuildId() });
    })
    .route("/auth", authRoutes)
    // Onboarding + lifecycle akun (butuh login, TIDAK butuh perusahaan):
    // status, buat perusahaan sendiri, terima/tolak undangan, hapus akun.
    .route("/onboarding", onboardingRoutes)
    // Platform super-admin
    .use("/admin/*", requireAuth, requireSuperAdmin)
    .route("/admin/tenants", adminTenantsRoutes)
    .route("/admin/sistem", adminSystemRoutes);

  // Rute internal perusahaan (butuh membership)
  const tenant = new Hono<AppEnv>().use("*", requireAuth, requireCompany);
  // Gerbang peran owner/admin — HARUS didaftarkan sebelum route agar middleware
  // dijalankan lebih dulu. Kasir hanya butuh kasir/stok/opname/penyesuaian.
  // Produksi & pembelian: manajemen ATAU karyawan (tim) yang lokasi kerjanya
  // Central Kitchen — CK memang tempatnya memproduksi & membeli bahan.
  const izinkanManajemenAtauKaryawanCk: MiddlewareHandler<AppEnv> = async (c, next) => {
    const auth = c.get("auth");
    if (auth.role === "owner" || auth.role === "admin") return next();
    if (auth.role === "tim" && auth.branch_id) {
      const [b] = await db
        .select({ tipe: branches.tipe })
        .from(branches)
        .where(eq(branches.id, auth.branch_id));
      if (b?.tipe === "central_kitchen") return next();
    }
    throw new HTTPException(403, {
      message: "Khusus manajemen atau karyawan Central Kitchen",
    });
  };
  tenant.use("/produksi/*", izinkanManajemenAtauKaryawanCk);
  tenant.use("/pembelian/*", izinkanManajemenAtauKaryawanCk);
  tenant.use("/laporan/*", requireRole("owner", "admin"));
  tenant.use("/rekomendasi/*", requireRole("owner", "admin"));
  tenant.use("/sampah/*", requireRole("owner", "admin"));
  tenant.use("/karyawan/*", requireRole("owner", "admin"));
  tenant.use("/customer/*", requireRole("owner", "admin"));
  // Transaksi POS (jual, open bill) HANYA peran kasir.
  // Owner/admin memantau lewat Riwayat/Laporan, tak meng-input transaksi.
  tenant.use("/open-bill/*", requireRole("cashier"));
  // Shift kasir: BUKA/TUTUP hanya kasir (digerbang per-rute di modulnya), tetapi
  // owner/admin boleh MEMANTAU (aktif, riwayat, detail, /pantau semua cabang).
  tenant.use("/shift/*", requireRole("owner", "admin", "cashier"));
  // Absensi: semua peran boleh ABSEN SENDIRI (POST /absensi/saya) + lihat
  // ringkasan; hanya admin/kasir yang boleh STASIUN pindai (POST /absensi,
  // digerbang per-rute di modulnya). Tim ikut agar bisa absen sendiri.
  tenant.use("/absensi/*", requireRole("owner", "admin", "cashier", "tim"));
  tenant
    .route("/company", companyRoutes)
    .route("/customer", customerRoutes)
    .route("/cabang", cabangRoutes)
    .route("/bahan", bahanRoutes)
    .route("/kategori", kategoriRoutes)
    .route("/kategori-bahan", kategoriBahanRoutes)
    .route("/satuan", satuanRoutes)
    .route("/menu", menuRoutes)
    .route("/penjualan", penjualanRoutes)
    .route("/produksi", produksiRoutes)
    .route("/pembelian", pembelianRoutes)
    // penerimaan kiriman di toko — boleh kasir (terkunci cabangnya)
    .route("/penerimaan", penerimaanRoutes)
    .route("/supplier", supplierRoutes)
    .route("/penyimpanan", penyimpananRoutes)
    .route("/meja", mejaRoutes)
    .route("/open-bill", openBillRoutes)
    .route("/shift", shiftRoutes)
    // Sinkron antrean offline mobile (per-perintah divalidasi seperti endpoint aslinya)
    .route("/sync", syncRoutes)
    // absensi karyawan (stasiun pindai) — hanya admin/kasir (digerbang di atas)
    .route("/absensi", absensiRoutes)
    // profil akun sendiri (identitas + QR absen + ganti password) — semua peran
    .route("/profil", profilRoutes)
    // pencarian member ringan untuk autocomplete kasir — semua peran
    .route("/member-cari", memberCariRoutes)
    .route("/stok", stokRoutes)
    // perlengkapan non bahan baku (sendok, spons, sabun) — modul mandiri
    .route("/perlengkapan", perlengkapanRoutes)
    .route("/laporan", laporanRoutes)
    .route("/print", printRoutes)
    .route("/rekomendasi", rekomendasiRoutes)
    .route("/sampah", sampahRoutes)
    .route("/upload", uploadRoutes)
    .route("/karyawan", karyawanRoutes);

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

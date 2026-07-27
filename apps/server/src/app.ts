import { eq, sql } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import { compress } from "hono/compress";
import { etag } from "hono/etag";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
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
import { setSyncApp, syncRoutes } from "./modules/sync/routes";
import { penyimpananRoutes } from "./modules/penyimpanan/routes";
import { printRoutes } from "./modules/print/routes";
import { profilRoutes } from "./modules/profil/routes";
import { pembelianRoutes, produksiRoutes } from "./modules/produksi/routes";
import { penerimaanRoutes } from "./modules/penerimaan/routes";
import { rekomendasiRoutes } from "./modules/rekomendasi/routes";
import { sampahRoutes } from "./modules/sampah/routes";
import { shiftRoutes } from "./modules/shift/routes";
import { supplierRoutes } from "./modules/supplier/routes";
import { transferRoutes } from "./modules/transfer/routes";
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
  // Produksi juga terbuka untuk role KITCHEN & BAR (dua divisi produksi cabang
  // store): memproduksi bahan ber-produksi_di="cabang" DIVISINYA sendiri di
  // cabangnya — hasil masuk stok cabang itu (kitchen hanya resep divisi
  // kitchen; bar hanya divisi bar — ditegakkan di modul produksi). Keduanya
  // TIDAK mendapat /pembelian (belanja tetap urusan manajemen/CK); penempatan
  // di cabang store dijaga saat buat/ubah karyawan, dan kunci per-request
  // tetap lewat terikatCabang.
  const izinkanProduksi: MiddlewareHandler<AppEnv> = async (c, next) => {
    const auth = c.get("auth");
    if ((auth.role === "kitchen" || auth.role === "bar") && auth.branch_id) return next();
    return izinkanManajemenAtauKaryawanCk(c, next);
  };
  tenant.use("/produksi/*", izinkanProduksi);
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
  // digerbang per-rute di modulnya). Tim, kitchen & bar ikut agar bisa absen
  // sendiri.
  tenant.use("/absensi/*", requireRole("owner", "admin", "cashier", "tim", "kitchen", "bar"));
  // TRANSFER STOK: yang MENGIRIM hanya Central Kitchen — ditegakkan di modulnya
  // pada cabang ASAL (403 bila bukan CK), jadi bukan urusan gerbang peran ini.
  // Gerbang di sini sengaja longgar sampai kasir: semua peran cabang perlu
  // MELIHAT barang yang sedang menuju cabangnya. Mereka tetap tak bisa membuat
  // transfer — cabang mereka bukan CK, dan peran terkunci hanya boleh memakai
  // cabangnya sendiri sebagai asal.
  tenant.use(
    "/transfer-stok/*",
    requireRole("owner", "admin", "cashier", "tim", "kitchen", "bar"),
  );
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
    // transfer stok antar lokasi (faktur TF-, multi bahan)
    .route("/transfer-stok", transferRoutes)
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
  // Header keamanan HTTP (defense-in-depth) untuk SELURUH respons: API JSON,
  // aset statis, dan shell SPA. Dipasang PALING AWAL agar juga menutupi rute
  // statis yang didaftarkan belakangan (index.ts).
  //
  // CSP disetel agar KOMPATIBEL dengan SPA hasil build:
  // - script-src 'self'  → hanya bundel ber-hash milik sendiri (tanpa inline).
  // - style-src 'unsafe-inline' → Tailwind + gaya inline React/Leaflet + <style>
  //   sementara pada jalur unduh PDF (html2pdf).
  // - img-src https:/data:/blob: → ubin peta OpenStreetMap, logo dari R2, QR
  //   data-URI, dan kanvas PDF (blob).
  // - connect-src 'self' → SPA hanya memanggil API di origin yang sama.
  // Tidak memakai upgrade-insecure-requests agar dev http://localhost tak rusak.
  app.use(
    "*",
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
        formAction: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        fontSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        workerSrc: ["'self'", "blob:"],
      },
    }),
  );
  // Kompresi respons (gzip/deflate, ambang 1 KB) untuk SEMUA rute — JSON daftar
  // besar (/bahan, /stok, /produksi) maupun aset JS/CSS statis yang didaftarkan
  // belakangan (index.ts). Filter bawaan hanya menyentuh tipe kompresibel —
  // gambar/berkas yang sudah terkompresi dilewati otomatis.
  app.use("*", compress());
  app.use("*", logger());

  // ETag + 304 untuk endpoint DAFTAR master data. Aplikasi mobile merevalidasi
  // cache-nya di latar belakang; tanpa ini tiap revalidasi menarik badan penuh
  // walau tak ada yang berubah — mahal di sinyal buruk, dan itu justru saat
  // revalidasi paling sering jalan.
  //
  // Yang dihemat HANYA byte di kabel: digest dihitung dari badan respons yang
  // sudah jadi, jadi query DB + serialisasi tetap berjalan penuh.
  //
  // Didaftarkan SETELAH compress() supaya berjalan DI DALAMNYA — digest dihitung
  // dari byte belum-terkompresi. Kalau terbalik, ETag ikut berubah mengikuti
  // level kompresi dan tak pernah cocok. (Saat respons jadi terkompresi, compress
  // melemahkan ETag jadi `W/"…"`; pencocokan If-None-Match mengabaikan awalan
  // `W/`, jadi klien ber-gzip dan tanpa-gzip sama-sama kena 304.)
  //
  // Syarat yang tidak boleh lepas: urutan JSON harus deterministik. Semua query
  // daftar di bawah ini — termasuk larik bersarang `komponen` & `branch_ids`
  // pada /menu — memakai ORDER BY dengan pemutus seri. Tanpa itu digest berubah
  // walau datanya sama, dan gejalanya menyamar jadi "data memang sering
  // berubah" sehingga sangat sulit dilacak.
  const etagDaftar = etag();
  for (const jalur of ["/api/menu", "/api/kategori", "/api/cabang", "/api/meja"]) {
    app.use(jalur, async (c, next) => {
      if (c.req.method !== "GET") return next();
      await etagDaftar(c, next);
      // `private` menjaga cache bersama tak pernah menyimpan badan milik satu
      // tenant; `no-cache` mewajibkan revalidasi (bukan "jangan simpan"), yang
      // memang alur yang kita mau. Keduanya ikut terbawa pada respons 304.
      c.res.headers.set("Cache-Control", "private, no-cache");
      c.res.headers.set("Vary", "Authorization");
      // WAJIB: pasang ulang build id di SINI, di luar middleware etag.
      // Middleware itu membangun respons 304 dari nol dan hanya menyisakan
      // header tertentu — `X-Kakarut-Build` yang dipasang middleware di dalam
      // ikut terbuang. Browser lalu memakai ulang nilai LAMA dari entri
      // cache-nya, klien mengira ada versi baru padahal barusan diperbarui,
      // dan dialog "Ada pembaruan aplikasi" muncul lagi tepat setelah dimuat
      // ulang — berputar tanpa henti.
      const build = getBuildId();
      if (build) c.res.headers.set("X-Kakarut-Build", build);
    });
  }

  app.route("/api", api);
  // Suntik referensi app ke modul sync agar bisa sub-request internal ke
  // endpoint asli (Fase 2) tanpa import melingkar.
  setSyncApp(app);

  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json({ error: err.message }, err.status);
    }
    console.error(err);
    return c.json({ error: "Terjadi kesalahan pada server" }, 500);
  });

  return app;
}

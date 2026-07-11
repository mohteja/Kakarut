import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app";
import { env } from "./config/env";
import { db } from "./db/client";
import { runMigrations } from "./db/migrate";
import { backfillKodeMenu } from "./modules/menu/service";
import { backfillEmployeeCode } from "./modules/users/service";
import { getStorage, localUploadDir } from "./modules/upload/storage";

// Migrasi otomatis saat boot: deploy versi baru langsung menerapkan skema
// terbaru. Idempotent + advisory lock (aman multi-instance).
// Nonaktifkan dengan AUTO_MIGRATE=false bila migrasi dikelola terpisah.
if (env.AUTO_MIGRATE) {
  console.log("Menjalankan migrasi database (AUTO_MIGRATE)…");
  await runMigrations();
  console.log("Migrasi database selesai.");
  // Menu lama tanpa kode → isi kode otomatis (idempotent, hanya baris NULL)
  const terisi = await backfillKodeMenu(db);
  if (terisi > 0) console.log(`Kode menu otomatis diisi untuk ${terisi} menu lama.`);
  // Karyawan lama tanpa kode → isi kode karyawan otomatis (untuk absensi)
  const terisiKar = await backfillEmployeeCode(db);
  if (terisiKar > 0) console.log(`Kode karyawan otomatis diisi untuk ${terisiKar} karyawan.`);
}

const app = createApp();
const here = path.dirname(fileURLToPath(import.meta.url));

// File upload mode lokal → sajikan dari disk
const storage = getStorage();
if (storage.mode === "local") {
  app.use(
    "/uploads/*",
    serveStatic({
      root: path.relative(process.cwd(), localUploadDir),
      rewriteRequestPath: (p) => p.replace(/^\/uploads/, ""),
    }),
  );
}

// SPA hasil build (apps/web/dist) — satu proses untuk API + frontend
const webDist = path.resolve(here, "../../web/dist");
if (existsSync(webDist)) {
  app.use("/*", serveStatic({ root: path.relative(process.cwd(), webDist) }));
  const indexHtml = readFileSync(path.join(webDist, "index.html"), "utf8");
  app.notFound((c) => {
    if (c.req.path.startsWith("/api") || c.req.path.startsWith("/uploads")) {
      return c.json({ error: "Tidak ditemukan" }, 404);
    }
    // history fallback untuk react-router. HTML shell TIDAK di-cache agar
    // setelah re-deploy browser selalu ambil index.html terbaru (referensi
    // aset ber-hash baru) — mencegah 404 chunk lama.
    c.header("Cache-Control", "no-cache");
    return c.html(indexHtml);
  });
} else {
  app.notFound((c) => c.json({ error: "Tidak ditemukan" }, 404));
}

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`Kakarut POS berjalan di http://localhost:${info.port}`);
  console.log(`Mode penyimpanan upload: ${storage.mode}`);
  console.log(`Frontend: ${existsSync(webDist) ? "tersedia (dist)" : "belum di-build"}`);
});

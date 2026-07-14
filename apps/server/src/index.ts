import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Context } from "hono";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app";
import { env } from "./config/env";
import { db } from "./db/client";
import { computeBuildId, setBuildId } from "./lib/build";
import { runMigrations } from "./db/migrate";
import { backfillKodeMenu } from "./modules/menu/service";
import { backfillKodeBahan } from "./modules/bahan/kode";
import { backfillUnits } from "./modules/satuan/service";
import { arsipkanMembershipNonaktif, backfillEmployeeCode } from "./modules/users/service";
import { getStorage, localUploadDir } from "./modules/upload/storage";

// Migrasi otomatis saat boot: deploy versi baru langsung menerapkan skema
// terbaru. Idempotent + advisory lock (aman multi-instance).
// Nonaktifkan dengan AUTO_MIGRATE=false bila migrasi dikelola terpisah.
//
// DB bisa belum siap tepat saat boot (Neon/serverless bangun dari idle, atau
// container DB ikut restart saat deploy). Tanpa retry, proses crash → restart
// loop → container lama-lama sehat, memperpanjang jendela 404 di proxy.
// Coba ulang beberapa kali sebelum menyerah.
if (env.AUTO_MIGRATE) {
  console.log("Menjalankan migrasi database (AUTO_MIGRATE)…");
  const MAKS_COBA = 10;
  for (let coba = 1; ; coba++) {
    try {
      await runMigrations();
      break;
    } catch (e) {
      if (coba >= MAKS_COBA) throw e;
      const pesan = e instanceof Error ? e.message : String(e);
      console.log(`Database belum siap (${pesan}) — coba lagi ${coba}/${MAKS_COBA} dalam 3 dtk…`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  console.log("Migrasi database selesai.");
  // Menu lama tanpa kode → isi kode otomatis (idempotent, hanya baris NULL)
  const terisi = await backfillKodeMenu(db);
  if (terisi > 0) console.log(`Kode menu otomatis diisi untuk ${terisi} menu lama.`);
  // Bahan lama tanpa kode → isi kode; perusahaan tanpa master satuan → seed bawaan.
  const terisiKodeBahan = await backfillKodeBahan(db);
  if (terisiKodeBahan > 0) console.log(`Kode bahan otomatis diisi untuk ${terisiKodeBahan} bahan.`);
  const unitDibuat = await backfillUnits(db);
  if (unitDibuat > 0) console.log(`Master satuan bawaan diisi (${unitDibuat} satuan).`);
  // Karyawan lama tanpa kode → isi kode karyawan otomatis (untuk absensi)
  const terisiKar = await backfillEmployeeCode(db);
  if (terisiKar > 0) console.log(`Kode karyawan otomatis diisi untuk ${terisiKar} karyawan.`);
  // Nonaktif = arsip: karyawan nonaktif lama dipindah ke arsip (idempoten)
  const terarsip = await arsipkanMembershipNonaktif(db);
  if (terarsip > 0) console.log(`${terarsip} karyawan nonaktif lama dipindah ke arsip.`);
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
  const indexHtmlRaw = readFileSync(path.join(webDist, "index.html"), "utf8");
  // Build id (hash index.html) → dipakai klien mendeteksi versi baru. Disuntik
  // ke <meta> agar tab tahu build yang SEDANG dimuatnya, lalu dibandingkan
  // dgn header/health build server pada request berikutnya.
  const buildId = computeBuildId(indexHtmlRaw);
  setBuildId(buildId);
  console.log(`Build frontend: ${buildId}`);
  const indexHtml = indexHtmlRaw.replace(
    "</head>",
    `    <meta name="kakarut-build" content="${buildId}" />\n  </head>`,
  );
  // HTML shell TIDAK di-cache agar setelah re-deploy browser selalu ambil versi
  // terbaru (referensi aset ber-hash baru) — mencegah 404 chunk lama.
  const kirimShell = (c: Context) => {
    c.header("Cache-Control", "no-cache");
    return c.html(indexHtml);
  };
  // Root & index.html HARUS memakai HTML ber-<meta build> (bukan file mentah
  // dari serveStatic) supaya tab yang dibuka via "/" ikut punya build id.
  app.get("/", kirimShell);
  app.get("/index.html", kirimShell);
  // Aset ber-hash (js/css/img) dilayani statis dari disk.
  app.use("/*", serveStatic({ root: path.relative(process.cwd(), webDist) }));
  // history fallback react-router untuk deep-link (mis. /dashboard).
  app.notFound((c) => {
    if (c.req.path.startsWith("/api") || c.req.path.startsWith("/uploads")) {
      return c.json({ error: "Tidak ditemukan" }, 404);
    }
    return kirimShell(c);
  });
} else {
  app.notFound((c) => c.json({ error: "Tidak ditemukan" }, 404));
}

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`Kakarut POS berjalan di http://localhost:${info.port}`);
  console.log(`Mode penyimpanan upload: ${storage.mode}`);
  console.log(`Frontend: ${existsSync(webDist) ? "tersedia (dist)" : "belum di-build"}`);
});

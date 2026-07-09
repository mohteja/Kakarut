/**
 * Migrasi database terprogram — dipakai oleh:
 *  1. CLI `npm run db:migrate` (migrate-cli.ts)
 *  2. Server saat boot (env AUTO_MIGRATE, default aktif) → deploy fitur baru
 *     otomatis menerapkan migrasi tanpa langkah manual
 *  3. Panel super-admin (GET/POST /api/admin/sistem) → lihat status & jalankan
 */
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, pool } from "./client";

const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../drizzle",
);

// Advisory lock unik aplikasi: beberapa instance server yang start bersamaan
// tidak akan menjalankan migrasi ganda.
const MIGRATION_LOCK_KEY = 727272001;

export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    try {
      await migrate(db, { migrationsFolder });
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

export interface MigrationEntry {
  tag: string;
  /** timestamp pembuatan file migrasi (dari journal drizzle) */
  dibuat: string | null;
  status: "terpasang" | "menunggu";
}

export interface MigrationStatus {
  total: number;
  terpasang: number;
  menunggu: number;
  terakhir_diterapkan: string | null;
  daftar: MigrationEntry[];
}

/**
 * Bandingkan journal migrasi (file di repo) dengan tabel riwayat drizzle
 * (drizzle.__drizzle_migrations). Drizzle menerapkan migrasi berurutan,
 * jadi jumlah baris riwayat = jumlah entri journal yang sudah terpasang.
 */
export async function migrationStatus(): Promise<MigrationStatus> {
  const journal = JSON.parse(
    readFileSync(path.join(migrationsFolder, "meta/_journal.json"), "utf8"),
  ) as { entries: { idx: number; when: number; tag: string }[] };
  const entries = [...journal.entries].sort((a, b) => a.idx - b.idx);

  let appliedCount = 0;
  let lastApplied: string | null = null;
  try {
    const res = await pool.query(
      "SELECT count(*)::int AS c, max(created_at) AS last FROM drizzle.__drizzle_migrations",
    );
    appliedCount = res.rows[0].c as number;
    const last = res.rows[0].last as string | number | null;
    if (last != null) lastApplied = new Date(Number(last)).toISOString();
  } catch {
    // tabel riwayat belum ada = belum ada migrasi yang diterapkan
  }

  const daftar: MigrationEntry[] = entries.map((e, i) => ({
    tag: e.tag,
    dibuat: e.when ? new Date(e.when).toISOString() : null,
    status: i < appliedCount ? "terpasang" : "menunggu",
  }));

  return {
    total: entries.length,
    terpasang: Math.min(appliedCount, entries.length),
    menunggu: Math.max(entries.length - appliedCount, 0),
    terakhir_diterapkan: lastApplied,
    daftar,
  };
}

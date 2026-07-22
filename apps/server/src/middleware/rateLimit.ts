import { getConnInfo } from "@hono/node-server/conninfo";
import { sql } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { db } from "../db/client";
import type { AppEnv } from "./auth";

/**
 * Rate limiter fixed-window — pertahanan lini pertama terhadap brute-force /
 * abuse pada endpoint sensitif (login, lupa/atur ulang password, verifikasi
 * email, masuk tamu, sinkron antrean).
 *
 * Store DEFAULT = Postgres (terpusat): aman di belakang banyak instance server
 * (batas dihitung bersama, bukan per-proses) dan bertahan lintas restart/redeploy
 * (tidak ada jendela "batas ter-reset" saat deploy). Store bisa diganti (mis.
 * `memoryStore()` untuk unit test tanpa DB).
 */

export interface RateLimitOpts {
  /** Panjang jendela (ms). */
  windowMs: number;
  /** Maksimum permintaan per kunci dalam satu jendela. */
  max: number;
  /** Identitas bucket; async karena bisa membaca body (mis. email pada login). */
  key: (c: Context<AppEnv>) => string | Promise<string>;
  /** Pesan 429 yang ramah pengguna. */
  message?: string;
}

/** Hasil satu "hit": jumlah dalam jendela berjalan + kapan jendela reset (epoch ms). */
export interface RateLimitStore {
  hit(bucket: string, windowMs: number): Promise<{ count: number; resetMs: number }>;
}

/**
 * Store in-memory (per-proses) — dipakai unit test & fallback dev tanpa DB.
 * Tiap store memegang petanya sendiri sehingga kunci antar-store tak bertabrakan.
 */
export function memoryStore(): RateLimitStore {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  let lastSweep = 0;
  return {
    async hit(bucket, windowMs) {
      const now = Date.now();
      if (now - lastSweep > windowMs) {
        for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
        lastSweep = now;
      }
      let b = buckets.get(bucket);
      if (!b || b.resetAt <= now) {
        b = { count: 0, resetAt: now + windowMs };
        buckets.set(bucket, b);
      }
      b.count += 1;
      return { count: b.count, resetMs: b.resetAt };
    },
  };
}

/**
 * Store Postgres (terpusat). Satu upsert atomik menaikkan `count`; bila
 * `reset_at` sudah lewat, jendela di-reset (count=1, reset_at baru). Semua pakai
 * jam DB (`now()`) supaya konsisten antar-instance.
 */
export function pgStore(): RateLimitStore {
  return {
    async hit(bucket, windowMs) {
      const win = Math.max(1, Math.ceil(windowMs / 1000)); // detik
      const res = await db.execute(sql`
        INSERT INTO rate_limits (bucket, count, reset_at)
        VALUES (${bucket}, 1, now() + make_interval(secs => ${win}))
        ON CONFLICT (bucket) DO UPDATE SET
          count = CASE WHEN rate_limits.reset_at <= now() THEN 1 ELSE rate_limits.count + 1 END,
          reset_at = CASE WHEN rate_limits.reset_at <= now()
            THEN now() + make_interval(secs => ${win}) ELSE rate_limits.reset_at END
        RETURNING count, (extract(epoch from reset_at) * 1000)::bigint AS reset_ms
      `);
      const row = res.rows[0] as { count: number | string; reset_ms: number | string };
      return { count: Number(row.count), resetMs: Number(row.reset_ms) };
    },
  };
}

/** Store default proses ini (Postgres). Objek dibuat malas — tak query saat impor. */
const defaultStore: RateLimitStore = pgStore();

/**
 * Bangun middleware pembatas laju. Store bisa di-inject (default Postgres).
 * FAIL-OPEN: bila store error (mis. DB sesaat down), permintaan DIIZINKAN —
 * gangguan store tak boleh mengunci semua pengguna dari endpoint kritis.
 */
export function rateLimit(
  opts: RateLimitOpts,
  store: RateLimitStore = defaultStore,
): MiddlewareHandler<AppEnv> {
  const { windowMs, max, message } = opts;
  return async (c, next) => {
    const id = await opts.key(c);
    let hit: { count: number; resetMs: number };
    try {
      hit = await store.hit(id, windowMs);
    } catch (e) {
      console.warn("Rate limit store error (fail-open):", e instanceof Error ? e.message : String(e));
      return next();
    }
    if (hit.count > max) {
      const retry = Math.max(1, Math.ceil((hit.resetMs - Date.now()) / 1000));
      c.header("Retry-After", String(retry));
      throw new HTTPException(429, {
        message: message ?? "Terlalu banyak permintaan — coba lagi nanti.",
      });
    }
    return next();
  };
}

/** Hapus baris rate-limit yang jendelanya sudah lewat (housekeeping). */
export async function bersihkanRateLimitKedaluwarsa(): Promise<number> {
  try {
    const res = await db.execute(sql`DELETE FROM rate_limits WHERE reset_at <= now()`);
    return res.rowCount ?? 0;
  } catch {
    return 0;
  }
}

/** Middleware kosong (dipakai saat rate limiting dimatikan lewat env). */
export const lewatiRateLimit: MiddlewareHandler<AppEnv> = (_c, next) => next();

/**
 * IP klien untuk keperluan pembatasan laju. Di belakang proxy tepercaya,
 * X-Forwarded-For / X-Real-IP diisi proxy; jika tidak ada, pakai alamat koneksi
 * sebenarnya. Bila keduanya tak tersedia (mis. saat unit test tanpa server
 * Node), jatuh ke "unknown".
 */
export function ipKlien(c: Context<AppEnv>): string {
  const xff = c.req.header("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const xr = c.req.header("x-real-ip");
  if (xr) return xr.trim();
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

/** Ambil email dari body JSON secara best-effort (tak menggagalkan bila kosong/invalid). */
export async function emailDariBody(c: Context<AppEnv>): Promise<string> {
  try {
    const body = (await c.req.json()) as { email?: unknown };
    return typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  } catch {
    return "";
  }
}

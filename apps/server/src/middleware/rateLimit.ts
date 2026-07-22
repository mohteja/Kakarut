import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "./auth";

/**
 * Rate limiter in-memory sederhana (fixed window) — pertahanan lini pertama
 * terhadap brute-force / abuse pada endpoint sensitif (login, lupa/atur ulang
 * password, masuk tamu, sinkron antrean).
 *
 * CATATAN OPERASIONAL: state disimpan per-proses. Di belakang beberapa instance
 * server, tiap instance memegang jendelanya sendiri (batas efektif ≈ max ×
 * jumlah instance). Cukup untuk deployment satu proses; untuk skala besar/HA,
 * ganti store dengan yang terpusat (mis. Redis) tanpa mengubah pemanggilnya.
 */

type Bucket = { count: number; resetAt: number };

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

/**
 * Bangun middleware pembatas laju. Tiap limiter memegang peta bucket sendiri
 * sehingga kunci antar-limiter tidak pernah bertabrakan.
 */
export function rateLimit(opts: RateLimitOpts): MiddlewareHandler<AppEnv> {
  const { windowMs, max, message } = opts;
  const buckets = new Map<string, Bucket>();
  let lastSweep = 0;

  return async (c, next) => {
    const now = Date.now();
    // Sapu berkala entri kedaluwarsa supaya peta tak tumbuh tanpa batas.
    if (now - lastSweep > windowMs) {
      for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
      lastSweep = now;
    }

    const id = await opts.key(c);
    let b = buckets.get(id);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(id, b);
    }
    b.count += 1;

    if (b.count > max) {
      const retry = Math.max(1, Math.ceil((b.resetAt - now) / 1000));
      c.header("Retry-After", String(retry));
      throw new HTTPException(429, {
        message: message ?? "Terlalu banyak permintaan — coba lagi nanti.",
      });
    }
    return next();
  };
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

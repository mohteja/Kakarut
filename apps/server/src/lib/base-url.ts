import type { Context } from "hono";
import { env } from "../config/env";

/** Ambil nilai pertama dari header yang mungkin berisi daftar (mis. proxy berlapis). */
function nilaiPertama(v: string | undefined): string {
  return (v ?? "").split(",")[0].trim();
}

/**
 * Base URL publik aplikasi untuk membangun tautan di email (verifikasi email,
 * reset password, undangan).
 *
 * Utamakan `APP_BASE_URL` bila di-set eksplisit (mis. domain kustom di depan
 * proxy). Bila tidak, TURUNKAN dari header permintaan (proto + host) — karena
 * frontend & API dilayani satu proses/origin, tautan otomatis mengarah ke
 * domain yang sedang dipakai pengguna (bukan hardcode localhost). Fallback
 * terakhir `http://localhost:3000` hanya bila tak ada header Host sama sekali.
 */
export function appBaseUrl(c: Context): string {
  if (env.APP_BASE_URL) return env.APP_BASE_URL.replace(/\/+$/, "");
  const proto = nilaiPertama(c.req.header("x-forwarded-proto")) || "http";
  const host = nilaiPertama(c.req.header("x-forwarded-host")) || nilaiPertama(c.req.header("host"));
  return host ? `${proto}://${host}` : "http://localhost:3000";
}

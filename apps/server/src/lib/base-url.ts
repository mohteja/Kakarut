import type { Context } from "hono";
import { env } from "../config/env";

/** Ambil nilai pertama dari header yang mungkin berisi daftar (mis. proxy berlapis). */
function nilaiPertama(v: string | undefined): string {
  return (v ?? "").split(",")[0].trim();
}

/** Host yang dinyatakan permintaan — proxy dulu, lalu `Host`. */
function hostDariPermintaan(c: Context): { proto: string; host: string } {
  const proto = nilaiPertama(c.req.header("x-forwarded-proto")) || "http";
  const host = nilaiPertama(c.req.header("x-forwarded-host")) || nilaiPertama(c.req.header("host"));
  return { proto, host };
}

/** Daftar host yang boleh dipakai membangun tautan, dari `APP_HOST_DIPERCAYA`. */
export function hostDipercaya(): string[] {
  return (env.APP_HOST_DIPERCAYA ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Base URL publik aplikasi untuk membangun tautan di email (verifikasi email,
 * reset password, undangan).
 *
 * Utamakan `APP_BASE_URL` bila di-set eksplisit (mis. domain kustom di depan
 * proxy). Bila tidak, TURUNKAN dari header permintaan (proto + host) — karena
 * frontend & API dilayani satu proses/origin, tautan otomatis mengarah ke
 * domain yang sedang dipakai pengguna (bukan hardcode localhost).
 *
 * ⚠️ HOST ITU DIKENDALIKAN PEMINTA, dan itu TEREPRODUKSI (2026-08-26):
 *
 *     POST /api/auth/forgot-password   Host: penyerang.example
 *     → {"dev_reset_url":"http://penyerang.example/reset-password?token=a9c078…"}
 *
 *     …dan lewat X-Forwarded-Host, dengan proto ikut ditempa:
 *     → "https://penyerang.example/reset-password?token=e7fc51…"
 *
 * Token di tautan itu HIDUP dan milik korban. Surat yang mendarat di kotak
 * masuk korban menunjuk domain penyerang; sekali diklik, tokennya berpindah
 * tangan — pengambilalihan akun, bukan sekadar phishing.
 *
 * PENAWARNYA KONFIGURASI, dan kode ini membuat konfigurasi itu berkuasa:
 *
 *   1. `APP_BASE_URL` di-set  → dipakai apa adanya. Header diabaikan total.
 *   2. `APP_HOST_DIPERCAYA` di-set → host dari header WAJIB ada di daftar itu;
 *      kalau tidak, dipakai entri pertama daftar. Untuk pemasangan
 *      multi-domain yang tak bisa memaku satu `APP_BASE_URL`.
 *   3. Keduanya kosong → perilaku lama dipertahankan (tautan mengikuti domain
 *      yang sedang dipakai — satu-satunya yang bekerja di dev/lokal), TAPI
 *      `pemeriksaan-setelan` melaporkannya sebagai temuan **kritis** ke panel
 *      super admin, satu jalur dengan `JWT_SECRET belum di-set`.
 *
 * Kenapa nomor 3 tidak dibuat keras: bila produksi belum menyetel apa pun,
 * menolak menurunkan dari header akan membuat SELURUH tautan reset & verifikasi
 * menunjuk `localhost` — surat yang sama sekali tak bisa dipakai. Itu menukar
 * lubang yang butuh penyerang dengan kerusakan yang pasti. Yang benar:
 * membuatnya TERLIHAT sampai disetel.
 */
export function appBaseUrl(c: Context): string {
  if (env.APP_BASE_URL) return env.APP_BASE_URL.replace(/\/+$/, "");
  const { proto, host } = hostDariPermintaan(c);
  const daftar = hostDipercaya();
  if (daftar.length > 0) {
    if (host && daftar.includes(host.toLowerCase())) return `${proto}://${host}`;
    // Host tak dikenal → JANGAN pakai. Entri pertama adalah domain kanonik.
    return `https://${daftar[0]}`;
  }
  return host ? `${proto}://${host}` : "http://localhost:3000";
}

/**
 * Apakah tautan email saat ini dibangun dari header yang dikendalikan peminta?
 * Dipakai `pemeriksaan-setelan` untuk melaporkannya ke panel super admin.
 */
export function tautanEmailDariHeader(): boolean {
  return !env.APP_BASE_URL && hostDipercaya().length === 0;
}

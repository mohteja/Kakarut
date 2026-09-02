import type { Context, MiddlewareHandler } from "hono";
import { env } from "../config/env";
import { hostDariPermintaan, hostDipercaya } from "./base-url";

/**
 * ASAL KANONIK — satu asal (origin) untuk satu sesi.
 *
 * Sesi web disimpan di `localStorage`, dan `localStorage` itu per ASAL: skema +
 * host + port. `https://www.terakasir.com` dan `https://terakasir.com` adalah
 * dua asal, jadi dua penyimpanan, jadi dua "peramban" bagi sesi — login di
 * satu tab tak terlihat dari tab yang membuka alias-nya. Dan Chrome
 * MENYEMBUNYIKAN `www.` di bilah alamat, sehingga keduanya tampak sama bagi
 * orang yang mengalaminya (dilaporkan pemilik repo 2026-09-02: "sudah login,
 * buka terakasir.com di tab lain → halaman depan, tombol Masuk masih menerima
 * akun lain").
 *
 * Penawarnya di SERVER, sebelum shell SPA dilayani: permintaan DOKUMEN yang
 * datang lewat alias dialihkan 301 ke asal kanonik, jalur dan query utuh.
 *
 * Yang dianggap alias — dan HANYA ini, supaya salah konfigurasi tak bisa
 * mengalihkan ke host yang tak dilayani siapa pun:
 *   · host yang sama dengan kanonik tapi `http` (dinaikkan ke `https`; tak
 *     pernah diturunkan);
 *   · `www.` + host kanonik, atau host kanonik minus `www.`;
 *   · host lain yang tercantum di `APP_HOST_DIPERCAYA`.
 *
 * Asal kanonik = `APP_BASE_URL`, atau entri pertama `APP_HOST_DIPERCAYA`
 * (https). Tanpa keduanya TIDAK ADA pengalihan: kanonik adalah fakta
 * pemasangan yang hanya pemiliknya tahu, dan tebakan yang salah membuat situs
 * tak terjangkau — lebih buruk daripada sesi yang terbelah. Kekosongannya
 * sudah dilaporkan panel super admin sebagai temuan kritis (`tautanEmailDariHeader`).
 *
 * Yang TIDAK dialihkan: `/api/*` (klien ponsel & skrip memanggil host mana pun
 * yang dikonfigurasi; 301 pada POST mengubah metode), `/uploads/*` dan
 * `/assets/*` (dimuat halaman yang SUDAH berada di suatu asal — module script
 * yang dialihkan lintas asal gagal di CORS), berkas statis berekstensi
 * (favicon, manifest, robots), dan selain GET/HEAD.
 */
export interface KonfigKanonik {
  baseUrl?: string;
  dipercaya: string[];
}

export interface PermintaanKanonik {
  proto: string;
  host: string;
  path: string;
  /** Query mentah tanpa `?`, kosong bila tak ada. */
  query: string;
}

const AWALAN_LEWAT = ["/api", "/uploads", "/assets"];

/** Jalur yang boleh dialihkan: navigasi dokumen SPA, bukan aset/API. */
export function jalurDokumen(path: string): boolean {
  if (AWALAN_LEWAT.some((a) => path === a || path.startsWith(`${a}/`))) return false;
  if (path === "/" || path === "/index.html") return true;
  return !/\.[a-z0-9]+$/i.test(path);
}

function asalKanonik(k: KonfigKanonik): URL | null {
  const mentah = k.baseUrl?.trim() || (k.dipercaya[0] ? `https://${k.dipercaya[0]}` : "");
  if (!mentah) return null;
  try {
    const u = new URL(mentah);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u;
  } catch {
    // `APP_BASE_URL` yang bukan URL sah → dianggap tak dikonfigurasi: TANPA
    // pengalihan, bukan pengalihan ke tempat yang salah. Panel super admin
    // sudah melaporkan konfigurasi tautan yang kosong/tak sah.
    return null;
  }
}

/**
 * URL tujuan pengalihan bila permintaan datang lewat alias asal kanonik; `null`
 * bila sudah kanonik, alias-nya tak dikenal, atau kanonik tak dikonfigurasi.
 * Murni — konfigurasinya diterima sebagai argumen supaya bisa diuji tanpa env.
 */
export function tujuanKanonik(r: PermintaanKanonik, k: KonfigKanonik): string | null {
  const kanonik = asalKanonik(k);
  if (!kanonik) return null;
  const host = r.host.trim().toLowerCase();
  if (!host) return null;
  const protoKini = r.proto.trim().toLowerCase() || "http";
  const protoKanonik = kanonik.protocol.slice(0, -1);
  const hostKanonik = kanonik.host.toLowerCase();

  if (host === hostKanonik) {
    // Host sudah benar: hanya naikkan http → https, jangan pernah turunkan.
    if (protoKini === protoKanonik) return null;
    if (!(protoKini === "http" && protoKanonik === "https")) return null;
  } else {
    const dipercaya = k.dipercaya.map((h) => h.trim().toLowerCase()).filter(Boolean);
    const alias =
      host === `www.${hostKanonik}` || hostKanonik === `www.${host}` || dipercaya.includes(host);
    if (!alias) return null;
  }
  return `${kanonik.origin}${r.path}${r.query ? `?${r.query}` : ""}`;
}

function konfigDariEnv(): KonfigKanonik {
  return { baseUrl: env.APP_BASE_URL, dipercaya: hostDipercaya() };
}

/**
 * Middleware Hono: 301 ke asal kanonik untuk navigasi dokumen lewat alias.
 * `konfig` bisa disuntik (uji); bawaannya dibaca dari env tiap permintaan.
 */
export function redirectKanonik(konfig: () => KonfigKanonik = konfigDariEnv): MiddlewareHandler {
  return async (c: Context, next) => {
    if (c.req.method === "GET" || c.req.method === "HEAD") {
      const path = c.req.path;
      if (jalurDokumen(path)) {
        const { proto, host } = hostDariPermintaan(c);
        const query = new URL(c.req.url).search.replace(/^\?/, "");
        const tujuan = tujuanKanonik({ proto, host, path, query }, konfig());
        if (tujuan) {
          c.header("Cache-Control", "no-cache");
          return c.redirect(tujuan, 301);
        }
      }
    }
    await next();
  };
}

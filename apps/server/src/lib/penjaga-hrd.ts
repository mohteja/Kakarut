import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../middleware/auth";

/**
 * PERAN HRD = PERSONALIA, BUKAN MANAJEMEN.
 *
 * Banyak modul tenant tak punya penjaga awalan (`/menu`, `/stok`, `/penjualan`,
 * `/bahan`, …) — pintunya terbuka untuk semua anggota perusahaan dan hanya
 * rute TULIS yang dijaga `requireRole`. Peran baru otomatis mewarisi bacaan
 * itu semua. HRD tak punya urusan dengan omzet, stok, atau resep, jadi yang
 * dipakai DAFTAR IZIN, bukan daftar larangan: modul yang lahir kelak tetap
 * tertutup untuk HRD sampai sengaja dibuka di sini.
 */
const BOLEH_SEMUA = new Set([
  "karyawan",
  "absensi",
  "pengajuan",
  "kebersihan",
  "profil",
  "gaji",
  "upload",
]);
/** Dibaca untuk nama perusahaan & pemilih cabang — tidak diubah. */
const BOLEH_BACA = new Set(["company", "cabang"]);

export class HrdTidakBerwenang extends HTTPException {
  readonly sebab = "hrd_tidak_berwenang";
  constructor() {
    super(403, { message: "Tidak tersedia untuk peran HRD" });
  }
}

/** Segmen pertama sesudah `/api/` — `"/api/karyawan/x"` → `"karyawan"`. */
export function segmenApi(path: string): string {
  const m = /^\/api\/([^/?]+)/.exec(path);
  return m ? m[1] : "";
}

export function hrdBoleh(method: string, path: string): boolean {
  const seg = segmenApi(path);
  if (BOLEH_SEMUA.has(seg)) return true;
  return BOLEH_BACA.has(seg) && method === "GET";
}

export const penjagaHrd: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get("auth").role === "hrd" && !hrdBoleh(c.req.method, c.req.path)) {
    throw new HrdTidakBerwenang();
  }
  await next();
};

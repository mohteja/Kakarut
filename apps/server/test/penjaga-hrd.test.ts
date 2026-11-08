import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hrdBoleh, segmenApi } from "../src/lib/penjaga-hrd";

/**
 * PERAN HRD: DAFTAR IZIN, BUKAN DAFTAR LARANGAN.
 *
 * Modul tanpa penjaga awalan (`/menu`, `/stok`, `/penjualan`, …) terbuka untuk
 * semua anggota perusahaan. `penjagaHrd` menutup semuanya untuk HRD kecuali
 * modul personalia. Uji ini memaku tiga hal:
 *   1. aturannya sendiri (izin & tolak per jalur),
 *   2. penjaganya benar-benar terpasang di rantai `tenant`,
 *   3. tak ada `requireRole(..., "hrd")` di modul yang tertutup untuk HRD —
 *      membuka pintu di modul tanpa menambah daftar izin adalah pintu mati
 *      yang menipu pembaca.
 */
const APP = readFileSync(fileURLToPath(new URL("../src/app.ts", import.meta.url)), "utf8");
const MODUL = fileURLToPath(new URL("../src/modules/", import.meta.url));

describe("penjaga HRD", () => {
  it("segmen API dibaca dari jalur", () => {
    expect(segmenApi("/api/karyawan/abc")).toBe("karyawan");
    expect(segmenApi("/api/penjualan?x=1")).toBe("penjualan");
    expect(segmenApi("/lain")).toBe("");
  });

  it("modul personalia terbuka penuh", () => {
    for (const p of ["/api/karyawan", "/api/absensi/rekap", "/api/pengajuan/x", "/api/kebersihan/rekap", "/api/profil", "/api/upload"]) {
      expect(hrdBoleh("GET", p), p).toBe(true);
      expect(hrdBoleh("POST", p), p).toBe(true);
    }
  });

  it("perusahaan & cabang hanya DIBACA", () => {
    expect(hrdBoleh("GET", "/api/company")).toBe(true);
    expect(hrdBoleh("PATCH", "/api/company")).toBe(false);
    expect(hrdBoleh("GET", "/api/cabang")).toBe(true);
    expect(hrdBoleh("POST", "/api/cabang")).toBe(false);
  });

  it("omzet, stok, menu, kasir tertutup", () => {
    for (const p of ["/api/penjualan", "/api/stok", "/api/menu", "/api/bahan", "/api/laporan/x", "/api/open-bill", "/api/pesanan", "/api/shift/aktif", "/api/customer", "/api/sync"]) {
      expect(hrdBoleh("GET", p), p).toBe(false);
    }
  });

  it("terpasang di rantai tenant, sesudah requireAuth & requireCompany", () => {
    expect(APP).toMatch(/new Hono<AppEnv>\(\)\.use\("\*", requireAuth, requireCompany, penjagaHrd\)/);
  });

  it('tak ada requireRole(…"hrd") di modul yang tertutup untuk HRD', () => {
    const terbuka = new Set(["users", "absensi", "pengajuan", "kebersihan", "profil", "gaji", "upload"]);
    const nyasar: string[] = [];
    for (const dir of readdirSync(MODUL)) {
      if (terbuka.has(dir)) continue;
      let berkas: string[] = [];
      try {
        berkas = readdirSync(MODUL + dir).filter((f) => f.endsWith(".ts"));
      } catch {
        continue; // bukan direktori
      }
      for (const f of berkas) {
        const isi = readFileSync(`${MODUL}${dir}/${f}`, "utf8");
        if (/requireRole\([^)]*"hrd"/.test(isi)) nyasar.push(`${dir}/${f}`);
      }
    }
    expect(nyasar).toEqual([]);
  });
});

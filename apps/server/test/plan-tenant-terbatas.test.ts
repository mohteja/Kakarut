import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { modeDariPlan } from "../src/modules/company/routes";

/**
 * NILAI `plan` HARUS TERBATAS — hanya "pro" yang berarti Pro.
 *
 * `modeDariPlan` memutuskan seluruh mode tenant dari satu perbandingan persis:
 * `plan === "pro"`. Apa pun selain itu — "Pro", "PRO", "pro " — berarti LITE.
 * Perbandingan itu sendiri benar dan sengaja ketat; yang salah adalah pintu
 * masuknya: `PATCH /admin/tenants/:id` menerima `plan` sebagai `z.string()`
 * bebas, jadi satu huruf besar cukup untuk menurunkan tenant tanpa satu pun
 * peringatan.
 *
 * TERUKUR lewat HTTP: tenant dengan 28 CABANG AKTIF, plan "pro", dikirimi
 * `{"plan":"Pro"}` → dibalas 200, dan `GET /company` seketika berbunyi
 * `mode: "lite"`.
 *
 * Akibatnya bukan kosmetik. `isPro` menggerbangi PEMILIH CABANG di
 * `Layout.tsx:320` — pemilik 28 cabang mendadak cuma bisa menjangkau satu.
 * Juga penugasan cabang karyawan, akses Kantor bagi admin, dan pembuatan
 * cabang baru (`branches/routes.ts:193`). Pelanggan yang membayar Pro berhenti
 * beroperasi karena sebuah string tak cocok.
 *
 * Yang ganjil dari cacatnya: jalur OWNER (`POST /company/mode`) justru dijaga
 * ketat — ia menolak turun ke Lite selama masih ada lebih dari satu cabang
 * aktif. Pintu super admin, yang justru dipakai untuk penagihan, tak punya
 * penjaga apa pun. Bentuk yang berulang di repo ini.
 *
 * Yang TIDAK dilakukan, dan itu disengaja: penurunan plan oleh super admin
 * tetap BOLEH meski cabangnya banyak. Itu memang alat penagihan — memblokirnya
 * berarti tenant yang menunggak tak bisa ditertibkan. Yang diperbaiki cuma
 * bedanya "sengaja diturunkan" dan "salah ketik".
 */
const ADMIN = readFileSync(
  fileURLToPath(new URL("../src/modules/admin-tenants/routes.ts", import.meta.url)),
  "utf8",
);

describe("modeDariPlan: hanya 'pro' yang Pro", () => {
  it("nilai kanonik dipetakan benar", () => {
    expect(modeDariPlan("pro")).toBe("pro");
    expect(modeDariPlan("lite")).toBe("lite");
  });

  it("PREMIS: yang mirip-mirip TIDAK dianggap Pro", () => {
    // Ini bukan cacatnya — ini alasan kenapa pintu masuknya harus terbatas.
    // Perbandingan ketat di sini justru yang benar; yang tak boleh adalah
    // membiarkan nilai seperti ini masuk ke basis data.
    for (const p of ["Pro", "PRO", "pro ", " pro", "professional", ""]) {
      expect(modeDariPlan(p), `"${p}" seharusnya jatuh ke lite`).toBe("lite");
    }
  });
});

describe("pintu super admin membatasi nilainya", () => {
  it("`plan` di PATCH adalah enum, bukan string bebas", () => {
    expect(
      ADMIN,
      "plan bebas: satu huruf besar cukup menurunkan tenant tanpa peringatan",
    ).not.toMatch(/plan:\s*z\.string\(\)\.optional\(\)/);
    expect(ADMIN).toMatch(/plan:\s*PLAN\.optional\(\)/);
  });

  it("`plan` di CREATE juga enum, dengan bawaan 'lite'", () => {
    expect(ADMIN).not.toMatch(/plan:\s*z\.string\(\)\.default\(/);
    expect(ADMIN).toMatch(/plan:\s*PLAN\.default\("lite"\)/);
  });

  it("enumnya memuat TEPAT nilai yang dikenali `modeDariPlan`", () => {
    /*
     * Kalau enumnya kelak ditambah nilai baru (mis. "enterprise") tanpa
     * menyentuh `modeDariPlan`, nilai itu diam-diam berarti LITE — persis
     * kelas cacat yang uji ini ada untuk mencegah, cuma lewat pintu lain.
     */
    const m = ADMIN.match(/const PLAN = z\.enum\(\[([^\]]*)\]\)/);
    expect(m, "definisi PLAN tak ditemukan").not.toBeNull();
    const nilai = m![1].split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean);
    expect(nilai.sort()).toEqual(["lite", "pro"]);
    // …dan tiap nilainya memang dipetakan ke mode yang berbeda.
    expect(new Set(nilai.map(modeDariPlan)).size).toBe(2);
  });

  it("PASANGAN: penjaganya bisa MENUDUH bentuk yang longgar", () => {
    // Ketiga asersi di atas berbentuk "sumber harus cocok pola" — gampang
    // hijau kalau polanya meleset. Sumber tiruan membuktikan polanya menggigit.
    const longgar = 'const PatchTenantBody = z.object({ plan: z.string().optional() });';
    const ketat = 'const PatchTenantBody = z.object({ plan: PLAN.optional() });';
    expect(/plan:\s*z\.string\(\)\.optional\(\)/.test(longgar)).toBe(true);
    expect(/plan:\s*z\.string\(\)\.optional\(\)/.test(ketat)).toBe(false);
    expect(/plan:\s*PLAN\.optional\(\)/.test(ketat)).toBe(true);
  });
});

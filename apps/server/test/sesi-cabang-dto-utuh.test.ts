import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { butaKomentar } from "../src/scripts/buta-komentar";
import { kunciObjek, medanInterface } from "./kunci-sumber";

/**
 * SESI & CABANG DI SHARED == BENTUK YANG BENAR-BENAR DIBANGUN SERVER.
 *
 * Sampai 2026-09-05 tak satu pun medan sesi (`user`/`company`/`branch`/
 * `token`) maupun baris `GET /cabang` ada di Lampiran A: `SesiLogin` hidup
 * di `auth/session.ts` saja, web mengetik ulang `AuthState` sendiri — TANPA
 * `blokir_jual_minus` yang server kirim sejak lama — dan `Cabang` di
 * `BranchContext.tsx`; ponsel mengurai keduanya (`CompanyDto`/`BranchDto`
 * lokal) tanpa satu fikstur pun bisa menagihnya. Dan bentuk `company`
 * dirakit di DUA tempat (`companyDto` + objek inline di `GET /auth/me`) —
 * sembilan medan yang tetap sama hanya karena kebetulan.
 *
 * Terukur lewat HTTP (DB gerbang, owner): `/auth/login` 4 kunci atas,
 * `/auth/me` 3 kunci atas, `.user` 7, `.company` 9, `/cabang` 31 baris × 14.
 *
 * Yang dijaga di sini, dua arah dan diurai dari sumbernya:
 *  - literal `return {…}` di `companyDto` == medan `CompanyDto`;
 *  - literal `rows.map((r): CabangDto => ({…}))` di `GET /cabang` == `CabangDto`;
 *  - SATU penulis bentuk company di seluruh `apps/server/src`: kelima kunci
 *    khasnya hanya boleh muncul sebagai properti di `companyDto`;
 *  - `SesiDto` persis {user, company, branch}; `SesiLogin` menambah `token` saja;
 *  - web tak mendeklarasikan ulang: `AuthState` = `SesiLogin`, `Cabang` = `CabangDto`.
 * Lengan HTTP-nya verify-api §296.
 */
const AKAR = fileURLToPath(new URL("../../../", import.meta.url));
const SESI = "apps/server/src/modules/auth/session.ts";
const CABANG = "apps/server/src/modules/branches/routes.ts";
const TIPE = "packages/shared/src/types.ts";
const WEB_API = "apps/web/src/lib/api.ts";
const WEB_CABANG = "apps/web/src/context/BranchContext.tsx";
const SERVER_SRC = "apps/server/src";

/** Kunci khas bentuk `company` — tak dipakai entitas lain di server. */
export const KUNCI_KHAS_COMPANY = ["pb1_enabled", "pb1_rate", "diskon_maks_persen", "blokir_jual_minus", "logo_url"] as const;

/** Kunci literal `return {…}` di `companyDto`. */
export function kunciCompanyDto(src: string): string[] {
  const buta = butaKomentar(src);
  const fn = buta.indexOf("export function companyDto(");
  if (fn < 0) throw new Error("`export function companyDto(` tak ditemukan di auth/session.ts");
  const ret = buta.indexOf("return {", fn);
  if (ret < 0) throw new Error("`return {` companyDto tak ditemukan");
  return kunciObjek(buta, buta.indexOf("{", ret)).sort();
}

/** Kunci literal baris yang dipetakan `GET /cabang`. */
export function kunciBarisCabang(src: string): string[] {
  const buta = butaKomentar(src);
  const m = /rows\.map\(\(r\): CabangDto => \(\{/.exec(buta);
  if (!m) throw new Error("`rows.map((r): CabangDto => ({` tak ditemukan di GET /cabang");
  return kunciObjek(buta, m.index + m[0].length - 1).sort();
}

/**
 * Situs yang MENULIS properti berkunci khas company (`pb1_enabled: …`),
 * di luar skema zod (`: z.…`). Buta komentar. Bentuk: `berkas:baris:kunci`.
 */
export function situsPenulisCompany(sumber: Record<string, string>): string[] {
  // `:(?!\\s*z\\.)` — lookahead-nya MENCAKUP spasi. Versi pertama `:\\s*(?!z\\.)`
  // mundur (`\\s*` kosong) dan meloloskan skema zod `pb1_enabled: z.boolean()`
  // sebagai penulis — lima baris zod di company/routes.ts ikut tertuduh.
  const re = new RegExp(`^\\s+(${KUNCI_KHAS_COMPANY.join("|")}):(?!\\s*z\\.)`, "gm");
  const keluar: string[] = [];
  for (const [berkas, mentah] of Object.entries(sumber)) {
    const buta = butaKomentar(mentah);
    for (const m of buta.matchAll(re)) {
      const baris = buta.slice(0, m.index).split("\n").length;
      keluar.push(`${berkas}:${baris}:${m[1]}`);
    }
  }
  return keluar.sort();
}

function berkasTs(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const jalur = `${dir}/${n}`;
    if (statSync(jalur).isDirectory()) return berkasTs(jalur);
    return jalur.endsWith(".ts") ? [jalur] : [];
  });
}

describe("CompanyDto / SesiDto / SesiLogin / CabangDto == bentuk yang dibangun server", () => {
  const sesi = readFileSync(AKAR + SESI, "utf8");
  const cabang = readFileSync(AKAR + CABANG, "utf8");
  const tipe = readFileSync(AKAR + TIPE, "utf8");
  const dibangunCo = kunciCompanyDto(sesi);
  const kontrakCo = medanInterface(tipe, "CompanyDto");
  const dibangunCab = kunciBarisCabang(cabang);
  const kontrakCab = medanInterface(tipe, "CabangDto");

  it("PREMIS: keduanya berisi, sebesar yang diukur lewat HTTP (company 9, cabang 14)", () => {
    expect(dibangunCo.length).toBeGreaterThanOrEqual(9);
    expect(kontrakCo.length).toBeGreaterThanOrEqual(9);
    expect(dibangunCab.length).toBeGreaterThanOrEqual(14);
    expect(kontrakCab.length).toBeGreaterThanOrEqual(14);
    // medan yang lahir dari kolom camelCase — kalau hilang, pengurainya cuma
    // membaca yang namanya sama dengan kolomnya
    expect(dibangunCo).toContain("blokir_jual_minus");
    expect(dibangunCab).toContain("radius_absen_m");
  });

  it("INTI: literal companyDto == CompanyDto (dua arah)", () => {
    expect(dibangunCo.filter((k) => !kontrakCo.includes(k)), "dibangun tapi tak ada di CompanyDto").toEqual([]);
    expect(kontrakCo.filter((k) => !dibangunCo.includes(k)), "di CompanyDto tapi tak pernah dibangun — hantu").toEqual([]);
  });

  it("INTI: literal GET /cabang == CabangDto (dua arah)", () => {
    expect(dibangunCab.filter((k) => !kontrakCab.includes(k)), "dikirim /cabang tapi tak ada di CabangDto").toEqual([]);
    expect(kontrakCab.filter((k) => !dibangunCab.includes(k)), "di CabangDto tapi tak pernah dikirim /cabang — hantu").toEqual([]);
  });

  it("INTI: SATU penulis bentuk company di seluruh apps/server/src — companyDto", () => {
    const sumber: Record<string, string> = {};
    for (const f of berkasTs(AKAR + SERVER_SRC)) {
      if (f.endsWith("/db/schema.ts")) continue;
      sumber[f.slice(AKAR.length)] = readFileSync(f, "utf8");
    }
    expect(Object.keys(sumber).length, "sapuan server tipis").toBeGreaterThan(100);
    const situs = situsPenulisCompany(sumber);
    // Tepat lima: satu per kunci khas, semuanya di companyDto. Penulis kedua
    // (kelas `GET /auth/me` sebelum 2026-09-05) menambah situs di berkas lain.
    expect(situs.map((s) => s.split(":")[0])).toEqual(Array(KUNCI_KHAS_COMPANY.length).fill(SESI));
    expect(situs.map((s) => s.split(":")[2]).sort()).toEqual([...KUNCI_KHAS_COMPANY].sort());
  });

  it("INTI: SesiDto = {user, company, branch}; SesiLogin menambah token saja", () => {
    expect(medanInterface(tipe, "SesiDto")).toEqual(["branch", "company", "user"]);
    expect(medanInterface(tipe, "SesiLogin")).toEqual(["token"]);
    expect(tipe).toMatch(/export interface SesiLogin extends SesiDto \{/);
    expect(medanInterface(tipe, "BranchRingkas")).toEqual(["id", "nama"]);
  });

  it("INTI: web memakai tipe kontrak, bukan salinan — AuthState = SesiLogin, Cabang = CabangDto", () => {
    const api = butaKomentar(readFileSync(AKAR + WEB_API, "utf8"));
    expect(api).toMatch(/^export type AuthState = SesiLogin;/m);
    expect(api).not.toMatch(/interface AuthState\b/);
    const bc = butaKomentar(readFileSync(AKAR + WEB_CABANG, "utf8"));
    expect(bc).toMatch(/^export type Cabang = CabangDto;/m);
    expect(bc).not.toMatch(/interface Cabang\b/);
  });

  it("PASANGAN: pengurainya menuduh — kunci karangan di literal, medan karangan di kontrak, penulis kedua", () => {
    const sesiTambah = sesi.replace(/(export function companyDto[^{]*\{\s*return \{)/, "$1\n    kunci_karangan: 1,");
    expect(kunciCompanyDto(sesiTambah)).toContain("kunci_karangan");
    const sesiKomentar = sesi.replace(/(export function companyDto[^{]*\{\s*return \{)/, "$1\n    // hantu_komentar: 1,");
    expect(kunciCompanyDto(sesiKomentar)).not.toContain("hantu_komentar");
    const cabTambah = cabang.replace("rows.map((r): CabangDto => ({", "rows.map((r): CabangDto => ({\n        kunci_karangan: 1,");
    expect(kunciBarisCabang(cabTambah)).toContain("kunci_karangan");
    const tipeTambah = tipe.replace("export interface CabangDto {", "export interface CabangDto {\n  medan_karangan: string;");
    expect(medanInterface(tipeTambah, "CabangDto")).toContain("medan_karangan");
    // penulis kedua di berkas lain tertuduh; skema zod dan komentar tidak
    const situs = situsPenulisCompany({
      "a.ts": "const x = {\n  pb1_enabled: co.pb1Enabled,\n  logo_url: null,\n};",
      "b.ts": "z.object({\n  pb1_enabled: z.boolean(),\n})\n// pb1_rate: 0,",
    });
    expect(situs).toEqual(["a.ts:2:pb1_enabled", "a.ts:3:logo_url"]);
  });
});

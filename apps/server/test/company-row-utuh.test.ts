import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { butaKomentar } from "../src/scripts/buta-komentar";
import { kunciObjek, medanInterface } from "./kunci-sumber";

/**
 * `CompanyRow` == BENTUK YANG DIBANGUN `companyRow`, DAN WEB BERHENTI
 * MENGETIKNYA ULANG TIGA KALI.
 *
 * `GET /company` memulangkan baris tabel apa adanya — camelCase, dan `[any]`,
 * jadi kasir pun menerimanya utuh (terukur 2026-09-06: kuncinya identik dengan
 * owner). Bentuknya tak pernah dideklarasikan di kontrak, dan akibatnya
 * BERLIPAT:
 *
 *  - web mengetiknya ulang TIGA kali dengan pilihan medan yang berbeda-beda —
 *    `Company` (15, PerusahaanPage), `CompanyStruk` (6, ReceiptModal),
 *    `CompanyMode` (1, useCompanyMode);
 *  - di berkas yang sama, `CabangStruk` mengetik ulang bentuk `/cabang` yang
 *    SUDAH punya `CabangDto` sejak 2026-09-05 — deklarasi keempat untuk
 *    balasan yang tipenya sudah ada;
 *  - ponsel mencatat lima kunci camelCase-nya sebagai hantu dan sengaja
 *    membaca DUA ejaan (`json['logoUrl'] ?? json['logo_url']`);
 *  - dan verify-api §273 — lengan yang ADA untuk memaku bentuk ini — memakai
 *    `has($k)` atas 18 nama: SEARAH. Ia menangkap kunci yang dicabut, tak
 *    pernah yang ditambah, dan EMPAT kunci (`alamat`, `telepon`, `logoUrl`,
 *    `planExpiresAt`) sudah masuk tanpa satu asersi pun berubah warna.
 *
 * Yang dijaga di sini: literal `companyRow` == `CompanyRow` dua arah; ia satu-
 * satunya perakit; stempel waktunya DIPETAKAN (kontrak menyebut `string`,
 * Drizzle memulangkan `Date`); dan web memakai tipe kontrak, bukan salinan.
 * Lengan HTTP-nya §273 yang kini dua arah.
 */
const AKAR = fileURLToPath(new URL("../../../", import.meta.url));
const RUTE = "apps/server/src/modules/company/routes.ts";
const TIPE = "packages/shared/src/types.ts";
const SERVER_SRC = "apps/server/src";
const WEB = [
  "apps/web/src/pages/pengaturan/PerusahaanPage.tsx",
  "apps/web/src/pages/kasir/ReceiptModal.tsx",
  "apps/web/src/lib/useCompanyMode.ts",
];

/** Kunci literal `return {…}` di `companyRow`. */
export function kunciCompanyRow(src: string): string[] {
  const buta = butaKomentar(src);
  const fn = buta.indexOf("export function companyRow(");
  if (fn < 0) throw new Error("`export function companyRow(` tak ditemukan");
  const ret = buta.indexOf("return {", fn);
  if (ret < 0) throw new Error("`return {` companyRow tak ditemukan");
  return kunciObjek(buta, buta.indexOf("{", ret)).sort();
}

/** Situs yang merakit bentuk ini sendiri: `mode: modeDariPlan(` di luar penulisnya. */
export function situsPerakitCompany(sumber: Record<string, string>): string[] {
  const keluar: string[] = [];
  for (const [berkas, mentah] of Object.entries(sumber)) {
    const buta = butaKomentar(mentah);
    for (const m of buta.matchAll(/mode: modeDariPlan\(/g)) {
      keluar.push(`${berkas}:${buta.slice(0, m.index).split("\n").length}`);
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

describe("CompanyRow == bentuk yang dibangun companyRow", () => {
  const rute = readFileSync(AKAR + RUTE, "utf8");
  const tipe = readFileSync(AKAR + TIPE, "utf8");
  const dibangun = kunciCompanyRow(rute);
  const kontrak = medanInterface(tipe, "CompanyRow");

  it("PREMIS: sebesar yang diukur lewat HTTP (22 kunci) — 21 kolom + mode", () => {
    expect(dibangun.length).toBe(22);
    expect(kontrak.length).toBe(22);
    // Keempat kunci yang MASUK tanpa terlihat §273 — kalau salah satu lenyap
    // dari kontrak lagi, uji ini menyebut namanya.
    for (const k of ["alamat", "telepon", "logoUrl", "planExpiresAt"]) {
      expect(kontrak, `${k} — kunci yang dulu menyelinap masuk`).toContain(k);
    }
    expect(kontrak).toContain("mode");
  });

  it("INTI: literal companyRow == CompanyRow (dua arah)", () => {
    expect(dibangun.filter((k) => !kontrak.includes(k)), "dibangun tapi tak ada di CompanyRow").toEqual([]);
    expect(kontrak.filter((k) => !dibangun.includes(k)), "di CompanyRow tapi tak pernah dibangun — hantu").toEqual([]);
  });

  it("INTI: stempel waktu DIPETAKAN, bukan diserahkan ke serialisasi", () => {
    const buta = butaKomentar(rute);
    expect(buta).toMatch(/createdAt: iso\(row\.createdAt\),/);
    expect(buta).toMatch(/updatedAt: iso\(row\.updatedAt\),/);
    expect(buta).toMatch(/planExpiresAt: row\.planExpiresAt === null \? null : iso\(row\.planExpiresAt\),/);
  });

  it("INTI: SATU perakit — `mode: modeDariPlan(` hanya di companyRow", () => {
    const sumber: Record<string, string> = {};
    for (const f of berkasTs(AKAR + SERVER_SRC)) sumber[f.slice(AKAR.length)] = readFileSync(f, "utf8");
    expect(Object.keys(sumber).length, "sapuan server tipis").toBeGreaterThan(100);
    const situs = situsPerakitCompany(sumber);
    expect(situs.length, "bentuk company dirakit di lebih dari satu tempat").toBe(1);
    expect(situs[0].startsWith(RUTE), `perakitnya bukan companyRow: ${situs[0]}`).toBe(true);
  });

  it("INTI: web memakai tipe kontrak — tak satu pun dari tiga salinannya tersisa", () => {
    for (const w of WEB) {
      const buta = butaKomentar(readFileSync(AKAR + w, "utf8"));
      expect(buta, `${w} masih mendeklarasikan bentuk company sendiri`).not.toMatch(
        /interface (Company|CompanyStruk|CompanyMode)\b/,
      );
      expect(buta, `${w} tak menyebut CompanyRow`).toMatch(/CompanyRow/);
    }
    // …dan `CabangStruk` berhenti mengulang bentuk yang sudah punya CabangDto.
    const rm = butaKomentar(readFileSync(AKAR + WEB[1], "utf8"));
    expect(rm).not.toMatch(/interface CabangStruk\b/);
    expect(rm).toMatch(/type CabangStruk = Pick<\s*CabangDto,/);
  });

  it("PASANGAN: pengurainya menuduh — kunci karangan, komentar, perakit kedua", () => {
    const tambah = rute.replace("return {\n    id: row.id,", "return {\n    kunci_karangan: 1,\n    id: row.id,");
    expect(kunciCompanyRow(tambah)).toContain("kunci_karangan");
    const komentar = rute.replace("return {\n    id: row.id,", "return {\n    // hantu_komentar: 1,\n    id: row.id,");
    expect(kunciCompanyRow(komentar)).not.toContain("hantu_komentar");
    const tipeTambah = tipe.replace("export interface CompanyRow {", "export interface CompanyRow {\n  medan_karangan: string;");
    expect(medanInterface(tipeTambah, "CompanyRow")).toContain("medan_karangan");
    expect(situsPerakitCompany({ "a.ts": "x({\n  mode: modeDariPlan(p),\n});" })).toEqual(["a.ts:2"]);
    expect(situsPerakitCompany({ "b.ts": "// mode: modeDariPlan(p)," })).toEqual([]);
  });
});

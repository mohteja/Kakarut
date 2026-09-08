import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { butaKomentar } from "../src/scripts/buta-komentar";
import { kunciObjek, medanInterface } from "./kunci-sumber";

/**
 * BENTUK STRUK == YANG DIBANGUN `strukPenjualan`, DAN BIAYA TAK BOCOR LEWAT POST.
 *
 * Tiga pintu memulangkan bentuk ini: `POST /penjualan` (201, kasir-saja),
 * `GET /penjualan/:id` (cetak ulang), dan perintah `penjualan` di `POST
 * /sync`. Sampai 2026-09-05 hanya YANG KEDUA yang merakit bentuknya sendiri
 * dan menahan biaya; dua lainnya menyebar baris Drizzle mentah dari
 * `createSale`. Terukur lewat HTTP pada SATU transaksi yang sama:
 *
 *   POST /penjualan  kasir → totalHpp 4000, hppSatuan 2000
 *   GET  /:id        kasir → totalHpp null, hppSatuan null
 *   GET  /:id        owner → totalHpp 4000, hppSatuan 2000
 *
 * Yang dijaga di sini, diurai dari sumbernya: literal `strukPenjualan` ==
 * `SaleRow`/`SaleItemRow`/`SaleResult` dua arah; ia SATU-SATUNYA perakit
 * bentuk itu; ketiga pemanggilnya melewatkan gerbang biaya dan tak satu pun
 * dengan `true` harfiah; web tak mendeklarasikan ulang; dan — arah balik yang
 * selama ini luput karena kuncinya camelCase — tiap kunci yang diurai
 * `SaleRow.fromJson`/`SaleItemRow.fromJson` di ponsel ADA di kontrak.
 * Lengan HTTP-nya verify-api §298.
 */
const AKAR = fileURLToPath(new URL("../../../", import.meta.url));
const STRUK = "apps/server/src/modules/penjualan/struk.ts";
const RUTE = "apps/server/src/modules/penjualan/routes.ts";
const SYNC = "apps/server/src/modules/sync/routes.ts";
const TIPE = "packages/shared/src/types.ts";
const WEB = "apps/web/src/pages/kasir/ReceiptModal.tsx";
const SERVER_SRC = "apps/server/src";

/** Kunci literal `const baris: SaleRow = {…}` di `strukPenjualan`. */
export function kunciSaleRow(src: string): string[] {
  const buta = butaKomentar(src);
  const i = buta.indexOf("const baris: SaleRow = {");
  if (i < 0) throw new Error("`const baris: SaleRow = {` tak ditemukan di struk.ts");
  return kunciObjek(buta, buta.indexOf("{", i)).sort();
}

/** Kunci literal baris item — `items.map((it): SaleItemRow => ({…}))`. */
export function kunciSaleItemRow(src: string): string[] {
  const buta = butaKomentar(src);
  const m = /items\.map\(\(it\): SaleItemRow => \(\{/.exec(buta);
  if (!m) throw new Error("`items.map((it): SaleItemRow => ({` tak ditemukan di struk.ts");
  return kunciObjek(buta, m.index + m[0].length - 1).sort();
}

/** Kunci literal `return { sale, items, … }` — bentuk atas `SaleResult`. */
export function kunciSaleResult(src: string): string[] {
  const buta = butaKomentar(src);
  const i = buta.indexOf("  return {\n    sale: baris,");
  if (i < 0) throw new Error("literal balasan `return { sale: baris, …` tak ditemukan di struk.ts");
  return kunciObjek(buta, buta.indexOf("{", i)).sort();
}

/**
 * Situs yang MERAKIT bentuk struk sendiri: properti `sale:` di kedalaman
 * literal objek, di luar `struk.ts`. Buta komentar; `sale: baris` milik
 * penulisnya sendiri tak dihitung sebab berkasnya dikecualikan pemanggil.
 */
export function situsPerakitStruk(sumber: Record<string, string>): string[] {
  const keluar: string[] = [];
  for (const [berkas, mentah] of Object.entries(sumber)) {
    const buta = butaKomentar(mentah);
    for (const m of buta.matchAll(/^\s+sale:(?!\s*baris\b)/gm)) {
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

describe("SaleRow / SaleItemRow / SaleResult == bentuk yang dibangun strukPenjualan", () => {
  const struk = readFileSync(AKAR + STRUK, "utf8");
  const tipe = readFileSync(AKAR + TIPE, "utf8");
  const rute = readFileSync(AKAR + RUTE, "utf8");
  const sync = readFileSync(AKAR + SYNC, "utf8");
  const dibangunSale = kunciSaleRow(struk);
  const kontrakSale = medanInterface(tipe, "SaleRow");
  const dibangunItem = kunciSaleItemRow(struk);
  const kontrakItem = medanInterface(tipe, "SaleItemRow");

  it("PREMIS: sebesar yang diukur lewat HTTP — sale 30, item 16, atas 4", () => {
    expect(dibangunSale.length).toBe(30);
    expect(kontrakSale.length).toBe(30);
    expect(dibangunItem.length).toBe(16);
    expect(kontrakItem.length).toBe(16);
    expect(kunciSaleResult(struk)).toEqual(["branch_nama", "items", "kasir", "sale"]);
    expect(medanInterface(tipe, "SaleResult")).toEqual(["branch_nama", "items", "kasir", "sale"]);
  });

  it("INTI: literal == SaleRow dan SaleItemRow, dua arah", () => {
    expect(dibangunSale.filter((k) => !kontrakSale.includes(k)), "dibangun tapi tak ada di SaleRow").toEqual([]);
    expect(kontrakSale.filter((k) => !dibangunSale.includes(k)), "di SaleRow tapi tak pernah dibangun — hantu").toEqual([]);
    expect(dibangunItem.filter((k) => !kontrakItem.includes(k)), "dibangun tapi tak ada di SaleItemRow").toEqual([]);
    expect(kontrakItem.filter((k) => !dibangunItem.includes(k)), "di SaleItemRow tapi tak pernah dibangun — hantu").toEqual([]);
  });

  it("INTI: SATU perakit bentuk struk di seluruh apps/server/src", () => {
    const sumber: Record<string, string> = {};
    for (const f of berkasTs(AKAR + SERVER_SRC)) {
      if (f.endsWith("/penjualan/struk.ts")) continue; // penulisnya sendiri
      sumber[f.slice(AKAR.length)] = readFileSync(f, "utf8");
    }
    expect(Object.keys(sumber).length, "sapuan server tipis").toBeGreaterThan(100);
    expect(
      situsPerakitStruk(sumber),
      "merakit `sale:` sendiri di luar `strukPenjualan` — kelas yang membuat POST & GET menjawab berbeda untuk transaksi yang sama",
    ).toEqual([]);
  });

  it("INTI: ketiga pemanggil melewatkan gerbang biaya, tak satu pun `true` harfiah", () => {
    for (const [nama, src] of [["routes.ts", rute], ["sync/routes.ts", sync]] as const) {
      const buta = butaKomentar(src);
      const panggil = [...buta.matchAll(/strukPenjualan\(/g)];
      expect(panggil.length, `${nama} tak memanggil strukPenjualan`).toBeGreaterThan(0);
      expect(buta, `${nama}: gerbang biaya tak dioper`).toMatch(/bolehLihatBiaya\(auth\.role\),/);
      expect(buta, `${nama}: gerbang biaya dilangkahi dengan literal`).not.toMatch(/strukPenjualan\([\s\S]{0,400}?\btrue,?\s*\)/);
    }
    // POST + GET di routes.ts, sync 1× → tiga pintu, tiga panggilan
    expect([...butaKomentar(rute).matchAll(/strukPenjualan\(/g)].length).toBe(2);
    expect([...butaKomentar(sync).matchAll(/strukPenjualan\(/g)].length).toBe(1);
    // …dan penulisnya memang menihilkan, bukan sekadar menerima parameternya
    expect(butaKomentar(struk)).toMatch(/totalHpp: lihatBiaya \? sale\.totalHpp : null,/);
    expect(butaKomentar(struk)).toMatch(/hppSatuan: lihatBiaya \? it\.hppSatuan : null,/);
  });

  it("INTI: web memakai tipe kontrak, bukan salinan", () => {
    const web = butaKomentar(readFileSync(AKAR + WEB, "utf8"));
    expect(web).not.toMatch(/interface SaleResult\b/);
    expect(web).toMatch(/^export type SaleResult = SaleResultDto;/m);
  });

  it("KELAS: tiap kunci yang diurai ponsel dari struk ADA di kontrak — bila repo ponsel ada", () => {
    let dart: string;
    try {
      dart = readFileSync(fileURLToPath(new URL("../../../../kakarut-mobile/lib/features/kasir/kasir_models.dart", import.meta.url)), "utf8");
    } catch {
      return; // CI repo ini tak men-checkout ponsel → lewati, bukan merah
    }
    const buta = butaKomentar(dart);
    const kunciDart = (kelas: string): string[] => {
      const i = buta.indexOf(`factory ${kelas}.fromJson`);
      if (i < 0) throw new Error(`${kelas}.fromJson tak ditemukan — bentuk ponsel berubah?`);
      const akhir = buta.indexOf("\n  );", i);
      return [...buta.slice(i, akhir).matchAll(/j(?:son)?\[\s*'([a-zA-Z_][a-zA-Z0-9_]*)'\s*\]/g)].map((m) => m[1]).sort();
    };
    const dibacaSale = kunciDart("SaleRow");
    const dibacaItem = kunciDart("SaleItemRow");
    // Premis: pengurainya memulangkan sebanyak yang terukur (19 dan 8).
    expect(dibacaSale.length, "SaleRow.fromJson terbaca terlalu tipis").toBeGreaterThanOrEqual(19);
    expect(dibacaItem.length, "SaleItemRow.fromJson terbaca terlalu tipis").toBeGreaterThanOrEqual(8);
    expect(
      dibacaSale.filter((k) => !kontrakSale.includes(k)),
      "ponsel mengurai kunci `sale` yang tak ada di SaleRow — null selamanya (kelas `asal_cabang`)",
    ).toEqual([]);
    expect(
      dibacaItem.filter((k) => !kontrakItem.includes(k)),
      "ponsel mengurai kunci baris yang tak ada di SaleItemRow",
    ).toEqual([]);
  });

  it("PASANGAN: pengurainya menuduh — kunci karangan, komentar, perakit kedua, gerbang harfiah", () => {
    const tambah = struk.replace("const baris: SaleRow = {", "const baris: SaleRow = {\n    kunci_karangan: 1,");
    expect(kunciSaleRow(tambah)).toContain("kunci_karangan");
    const komentar = struk.replace("const baris: SaleRow = {", "const baris: SaleRow = {\n    // hantu_komentar: 1,");
    expect(kunciSaleRow(komentar)).not.toContain("hantu_komentar");
    const tipeTambah = tipe.replace("export interface SaleRow {", "export interface SaleRow {\n  medan_karangan: string;");
    expect(medanInterface(tipeTambah, "SaleRow")).toContain("medan_karangan");
    // perakit kedua tertuduh; `sale: baris` milik penulisnya sendiri tidak
    expect(situsPerakitStruk({ "a.ts": "return c.json({\n      sale: row,\n      items,\n    });" })).toEqual(["a.ts:2"]);
    expect(situsPerakitStruk({ "b.ts": "  return {\n    sale: baris,\n  };" })).toEqual([]);
    expect(situsPerakitStruk({ "c.ts": "// sale: row," })).toEqual([]);
  });
});

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { butaKomentar } from "../src/scripts/buta-komentar";
import { kunciObjek, medanInterface } from "./kunci-sumber";

/**
 * `StokMasukRow` DI SHARED == BARIS YANG BENAR-BENAR DIBANGUN `ambilBarisFaktur`.
 *
 * Sampai 2026-09-05 tipe baris pengadaan hidup sebagai DTO LOKAL halaman web
 * (`TambahStokPage.tsx`), jadi Lampiran A dan fikstur kunci ponsel tak pernah
 * melihatnya. Terukur lewat HTTP terhadap DB gerbang (237 baris, 2 rute): 55
 * kunci per baris, 52 dideklarasikan — `harga_tebakan`, `pengadaan`, dan
 * `qty_setara` dikirim tanpa pernah dideklarasikan (yang terakhir saudara
 * `qty_teks`, yang sudah pernah tersandung hal yang sama). Ponsel membaca 40
 * kunci plus SATU yang tak pernah dikirim siapa pun (`asal_cabang`).
 *
 * Yang dijaga di sini: kunci `select` + pengayaan (`return { ...r, … }`) di
 * `ambilBarisFaktur` SAMA PERSIS dengan medan interface `StokMasukRow` di
 * `packages/shared/src/types.ts` — dua arah, diurai dari sumbernya. Medan baru
 * di kueri yang tak masuk kontrak memerahkan gerbang ini sebelum ter-push;
 * medan kontrak yang berhenti dikirim juga. Lengan HTTP-nya verify-api §295.
 */
const AKAR = fileURLToPath(new URL("../../../", import.meta.url));
const RUTE = "apps/server/src/modules/produksi/routes.ts";
const TIPE = "packages/shared/src/types.ts";

/** Kunci yang dibangun `ambilBarisFaktur`: `const select = {…}` + pengayaan `return { ...r, … }`. */
export function kunciBarisFaktur(src: string): string[] {
  const buta = butaKomentar(src);
  const fn = buta.indexOf("async function ambilBarisFaktur(");
  if (fn < 0) throw new Error("ambilBarisFaktur tak ditemukan");
  // batas fungsi: sampai `return rowsRak;` (akhir badan) — cukup untuk kedua blok
  const akhir = buta.indexOf("return rowsRak;", fn);
  if (akhir < 0) throw new Error("`return rowsRak;` tak ditemukan — badan ambilBarisFaktur berubah bentuk");
  const badan = buta.slice(fn, akhir);
  const sel = badan.indexOf("const select = {");
  if (sel < 0) throw new Error("`const select = {` tak ditemukan");
  const dariSelect = kunciObjek(badan, badan.indexOf("{", sel));
  const ret = badan.lastIndexOf("return {");
  if (ret < 0) throw new Error("pengayaan `return {` tak ditemukan");
  const dariPengayaan = kunciObjek(badan, badan.indexOf("{", ret));
  return [...new Set([...dariSelect, ...dariPengayaan])].sort();
}

describe("StokMasukRow == baris yang dibangun ambilBarisFaktur", () => {
  const rute = readFileSync(AKAR + RUTE, "utf8");
  const tipe = readFileSync(AKAR + TIPE, "utf8");
  const dibangun = kunciBarisFaktur(rute);
  const kontrak = medanInterface(tipe, "StokMasukRow");

  it("PREMIS: keduanya berisi, dan sebesar yang diukur lewat HTTP (55)", () => {
    expect(dibangun.length).toBeGreaterThanOrEqual(50);
    expect(kontrak.length).toBeGreaterThanOrEqual(50);
    // kunci yang lahir dari PENGAYAAN, bukan select — kalau hilang, pengurainya
    // hanya membaca separuh
    for (const k of ["qty_teks", "qty_setara", "batch", "batch_teks", "default_tempat"]) {
      expect(dibangun, `${k} tak terbaca dari pengayaan`).toContain(k);
    }
    // …dan kunci yang lahir dari select (join)
    expect(dibangun).toContain("supplier_bahan_telepon");
    expect(dibangun).toContain("harga_tebakan");
  });

  it("INTI: tiap kunci yang dibangun ADA di kontrak", () => {
    const takDideklarasikan = dibangun.filter((k) => !kontrak.includes(k));
    expect(
      takDideklarasikan,
      "dikirim server tapi tak ada di `StokMasukRow` (packages/shared) — kelas `qty_teks`: klien tak bisa melihatnya, lalu merakit ulang sendiri",
    ).toEqual([]);
  });

  it("INTI: tiap medan kontrak benar-benar DIBANGUN", () => {
    const hantu = kontrak.filter((k) => !dibangun.includes(k));
    expect(
      hantu,
      "ada di `StokMasukRow` tapi tak pernah dibangun `ambilBarisFaktur` — medan hantu yang klien baca sebagai null selamanya",
    ).toEqual([]);
  });

  it("PASANGAN: pengurainya menuduh — kunci karangan di select, dan medan karangan di kontrak", () => {
    const ruteTambah = rute.replace("const select = {", "const select = {\n    kunci_karangan: productions.id,");
    expect(kunciBarisFaktur(ruteTambah)).toContain("kunci_karangan");
    const tipeTambah = tipe.replace("export interface StokMasukRow {", "export interface StokMasukRow {\n  medan_karangan: string;");
    expect(medanInterface(tipeTambah, "StokMasukRow")).toContain("medan_karangan");
    // kunci di dalam komentar TIDAK ikut
    const ruteKomentar = rute.replace("const select = {", "const select = {\n    // hantu_komentar: productions.id,");
    expect(kunciBarisFaktur(ruteKomentar)).not.toContain("hantu_komentar");
  });
});

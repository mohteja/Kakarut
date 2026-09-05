import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { butaKomentar } from "../src/scripts/buta-komentar";
import { kunciObjek, medanInterface } from "./kunci-sumber";

/**
 * `BepResult` & `NilaiStokRingkas` DI types.ts == BENTUK YANG DIBANGUN SERVER
 * — dan satu kelas baru: "sudah di shared" ≠ "terlihat kontrak".
 *
 * Terukur lewat HTTP 2026-09-05: `/laporan/bep` 8 kunci (web mendeklarasikan
 * 7 — `periode` dikirim tanpa dideklarasikan; ponsel membaca 6 — tanpa
 * `basis`, padahal web menampilkannya sebagai "Basis perhitungan");
 * `/stok/nilai` 5 kunci, dan `NilaiStokRingkas` SUDAH diekspor shared — dari
 * `nilai-stok.ts`, bukan `types.ts`. Pembangkit fikstur kunci ponsel dan
 * Lampiran A hanya membaca `types.ts`, jadi kelima kuncinya tercatat ponsel
 * sebagai hantu bertahun-tahun "meski ada di shared". Dari 25-an tipe yang
 * diekspor shared di luar `types.ts`, itu satu-satunya bentuk KAWAT yang
 * dibaca ponsel — sisanya rumus/cetak/nilai turunan.
 *
 * Yang dijaga: literal `const hasil: BepResult = {…}` di `GET /laporan/bep` ==
 * medan `BepResult`; literal `const r: NilaiStokRingkas = {…}` di
 * `ringkasNilaiStok` == medan `NilaiStokRingkas` (keduanya dua arah, dari
 * `types.ts`); `nilai-stok.ts` tak lagi mendeklarasikan interface-nya; web
 * tak mengetik ulang `BepResult`; dan — arah balik kelas barunya — tak satu
 * pun entri `hantuDiketahui` ponsel bernama medan yang dideklarasikan berkas
 * shared MANA PUN (bila repo ponsel ada di sebelah). Lengan HTTP: §297.
 */
const AKAR = fileURLToPath(new URL("../../../", import.meta.url));
const LAPORAN = "apps/server/src/modules/laporan/routes.ts";
const NILAI = "packages/shared/src/nilai-stok.ts";
const TIPE = "packages/shared/src/types.ts";
const WEB_LAPORAN = "apps/web/src/pages/laporan/LaporanPage.tsx";
const SHARED_SRC = "packages/shared/src";

/** Kunci literal `const hasil: BepResult = {…}` di handler `/bep`. */
export function kunciHasilBep(src: string): string[] {
  const buta = butaKomentar(src);
  const h = buta.indexOf('.get("/bep"');
  if (h < 0) throw new Error('`.get("/bep"` tak ditemukan');
  const lit = buta.indexOf("const hasil: BepResult = {", h);
  if (lit < 0) throw new Error("`const hasil: BepResult = {` tak ditemukan di handler /bep");
  return kunciObjek(buta, buta.indexOf("{", lit)).sort();
}

/** Kunci literal `const r: NilaiStokRingkas = {…}` di `ringkasNilaiStok`. */
export function kunciRingkasNilai(src: string): string[] {
  const buta = butaKomentar(src);
  const lit = buta.indexOf("const r: NilaiStokRingkas = {");
  if (lit < 0) throw new Error("`const r: NilaiStokRingkas = {` tak ditemukan di nilai-stok.ts");
  return kunciObjek(buta, buta.indexOf("{", lit)).sort();
}

/** Nama medan tiap `export interface` di sebuah sumber shared (buta komentar). */
export function medanSemuaInterface(src: string): Set<string> {
  const buta = butaKomentar(src);
  const keluar = new Set<string>();
  for (const m of buta.matchAll(/export interface (\w+)/g)) {
    for (const k of medanInterface(buta, m[1])) keluar.add(k);
  }
  return keluar;
}

/**
 * Kunci `hantuDiketahui` di uji ponsel. Jangkarnya ada di REPO SEBELAH, jadi
 * `jangkar-iris.test.ts` (yang hanya menelusuri sumber repo ini) tak bisa
 * memverifikasinya — maka bukan `indexOf` yang diam-diam memulangkan -1,
 * melainkan regex yang MELEMPAR bila petanya tak ditemukan: kelas kegagalan
 * senyap yang uji meta itu jaga tak berlaku di sini.
 */
export function kunciHantuDiketahui(dart: string): string[] {
  const m = /const hantuDiketahui = <String, String>\{([\s\S]*?)\n\};/.exec(dart);
  if (!m) throw new Error("peta `hantuDiketahui` tak ditemukan di kunci_hantu_test.dart — bentuknya berubah?");
  return [...m[1].matchAll(/^\s+'([a-z0-9_]+)':\s*'/gm)].map((x) => x[1]).sort();
}

describe("BepResult / NilaiStokRingkas == bentuk yang dibangun; shared di luar types.ts tak menyembunyikan kunci kawat", () => {
  const laporan = readFileSync(AKAR + LAPORAN, "utf8");
  const nilai = readFileSync(AKAR + NILAI, "utf8");
  const tipe = readFileSync(AKAR + TIPE, "utf8");
  const bepDibangun = kunciHasilBep(laporan);
  const bepKontrak = medanInterface(tipe, "BepResult");
  const nilaiDibangun = kunciRingkasNilai(nilai);
  const nilaiKontrak = medanInterface(tipe, "NilaiStokRingkas");

  it("PREMIS: sebesar yang diukur lewat HTTP — bep 8, nilai 5", () => {
    expect(bepDibangun.length).toBeGreaterThanOrEqual(8);
    expect(bepKontrak.length).toBeGreaterThanOrEqual(8);
    expect(nilaiDibangun.length).toBeGreaterThanOrEqual(5);
    expect(nilaiKontrak.length).toBeGreaterThanOrEqual(5);
    expect(bepDibangun).toContain("periode");
    expect(bepKontrak).toContain("basis");
  });

  it("INTI: literal /bep == BepResult (dua arah); basis bertipe BasisBep bernama (masuk fikstur status)", () => {
    expect(bepDibangun.filter((k) => !bepKontrak.includes(k)), "dikirim /bep tapi tak ada di BepResult").toEqual([]);
    expect(bepKontrak.filter((k) => !bepDibangun.includes(k)), "di BepResult tapi tak pernah dibangun — hantu").toEqual([]);
    expect(butaKomentar(tipe)).toMatch(/export type BasisBep = "penjualan" \| "katalog";/);
    expect(butaKomentar(tipe)).toMatch(/^\s+basis: BasisBep;/m);
  });

  it("INTI: literal ringkasNilaiStok == NilaiStokRingkas (dua arah), interface-nya di types.ts saja", () => {
    expect(nilaiDibangun.filter((k) => !nilaiKontrak.includes(k))).toEqual([]);
    expect(nilaiKontrak.filter((k) => !nilaiDibangun.includes(k))).toEqual([]);
    expect(butaKomentar(nilai), "nilai-stok.ts mendeklarasikan ulang interface kawatnya").not.toMatch(/export interface NilaiStokRingkas\b/);
    expect(butaKomentar(nilai)).toMatch(/import type \{ NilaiStokRingkas \} from "\.\/types";/);
  });

  it("INTI: web memakai BepResult dari kontrak, bukan salinan", () => {
    const web = butaKomentar(readFileSync(AKAR + WEB_LAPORAN, "utf8"));
    expect(web).not.toMatch(/interface BepResult\b/);
    expect(web).toMatch(/import type \{[^}]*\bBepResult\b[^}]*\} from "@kakarut\/shared";/);
  });

  it("KELAS: tak satu pun `hantuDiketahui` ponsel bernama medan yang dideklarasikan berkas shared MANA PUN — bila repo ponsel ada", () => {
    let dart: string;
    try {
      dart = readFileSync(fileURLToPath(new URL("../../../../kakarut-mobile/test/kunci_hantu_test.dart", import.meta.url)), "utf8");
    } catch {
      return; // CI repo ini tak men-checkout ponsel → lewati, bukan merah
    }
    const hantu = kunciHantuDiketahui(dart);
    expect(hantu.length, "hantuDiketahui terbaca terlalu tipis").toBeGreaterThan(15);
    // SELURUH shared, types.ts termasuk: nama yang di types.ts sudah ada di
    // fikstur (ratchet Dart menagihnya di sana), yang di berkas lain tak
    // terlihat siapa pun — dua-duanya salah tempat di `hantuDiketahui`, dan
    // memasukkan types.ts membuat bukti merahnya bisa mendarat di sini.
    const berkas = readdirSync(AKAR + SHARED_SRC).filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts"));
    const dideklarasikan = new Map<string, string[]>();
    for (const n of berkas) {
      for (const k of medanSemuaInterface(readFileSync(`${AKAR}${SHARED_SRC}/${n}`, "utf8"))) {
        dideklarasikan.set(k, [...(dideklarasikan.get(k) ?? []), n]);
      }
    }
    // Terukur 2026-09-05: 55 medan di 27 berkas shared selain types.ts, +500-an di types.ts.
    expect(dideklarasikan.size).toBeGreaterThan(400);
    // Sapuan ini berkunci NAMA. Dua nama di bawah memang dideklarasikan shared —
    // di bentuk MASUKAN klien (struk `ReceiptData`, bon `BonData`, aritmetika
    // refund `UangPenjualan`), bukan balasan HTTP — sementara ponsel membacanya
    // dari balasan `POST /penjualan` yang DTO-nya (`SaleResult`) masih lokal
    // web (antrean). Tabrakannya nyata, tersembunyinya tidak. Tiap entri di
    // sini diratchet: harus MASIH hantu di ponsel dan MASIH bertabrakan —
    // begitu `SaleResult` masuk types.ts, keduanya wajib dicabut.
    const TABRAKAN_NAMA: Record<string, string> = {
      diskon: "ReceiptData/BonData/UangPenjualan (masukan klien) ≠ sale.diskon dari POST /penjualan (SaleResult lokal web)",
      subtotal: "ReceiptData/BonData/UangPenjualan (masukan klien) ≠ sale.subtotal dari POST /penjualan (SaleResult lokal web)",
    };
    for (const k of Object.keys(TABRAKAN_NAMA)) {
      expect(hantu, `TABRAKAN_NAMA basi: ${k} tak lagi hantu di ponsel — cabut`).toContain(k);
      expect(dideklarasikan.has(k), `TABRAKAN_NAMA basi: ${k} tak lagi dideklarasikan shared — cabut`).toBe(true);
    }
    const tersembunyi = hantu
      .filter((k) => dideklarasikan.has(k) && !(k in TABRAKAN_NAMA))
      .map((k) => `${k} ← ${dideklarasikan.get(k)!.join(", ")}`);
    expect(
      tersembunyi,
      "tercatat ponsel sebagai hantu padahal DIDEKLARASIKAN shared — di types.ts (sudah di fikstur: cabut entrinya) atau di berkas lain (tak terlihat fikstur & Lampiran A; kelas NilaiStokRingkas: pindahkan interface-nya ke types.ts), atau catat tabrakan namanya beralasan",
    ).toEqual([]);
  });

  it("PASANGAN: pengurainya menuduh — literal, kontrak, dan hantu yang tersembunyi", () => {
    const lapTambah = laporan.replace("const hasil: BepResult = {", "const hasil: BepResult = {\n      kunci_karangan: 1,");
    expect(kunciHasilBep(lapTambah)).toContain("kunci_karangan");
    const lapKomentar = laporan.replace("const hasil: BepResult = {", "const hasil: BepResult = {\n      // hantu_komentar: 1,");
    expect(kunciHasilBep(lapKomentar)).not.toContain("hantu_komentar");
    const nilaiTambah = nilai.replace("const r: NilaiStokRingkas = {", "const r: NilaiStokRingkas = {\n    kunci_karangan: 0,");
    expect(kunciRingkasNilai(nilaiTambah)).toContain("kunci_karangan");
    const tipeTambah = tipe.replace("export interface BepResult {", "export interface BepResult {\n  medan_karangan: string;");
    expect(medanInterface(tipeTambah, "BepResult")).toContain("medan_karangan");
    // sapuan semua-interface melihat berkas selain types.ts, dan buta komentar
    const s = medanSemuaInterface("export interface A {\n  x_a: number;\n}\n/* export interface B {\n  x_b: number;\n} */\nexport interface C {\n  x_c?: string;\n}\n");
    expect([...s].sort()).toEqual(["x_a", "x_c"]);
    // pengurai hantuDiketahui membaca entri, bukan komentar di dalamnya
    expect(kunciHantuDiketahui("const hantuDiketahui = <String, String>{\n  // 'di_komentar': 'x',\n  'sungguhan': 'alasan',\n};\n")).toEqual(["sungguhan"]);
  });
});

import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { butaKomentar } from "../src/scripts/buta-komentar";
import { kunciObjek, medanInterface } from "./kunci-sumber";

/**
 * `KaryawanRow` == BENTUK YANG DIBANGUN `karyawanRow`, DAN TIGA SALINAN WEB
 * BERHENTI MENGETIKNYA ULANG.
 *
 * `GET /karyawan` adalah rute INTI modulnya, dan sampai 2026-09-10 ia
 * satu-satunya bentuk di modul itu yang tak ada di kontrak. Tetangganya sudah
 * lama di sana — `UndanganKaryawanRow`, `AktivitasRow`, `KaryawanTempatDto`,
 * 17 kunci di fikstur ponsel — sementara barisnya sendiri NOL. Kelas yang sama
 * dengan #96 ("sudah di shared" ≠ "terlihat kontrak") dan #99.
 *
 * YANG DIUKUR, dan angkanya yang membuat berkas ini ada. Kunci ke-10 yang
 * disuntikkan ke `select` rutenya pada 2026-09-10 lolos:
 *
 *   · `npm run typecheck`            — hijau
 *   · `npm test`                     — 3.087 uji, hijau
 *   · `bash scripts/verify-api.sh`   — 3.620 lengan, hijau
 *
 * Nol penjaga berubah warna. Ini LEBIH buruk daripada temuan #99, tempat §273
 * setidaknya memaku 18 dari 22 kunci (searah); di sini yang memaku 0 dari 9.
 *
 * Sementara itu web mengetik bentuk yang sama TIGA kali dengan lebar
 * berbeda-beda — 9 medan (`Karyawan`, KaryawanPage), 7 (`KaryawanRow`,
 * PenyimpananPage), 4 (`Karyawan`, TambahStokDariMenuPage) — dan ponsel
 * merawat cerminnya dengan tangan (`karyawan_models.dart`, yang komentarnya
 * sendiri berbunyi "cermin GET /karyawan").
 *
 * Anotasi kontraknya langsung menemukan ketidakcocokan nyata, persis seperti
 * `planExpiresAt` di #99: `archived_at` kolomnya `timestamp` (Drizzle
 * menyimpulkan `Date | null`) sementara yang sampai ke kawat ISO string
 * (terukur: `"2026-09-10T06:29:33.540Z"`). Sebelum putaran ini tak ada tipe
 * mana pun yang menyatakan itu — jadi tak ada yang bisa salah, dan tak ada
 * yang bisa benar.
 */
const AKAR = fileURLToPath(new URL("../../../", import.meta.url));
const RUTE = "apps/server/src/modules/users/routes.ts";
const TIPE = "packages/shared/src/types.ts";
const KONSTAN = "packages/shared/src/constants.ts";
const SERVER_SRC = "apps/server/src";
const WEB_SRC = "apps/web/src";
const WEB = [
  "apps/web/src/pages/pengaturan/KaryawanPage.tsx",
  "apps/web/src/pages/pengaturan/PenyimpananPage.tsx",
  "apps/web/src/pages/stok/TambahStokDariMenuPage.tsx",
];

/** Kunci literal `return {…}` di sebuah `export function <nama>(`. */
export function kunciPerakit(src: string, nama: string): string[] {
  const buta = butaKomentar(src);
  const fn = buta.indexOf(`export function ${nama}(`);
  if (fn < 0) throw new Error(`\`export function ${nama}(\` tak ditemukan`);
  const ret = buta.indexOf("return {", fn);
  if (ret < 0) throw new Error(`\`return {\` ${nama} tak ditemukan`);
  return kunciObjek(buta, buta.indexOf("{", ret)).sort();
}

/**
 * Situs yang MENGEJA union peran dengan tangan, di luar rumahnya.
 *
 * Aturannya sudah punya rumah sejak lama (`UserRole` di `constants.ts`) — yang
 * tak pernah ada gerbangnya. Terukur 2026-09-10: TIGA ejaan, dan dua di
 * antaranya (`FormState.role` di web, `SyncAuth.role` di server) hidup
 * bertahun-tahun di sebelah impor `@kakarut/shared` yang sudah ada di
 * berkasnya sendiri.
 */
export function situsUnionPeran(sumber: Record<string, string>): string[] {
  const pola = /"owner"\s*\|\s*"admin"\s*\|\s*"cashier"\s*\|\s*"tim"\s*\|\s*"kitchen"\s*\|\s*"bar"/g;
  const keluar: string[] = [];
  for (const [berkas, mentah] of Object.entries(sumber)) {
    const buta = butaKomentar(mentah);
    for (const m of buta.matchAll(pola)) {
      keluar.push(`${berkas}:${buta.slice(0, m.index).split("\n").length}`);
    }
  }
  return keluar.sort();
}

function berkasSumber(dir: string, ekor: string[]): string[] {
  return readdirSync(dir).flatMap((n) => {
    if (n === "node_modules" || n === "dist") return [];
    const jalur = `${dir}/${n}`;
    if (statSync(jalur).isDirectory()) return berkasSumber(jalur, ekor);
    return ekor.some((e) => n.endsWith(e)) ? [jalur] : [];
  });
}

describe("KaryawanRow == bentuk yang dibangun karyawanRow", () => {
  const rute = readFileSync(AKAR + RUTE, "utf8");
  const tipe = readFileSync(AKAR + TIPE, "utf8");
  const dibangun = kunciPerakit(rute, "karyawanRow");
  const kontrak = medanInterface(tipe, "KaryawanRow");

  it("PREMIS: sebesar yang diukur lewat HTTP — 9 kunci", () => {
    // Uji yang kehilangan bahannya lulus tanpa memeriksa apa pun.
    expect(dibangun.length, "perakitnya bukan lagi 9 kunci").toBe(9);
    expect(kontrak.length, "kontraknya bukan lagi 9 medan").toBe(9);
    // Dua kunci yang HANYA dipunyai salinan terlebar — kalau bentuk kontraknya
    // kelak menyempit ke salinan yang lebih sempit, uji ini menyebut namanya.
    for (const k of ["employee_code", "archived_at"]) {
      expect(kontrak, `${k} — kunci yang dua dari tiga salinan web lupakan`).toContain(k);
    }
  });

  it("INTI: literal karyawanRow == KaryawanRow (dua arah)", () => {
    expect(
      dibangun.filter((k) => !kontrak.includes(k)),
      "dibangun tapi tak ada di KaryawanRow",
    ).toEqual([]);
    expect(
      kontrak.filter((k) => !dibangun.includes(k)),
      "ada di KaryawanRow tapi tak pernah dibangun — hantu",
    ).toEqual([]);
  });

  it("INTI: `archived_at` DIPETAKAN, bukan diserahkan ke serialisasi", () => {
    /*
     * Inilah asersi yang membuat tipe kontraknya jujur. Kolomnya `Date | null`
     * di Drizzle; kalau baris itu dilewatkan apa adanya, `JSON.stringify`
     * diam-diam menuliskannya ISO — benar di kawat, BOHONG di tipe. Sekali
     * seseorang mengandalkan tipenya (mis. `.getTime()`), ia meledak saat
     * jalan.
     */
    const buta = butaKomentar(rute);
    expect(buta).toMatch(
      /archived_at: row\.archived_at === null \? null : row\.archived_at\.toISOString\(\),/,
    );
    // …dan rutenya berhenti memulangkan hasil select apa adanya.
    expect(buta, "handler masih memulangkan baris mentah").not.toMatch(/return c\.json\(rows\);/);
    expect(buta).toMatch(/return c\.json\(rows\.map\(karyawanRow\)\);/);
  });

  it("INTI: balasan 201 `POST /karyawan` == KaryawanBaruResult (dua arah)", () => {
    const hasil = medanInterface(tipe, "KaryawanBaruResult");
    expect(hasil.length, "kontrak KaryawanBaruResult terbaca terlalu tipis").toBe(5);
    const buta = butaKomentar(rute);
    const i = buta.indexOf("return { user_id: user.id,");
    expect(i, "literal balasan POST tak ditemukan").toBeGreaterThan(0);
    const dibangunPost = kunciObjek(buta, buta.indexOf("{", i)).sort();
    expect(
      dibangunPost.filter((k) => !hasil.includes(k)),
      "dibangun tapi tak ada di KaryawanBaruResult",
    ).toEqual([]);
    expect(
      hasil.filter((k) => !dibangunPost.includes(k)),
      "ada di KaryawanBaruResult tapi tak pernah dibangun — hantu",
    ).toEqual([]);
    // Bentuknya dinyatakan, bukan disimpulkan dari literalnya.
    expect(buta).toContain("let result: KaryawanBaruResult | undefined;");
  });

  it("INTI: web memakai tipe kontrak — ketiga salinannya lenyap", () => {
    for (const w of WEB) {
      const buta = butaKomentar(readFileSync(AKAR + w, "utf8"));
      expect(buta, `${w} masih mendeklarasikan bentuk karyawan sendiri`).not.toMatch(
        /interface (Karyawan|KaryawanRow)\s*\{/,
      );
      expect(buta, `${w} tak menyebut KaryawanRow`).toMatch(/KaryawanRow/);
    }
    // Dua pemakai sempit menyatakan pilihannya lewat `Pick`, bukan menyalin.
    expect(butaKomentar(readFileSync(AKAR + WEB[1], "utf8"))).toMatch(
      /type PetugasRow = Pick<\s*KaryawanRow,/,
    );
    expect(butaKomentar(readFileSync(AKAR + WEB[2], "utf8"))).toMatch(
      /type PelaksanaRow = Pick<KaryawanRow,/,
    );
  });

  it("INTI: union peran dieja SATU kali, di rumahnya", () => {
    const sumber: Record<string, string> = {};
    for (const f of [
      ...berkasSumber(AKAR + SERVER_SRC, [".ts"]),
      ...berkasSumber(AKAR + WEB_SRC, [".ts", ".tsx"]),
      AKAR + TIPE,
      AKAR + KONSTAN,
    ]) {
      sumber[f.slice(AKAR.length)] = readFileSync(f, "utf8");
    }
    expect(Object.keys(sumber).length, "sapuannya tipis").toBeGreaterThan(200);
    const situs = situsUnionPeran(sumber);
    expect(
      situs,
      "union peran dieja di luar `UserRole`. Peran ketujuh kelak ditambahkan di " +
        "satu tempat dan tidak di yang lain, tanpa suara",
    ).toEqual([expect.stringContaining(KONSTAN)]);
  });

  it("PASANGAN: pengurainya menuduh — kunci karangan, komentar, ejaan kedua", () => {
    const tambah = rute.replace(
      "return {\n    user_id: row.user_id,",
      "return {\n    kunci_karangan: 1,\n    user_id: row.user_id,",
    );
    expect(kunciPerakit(tambah, "karyawanRow")).toContain("kunci_karangan");
    const komentar = rute.replace(
      "return {\n    user_id: row.user_id,",
      "return {\n    // hantu_komentar: 1,\n    user_id: row.user_id,",
    );
    expect(kunciPerakit(komentar, "karyawanRow")).not.toContain("hantu_komentar");
    const tipeTambah = tipe.replace(
      "export interface KaryawanRow {",
      "export interface KaryawanRow {\n  medan_karangan: string;",
    );
    expect(medanInterface(tipeTambah, "KaryawanRow")).toContain("medan_karangan");
    // Pemindai union peran: menuduh ejaan kedua, dan TIDAK menuduh komentar.
    expect(
      situsUnionPeran({
        "a.ts": 'type X = {\n  role: "owner" | "admin" | "cashier" | "tim" | "kitchen" | "bar";\n};',
      }),
    ).toEqual(["a.ts:2"]);
    expect(
      situsUnionPeran({
        "b.ts": '// role: "owner" | "admin" | "cashier" | "tim" | "kitchen" | "bar"',
      }),
    ).toEqual([]);
    // …dan urutan/spasi yang berbeda TETAP tertangkap (ejaan kedua jarang identik).
    expect(
      situsUnionPeran({ "c.ts": 'r: "owner"|"admin"|"cashier"|"tim"|"kitchen"|"bar";' }),
    ).toEqual(["c.ts:1"]);
  });
});

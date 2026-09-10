import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { butaKomentar } from "../src/scripts/buta-komentar";
import { kunciObjek, medanInterface } from "./kunci-sumber";

/**
 * SATU BENTUK DAFTAR INDUK, SATU PERAKIT — dan `dipakai` yang dijanjikan tipe
 * tapi tak pernah dikirim.
 *
 * `{id, nama, sort_order}` adalah bentuk balasan TIGA modul sekaligus:
 * `/kategori`, `/kategori-bahan`, dan jalur tulis `/satuan`. Sampai 2026-09-10
 * ia tak punya perakit sama sekali — diketik ulang dengan tangan di
 * **sembilan** situs (kategori 3, kategori-bahan 4, satuan 2), plus satu
 * varian berkunci empat di `GET /satuan`. Kesepuluhnya bertahan hanya karena
 * kebetulan sama.
 *
 * TERUKUR, dan angkanya yang membuat berkas ini ada. Satu kunci ke-4 yang
 * disuntikkan ke `GET /kategori` lolos `typecheck`, lolos **3.097 uji**, dan
 * lolos **3.633 lengan verify-api** — nol penjaga berubah warna. Kelas persis
 * yang sama dengan vena #101 sehari sebelumnya, di modul yang lain.
 *
 * DUA TEMUAN yang muncul justru saat bentuknya ditelusuri, bukan dibaca:
 *
 *  1. **`KategoriDto` SUDAH ada di kontrak** dan komentarnya berbunyi
 *     "Kategori menu (master data)" — tapi LIMA pemanggil web memakainya untuk
 *     `GET /kategori-bahan`, sementara `GET /kategori`, rute yang tipe itu
 *     dinamai untuknya, dibaca lewat TIGA salinan lokal. Keduanya lolos hanya
 *     karena kedua bentuknya identik hari ini. "Tipenya ada" ≠ "tipenya
 *     dipakai di tempat ia dinamai".
 *
 *  2. **`SatuanDto` berbohong tentang balasan tulis.** Ia mendeklarasikan
 *     `dipakai: number`, dan `SatuanSelect.tsx` sudah mengetik balasan `POST`
 *     sebagai `SatuanDto` — sementara servernya memulangkan TIGA kunci.
 *     Terukur dari kawat: `POST /satuan` → `["id","nama","sort_order"]`,
 *     `has("dipakai")` = **false**. Yang menahannya dari jadi bug cuma
 *     kebetulan bahwa satu-satunya pembacanya `.nama`. Diperbaiki dari sisi
 *     SERVER — ketiga metode kini mengirim bentuk yang sama — bukan dengan
 *     memperlemah tipenya.
 */
const AKAR = fileURLToPath(new URL("../../../", import.meta.url));
const RUMAH = "apps/server/src/lib/baris-master.ts";
const TIPE = "packages/shared/src/types.ts";
const SERVER_SRC = "apps/server/src";
const MODUL = [
  "apps/server/src/modules/kategori/routes.ts",
  "apps/server/src/modules/kategori-bahan/routes.ts",
  "apps/server/src/modules/satuan/routes.ts",
];
const WEB = [
  "apps/web/src/pages/kasir/KasirPage.tsx",
  "apps/web/src/pages/menu/LihatMenuPage.tsx",
  "apps/web/src/pages/menu/MenuFormPage.tsx",
];

/** Kunci literal `return {…}` di sebuah `export function <nama>(`. */
export function kunciPerakit(src: string, nama: string): string[] {
  const buta = butaKomentar(src);
  const fn = buta.indexOf(`export function ${nama}(`);
  if (fn < 0) throw new Error(`\`export function ${nama}(\` tak ditemukan`);
  const ret = buta.indexOf("return ", fn);
  const kurung = buta.indexOf("{", ret);
  if (kurung < 0) throw new Error(`literal balasan ${nama} tak ditemukan`);
  return kunciObjek(buta, kurung).sort();
}

/** `{` pembuka literal yang MELINGKUPI posisi `pos`. */
function pembukaMelingkupi(s: string, pos: number): number {
  let d = 0;
  for (let k = pos; k >= 0; k--) {
    if (s[k] === "}") d++;
    else if (s[k] === "{") {
      if (d === 0) return k;
      d--;
    }
  }
  return -1;
}

/**
 * Situs yang MERAKIT bentuk daftar induk dengan tangan.
 *
 * Berkunci pada BENTUKNYA, bukan pada namanya — dan itu yang membuat sapuan
 * ini bisa dipercaya. Sapuan yang cuma mencari teks `sort_order:` ikut menuduh
 * `menu/service.ts`, tempat `sort_order` satu dari sembilan belas kunci
 * `MenuDto`; kelas `TABRAKAN_NAMA` yang sudah dua kali menggigit repo ini
 * (#99, #100). Karena itu literalnya diurai dan hanya dituduh bila kuncinya
 * PERSIS ketiga itu.
 */
export function situsPerakitTangan(sumber: Record<string, string>): string[] {
  const keluar: string[] = [];
  for (const [berkas, mentah] of Object.entries(sumber)) {
    const buta = butaKomentar(mentah);
    for (const m of buta.matchAll(/sort_order:\s*[A-Za-z_][A-Za-z0-9_]*\.sortOrder/g)) {
      const b = pembukaMelingkupi(buta, m.index!);
      if (b < 0) continue;
      const ks = kunciObjek(buta, b).sort();
      if (ks.length === 3 && ks.join(",") === "id,nama,sort_order") {
        keluar.push(`${berkas}:${buta.slice(0, m.index).split("\n").length}`);
      }
    }
  }
  return keluar.sort();
}

function berkasTs(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    if (n === "node_modules" || n === "dist") return [];
    const jalur = `${dir}/${n}`;
    if (statSync(jalur).isDirectory()) return berkasTs(jalur);
    return jalur.endsWith(".ts") ? [jalur] : [];
  });
}

describe("baris daftar induk: satu bentuk, satu perakit", () => {
  const rumah = readFileSync(AKAR + RUMAH, "utf8");
  const tipe = readFileSync(AKAR + TIPE, "utf8");

  it("PREMIS: rumah bersama ada dan ketiga pembantunya diekspor", () => {
    const buta = butaKomentar(rumah);
    // `async` diterima: `hitungDipakai` menembak kueri, dua saudaranya murni.
    // Percobaan pertama uji ini mematok `export function` harfiah dan merah —
    // penjaganya benar, asersinya yang terlalu sempit.
    for (const f of ["barisMaster", "barisSatuan", "hitungDipakai"]) {
      expect(buta, `pembantu ${f} tak diekspor dari rumah bersamanya`).toMatch(
        new RegExp(`export (?:async )?function ${f}\\(`),
      );
    }
  });

  it("INTI: literal barisMaster == KategoriDto (dua arah)", () => {
    const dibangun = kunciPerakit(rumah, "barisMaster");
    const kontrak = medanInterface(tipe, "KategoriDto");
    expect(kontrak.length, "kontrak KategoriDto terbaca terlalu tipis").toBe(3);
    expect(dibangun.filter((k) => !kontrak.includes(k)), "dibangun tapi tak di KategoriDto").toEqual([]);
    expect(kontrak.filter((k) => !dibangun.includes(k)), "di KategoriDto tapi tak dibangun").toEqual([]);
  });

  it("INTI: barisSatuan == SatuanDto, dan `dipakai` medan KEEMPATNYA", () => {
    const kontrak = medanInterface(tipe, "SatuanDto");
    expect(kontrak.sort()).toEqual(["dipakai", "id", "nama", "sort_order"]);
    const buta = butaKomentar(rumah);
    // Ia MENYEBAR `barisMaster` — jadi ketiga kunci dasarnya tak bisa
    // menyimpang dari saudaranya tanpa memerahkan uji di atas.
    expect(buta).toMatch(/return \{ \.\.\.barisMaster\(row\), dipakai \};/);
  });

  it("INTI: nol situs merakit bentuk itu dengan tangan (di luar rumahnya)", () => {
    const sumber: Record<string, string> = {};
    for (const f of berkasTs(AKAR + SERVER_SRC)) sumber[f.slice(AKAR.length)] = readFileSync(f, "utf8");
    expect(Object.keys(sumber).length, "sapuan server tipis").toBeGreaterThan(100);
    const situs = situsPerakitTangan(sumber);
    expect(
      situs,
      "bentuk daftar induk dirakit di luar `barisMaster`. Terukur 2026-09-10: " +
        "sembilan situs bertahan bertahun-tahun hanya karena kebetulan sama",
    ).toEqual([expect.stringContaining(RUMAH)]);
  });

  it("INTI: ketiga modul memanggil rumah bersama", () => {
    for (const m of MODUL) {
      const buta = butaKomentar(readFileSync(AKAR + m, "utf8"));
      expect(buta, `${m} tak memakai perakit bersama`).toMatch(/baris(Master|Satuan)\(/);
    }
    // …dan jalur TULIS `/satuan` memakai `barisSatuan`, bukan `barisMaster`:
    // itulah perbaikan yang menghapus kebohongan `dipakai`.
    const sat = butaKomentar(readFileSync(AKAR + MODUL[2], "utf8"));
    expect(
      (sat.match(/barisSatuan\(/g) ?? []).length,
      "GET + POST + PATCH /satuan harus KETIGANYA memulangkan bentuk yang sama",
    ).toBe(3);
    expect(sat, "jalur tulis /satuan tak menghitung `dipakai`").toMatch(/hitungDipakai\(/);
  });

  it("INTI: web memakai KategoriDto untuk /kategori — ketiga salinannya lenyap", () => {
    for (const w of WEB) {
      const buta = butaKomentar(readFileSync(AKAR + w, "utf8"));
      expect(buta, `${w} masih mendeklarasikan bentuk kategori sendiri`).not.toMatch(
        /interface Kategori\s*\{/,
      );
      expect(buta, `${w} tak menyebut KategoriDto`).toMatch(/KategoriDto/);
    }
    // Dan rute yang tipe itu DINAMAI untuknya kini benar-benar memakainya.
    const semua = WEB.map((w) => butaKomentar(readFileSync(AKAR + w, "utf8"))).join("\n");
    expect(semua).toMatch(/api<KategoriDto\[\]>\("\/kategori"\)/);
  });

  it("PASANGAN: pemindainya menuduh — dan TIDAK menuduh tabrakan nama", () => {
    // Bentuk yang SUNGGUH ada di repo ini sampai 2026-09-10:
    expect(
      situsPerakitTangan({
        "a.ts": "return c.json(\n  rows.map((r) => ({ id: r.id, nama: r.nama, sort_order: r.sortOrder })),\n);",
      }),
    ).toEqual(["a.ts:2"]);
    // …dan bentuk sesudah diperbaiki tidak tertuduh.
    expect(situsPerakitTangan({ "b.ts": "rows.map(barisMaster)" })).toEqual([]);
    // TABRAKAN NAMA: `MenuDto` juga punya `sort_order: menu.sortOrder`, dan
    // sapuan berbasis teks akan menuduhnya. Yang di sini tidak, sebab kuncinya
    // lebih dari tiga. Ini yang membedakan penjaga dari derau.
    expect(
      situsPerakitTangan({
        "c.ts": "return {\n  id: menu.id,\n  nama: menu.nama,\n  harga_jual: menu.hargaJual,\n  sort_order: menu.sortOrder,\n};",
      }),
    ).toEqual([]);
    // …dan komentar tak dihitung.
    expect(
      situsPerakitTangan({ "d.ts": "// { id: r.id, nama: r.nama, sort_order: r.sortOrder }" }),
    ).toEqual([]);
    // Pengurai kontrak menuduh medan karangan.
    const tipeTambah = tipe.replace(
      "export interface KategoriDto {",
      "export interface KategoriDto {\n  medan_karangan: string;",
    );
    expect(medanInterface(tipeTambah, "KategoriDto")).toContain("medan_karangan");
  });
});

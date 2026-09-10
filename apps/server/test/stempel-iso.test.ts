import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { barisDi, jelajah, namaProperti, uraikan, type Simpul } from "./util/ast";
import { berkasKode, SRV } from "./util/rute";
import { stempelBukanIso } from "./util/adu-tipe-kawat";
import { iso } from "../src/lib/time";

/**
 * STEMPEL WAKTU PUNYA SATU EJAAN, DAN `String(Date)` BUKAN SALAH SATUNYA.
 *
 * Kolom `timestamp` Drizzle memulangkan `Date`; kontrak menyebut `string`.
 * `c.json` KEBETULAN menuliskannya ISO lewat `JSON.stringify`, jadi kelalaian
 * di sini tak selalu terlihat — dan justru itu yang membuatnya bertahan.
 *
 * Ledger ini mencatat kelas "timestamp → ISO" LIMA putaran berturut-turut
 * (`planExpiresAt` #99, `archived_at` #101, `waktu` penerimaan #106, `waktu`
 * dana #107, `waktu` menggantung #110), dan tiap kali yang menemukannya
 * ANOTASI, tak sekali pun sapuan. Butir antreannya berbunyi: *"yang belum ada:
 * aturan mekanis 'kolom timestamp yang sampai ke c.json wajib lewat
 * toISOString()' — menuntut informasi tipe, bukan regex."*
 *
 * Berkas ini aturan itu, dan ia TIDAK menuntut informasi tipe: nama kolom
 * `timestamp` dibaca dari `schema.ts`, lalu `String(<nama itu>)` dituduh.
 * Sempit, dan itu disengaja — yang lebar dijaga dari KAWAT (§310), tempat
 * bentuk salahnya benar-benar terlihat.
 *
 * Yang ditemukan saat aturan ini pertama dijalankan: `/penerimaan/riwayat`
 * mengirim `"Thu Sep 10 2026 14:37:32 GMT+0000 (Coordinated Universal Time)"`,
 * dan MEMBANDINGKAN teks itu untuk memilih "keputusan terakhir" — urutan
 * leksikografis atas nama hari, sehingga faktur yang tahap terakhirnya jatuh
 * Jumat memajang stempel Kamis.
 */
const AKAR = fileURLToPath(new URL("../../../", import.meta.url));

/** Nama properti & kolom `timestamp` (mode Date) di `schema.ts`. */
export function namaStempel(skema: string): Set<string> {
  const out = new Set<string>();
  for (const m of skema.matchAll(/(\w+):\s*timestamp\(\s*"([^"]+)"([^)]*)\)/g)) {
    if (/mode:\s*"string"/.test(m[3])) continue; // mode string memang sudah teks
    out.add(m[1]);
    out.add(m[2]);
  }
  return out;
}

/** Situs `String(<sesuatu bernama stempel>)`, sebagai `berkas:baris`. */
export function situsStringStempel(sumber: Record<string, string>, nama: Set<string>): string[] {
  const keluar: string[] = [];
  for (const [berkas, isi] of Object.entries(sumber)) {
    let akar: Simpul;
    try {
      akar = uraikan(berkas, isi);
    } catch {
      continue;
    }
    jelajah(akar, (n) => {
      if (n.type !== "CallExpression") return;
      const cal = n.callee as Simpul | undefined;
      if (cal?.type !== "Identifier" || cal.name !== "String") return;
      const a = (n.arguments ?? [])[0] as Simpul | undefined;
      if (!a) return;
      const nm = a.type === "Identifier" ? (a.name as string) : namaProperti(a);
      if (nm && nama.has(nm)) keluar.push(`${berkas}:${barisDi(isi, n.start)}  String(…${nm})`);
    });
  }
  return keluar.sort();
}

const skema = readFileSync(AKAR + "apps/server/src/db/schema.ts", "utf8");
const nama = namaStempel(skema);
const sumber: Record<string, string> = {};
for (const f of berkasKode(SRV, /\.ts$/)) sumber[f.slice(AKAR.length)] = readFileSync(f, "utf8");

describe("`String(Date)` tak punya jalan ke balasan", () => {
  it("PREMIS: nama kolom stempelnya terbaca, dan sumbernya tersapu", () => {
    // Himpunan kosong = aturan yang tak bisa menuduh siapa pun.
    expect(nama.size, "tak ada kolom timestamp terbaca — regex skemanya rusak").toBeGreaterThan(20);
    expect(nama.has("waktu")).toBe(true);
    expect(nama.has("createdAt")).toBe(true);
    expect(Object.keys(sumber).length).toBeGreaterThan(80);
  });

  it("INTI: nol situs `String(<kolom timestamp>)`", () => {
    const situs = situsStringStempel(sumber, nama);
    expect(
      situs,
      "`String(new Date())` memulangkan \"Thu Sep 10 2026 14:37:32 GMT+0000 (…)\", " +
        "BUKAN ISO-8601 — `DateTime.tryParse` Dart memulangkan null untuknya, dan " +
        "membandingkannya sebagai teks mengurutkan menurut NAMA HARI. Pakai " +
        "`iso()` dari `lib/time`:\n" + situs.join("\n"),
    ).toEqual([]);
  });

  it("PASANGAN: pemindainya menuduh — dan tak menuduh nama yang bukan stempel", () => {
    expect(situsStringStempel({ "u.ts": "const x = String(r.waktu);" }, nama)).toEqual([
      "u.ts:1  String(…waktu)",
    ]);
    expect(situsStringStempel({ "u.ts": "const x = String(waktu);" }, nama).length).toBe(1);
    // nama yang BUKAN kolom timestamp tak dituduh…
    expect(situsStringStempel({ "u.ts": "const x = String(r.nama);" }, nama)).toEqual([]);
    // …dan komentar tidak dibaca (pengurainya pohon sintaks, bukan teks)
    expect(situsStringStempel({ "u.ts": "// String(r.waktu)" }, nama)).toEqual([]);
  });
});

describe("`iso()` punya SATU rumah", () => {
  it("INTI: tak ada salinan `function iso(` di luar `lib/time.ts`", () => {
    /*
     * Sampai 2026-09-11 ada DUA salinan identik byte per byte
     * (`company/routes.ts`, `penjualan/struk.ts`) plus bentuk
     * `x instanceof Date ? x.toISOString() : String(x)` yang ditulis ulang
     * per situs. Satu bentuk dengan banyak penulis adalah cara salah satunya
     * menyimpang tanpa suara — dan di sini salah satunya memang sudah.
     */
    const salinan = Object.entries(sumber)
      .filter(([berkas, isi]) => !berkas.endsWith("lib/time.ts") && /function iso\s*\(/.test(isi))
      .map(([berkas]) => berkas)
      .sort();
    expect(salinan, `salinan \`iso()\` di luar rumahnya:\n${salinan.join("\n")}`).toEqual([]);
    expect(sumber["apps/server/src/lib/time.ts"]).toContain("export function iso(");
  });

  it("perilakunya: Date → ISO, teks diteruskan apa adanya", () => {
    expect(iso(new Date("2026-09-10T14:37:32.000Z"))).toBe("2026-09-10T14:37:32.000Z");
    expect(iso("2026-09-10")).toBe("2026-09-10");
    // …dan yang dihindarinya, ditulis supaya bedanya tak perlu diingat
    expect(String(new Date("2026-09-10T14:37:32.000Z"))).not.toMatch(/^2026-09-10T/);
  });

  it("urutan: ISO bisa dibandingkan sebagai teks, keluaran toString TIDAK", () => {
    // Ini inti cacatnya, bukan sekadar soal format: Jumat 11 lebih akhir dari
    // Kamis 10, tapi "Fri Sep 11" < "Thu Sep 10" secara leksikografis.
    const kamis = new Date("2026-09-10T14:00:00Z");
    const jumat = new Date("2026-09-11T14:00:00Z");
    expect(jumat > kamis).toBe(true);
    expect(iso(jumat) > iso(kamis)).toBe(true);
    expect(String(jumat) > String(kamis)).toBe(false);
  });
});

describe("pemindai stempel di kawat (§310) sempit dengan sengaja", () => {
  it("menuduh keluaran Date.toString & toLocaleString", () => {
    expect(stempelBukanIso("Thu Sep 10 2026 14:37:32 GMT+0000 (Coordinated Universal Time)")).toBe(true);
    expect(stempelBukanIso("9/10/2026, 2:37:32 PM")).toBe(true);
  });

  it("TIDAK menuduh ISO, tanggal saja, atau teks biasa", () => {
    for (const t of [
      "2026-09-10T14:37:32.000Z",
      "2026-09-10T14:37:32+07:00",
      "2026-09-10",
      "Ayam Goreng",
      "5",
      "PB-2026-0001",
      "08:00",
    ]) {
      expect(stempelBukanIso(t), `${t} tertuduh padahal bukan stempel salah bentuk`).toBe(false);
    }
  });
});

import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `count()` TIBA SEBAGAI STRING — dan idiom yang mencegahnya tak pernah ditagih.
 *
 * `db/client.ts` mendaftarkan SATU parser: `pg.types.setTypeParser(1700, …)`
 * untuk `numeric`. OID 20 (`int8`/`bigint`) tidak didaftarkan, dan `count()` di
 * Postgres SELALU bigint. Diukur dari basis data sungguhan (2026-09-11):
 *
 *     count(*)        -> "14"  string
 *     count(*)::int   ->  14   number
 *     count(*) + 1    -> "141"          ← bukan 15
 *     count(*) === 0  -> false          ← walau nolnya benar
 *
 * Repo ini sudah tahu: **66 dari 98** ekspresi `count()` di SQL mentah memakai
 * `::int`, dan `audit-invarian.ts` menganotasi hasilnya `string | number` lalu
 * membungkusnya `Number()`. Jadi aturannya ADA — sebagai kebiasaan. Yang tak
 * ada: sesuatu yang menagihnya. `count(*)` baru tanpa cast lolos typecheck
 * (assertion `as { n: number }` membungkamnya), lolos unit test, dan lolos
 * gerbang kawat bila rutenya kebetulan di luar sapuan §309/§311.
 *
 * Satu bukti bahwa itu bukan kekhawatiran: `sampah/routes.ts` MENGETIK hasil
 * hitungnya `number` lewat assertion sementara runtime memberi string; yang
 * menyelamatkannya `Number()` di baris pulang, bukan tipenya.
 *
 * `sum()` sengaja TIDAK dijaga di sini, dan itu terukur: `sum(numeric)` adalah
 * numeric (sudah diparse), dan sapuan atas seluruh kolom `integer` di skema
 * hidup menemukan **NOL** situs `sum()` atas kolom integer.
 */
const AKAR = fileURLToPath(new URL("../src", import.meta.url));

/**
 * Berkas yang dikecualikan — dengan sebab, sebab daftar tanpa alasan adalah
 * cara gerbang ini berhenti berarti.
 */
const KECUALI: Record<string, string> = {
  "scripts/audit-invarian.ts":
    "Ke-26 kueri di sini MENGHITUNG BARIS YANG MELANGGAR, dan hasilnya dibaca satu " +
    "jalur tunggal yang sudah menganotasi `string | number` lalu membungkus `Number()`. " +
    "Menambahkan `::int` ke 26 literal untuk hal yang sudah benar menambah ritual, " +
    "bukan keamanan — yang menjaganya di sini satu baris, dan uji di bawah memakunya.",
};

/** (baris, isi) tiap literal string/template — komentar diabaikan. */
export function literalSumber(teks: string): { baris: number; isi: string }[] {
  const keluar: { baris: number; isi: string }[] = [];
  let i = 0;
  const n = teks.length;
  while (i < n) {
    const c = teks[i];
    if (c === "/" && teks[i + 1] === "/") {
      const j = teks.indexOf("\n", i);
      i = j < 0 ? n : j;
      continue;
    }
    if (c === "/" && teks[i + 1] === "*") {
      const j = teks.indexOf("*/", i);
      i = j < 0 ? n : j + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      let dalam = 0;
      while (j < n) {
        const d = teks[j];
        if (d === "\\") { j += 2; continue; }
        if (c === "`" && d === "$" && teks[j + 1] === "{") { dalam++; j += 2; continue; }
        if (c === "`" && d === "}" && dalam) { dalam--; j++; continue; }
        if (d === c && !dalam) break;
        if (d === "\n" && c !== "`") break;
        j++;
      }
      keluar.push({
        baris: teks.slice(0, i).split("\n").length,
        isi: teks.slice(i + 1, j),
      });
      i = j + 1;
      continue;
    }
    i++;
  }
  return keluar;
}

/** Apakah ekspresi yang dibuka pada `i` di-cast ke int — termasuk sesudah FILTER(…)? */
export function diCast(sql: string, i: number): boolean {
  const lewati = (dari: number): number => {
    let d = 0;
    for (let j = dari; j < sql.length; j++) {
      if (sql[j] === "(") d++;
      else if (sql[j] === ")" && --d === 0) return j + 1;
    }
    return sql.length;
  };
  let sisa = sql.slice(lewati(i));
  const f = /^\s*filter\s*\(/i.exec(sisa);
  if (f) sisa = sql.slice(lewati(sql.length - sisa.length + f[0].lastIndexOf("(")));
  return /^\s*::\s*(int|integer|int4|smallint|int2)\b/i.test(sisa);
}

/**
 * Apakah nilainya SAMPAI ke JavaScript? `WHERE`/`HAVING` dan ekspresi urutan
 * (`orderBy(desc(sql`count(*)`))`) dihitung Postgres dan tak pernah dibaca.
 */
export function diproyeksikan(teks: string, isi: string, posLiteral: number, posFungsi: number): boolean {
  const klausa = /\b(select|from|where|group\s+by|having|order\s+by|returning)\b/gi;
  let terakhir: string | null = null;
  for (const m of isi.slice(0, posFungsi).matchAll(klausa)) terakhir = m[1].toLowerCase();
  if (terakhir) return /^(select|returning)/.test(terakhir);
  // Potongan tanpa kata klausa: konteks JS-nya yang menjawab.
  // `posLiteral` menunjuk ISI literalnya, jadi ekornya masih memuat tag dan
  // petik pembuka: `…desc(sql\``. Versi pertama menuntut ekornya persis `desc(`
  // dan karena itu tak pernah cocok — pemindainya menuduh `backup.ts` yang benar.
  const sebelum = teks.slice(Math.max(0, posLiteral - 60), posLiteral).replace(/\s+/g, "");
  return !/\b(orderBy|desc|asc|having|where)\((sql(<[^>]*>)?)?[`'"]?$/.test(sebelum);
}

/** `count()` yang nilainya sampai ke JS TANPA `::int`. */
export function hitunganTelanjang(sumber: Record<string, string>): string[] {
  const keluar: string[] = [];
  for (const [berkas, teks] of Object.entries(sumber)) {
    if (berkas in KECUALI) continue;
    let cari = 0;
    for (const { baris, isi } of literalSumber(teks)) {
      const posLiteral = teks.indexOf(isi, cari);
      if (posLiteral >= 0) cari = posLiteral + 1;
      for (const m of isi.matchAll(/\bcount\s*\(/gi)) {
        const i = isi.indexOf("(", m.index!);
        if (diCast(isi, i)) continue;
        if (!diproyeksikan(teks, isi, posLiteral, m.index!)) continue;
        keluar.push(`${berkas}:${baris}`);
      }
    }
  }
  return [...new Set(keluar)].sort();
}

function berkasTs(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    if (n === "node_modules" || n === "dist") return [];
    const jalur = `${dir}/${n}`;
    if (statSync(jalur).isDirectory()) return berkasTs(jalur);
    return jalur.endsWith(".ts") ? [jalur] : [];
  });
}

describe("count() di SQL mentah: hasilnya angka, bukan teks", () => {
  const sumber: Record<string, string> = {};
  for (const f of berkasTs(AKAR)) sumber[f.slice(AKAR.length + 1)] = readFileSync(f, "utf8");

  it("PREMIS: sapuannya melihat sebanyak yang diukur, dan idiomnya memang dipakai", () => {
    expect(Object.keys(sumber).length, "berkas server tersapu terlalu sedikit").toBeGreaterThan(80);
    const semua = Object.values(sumber)
      .flatMap((t) => literalSumber(t))
      .flatMap((l) => [...l.isi.matchAll(/\bcount\s*\(/gi)].map(() => l.isi));
    expect(semua.length, "populasi count() menyusut — sapuannya rusak").toBeGreaterThan(80);
    // Parser `numeric` masih satu-satunya yang terdaftar; kalau kelak OID 20
    // ikut didaftarkan, gerbang ini kehilangan alasannya dan harus dibuang,
    // bukan dibiarkan menegakkan aturan yang tak berlaku lagi.
    const klien = readFileSync(`${AKAR}/db/client.ts`, "utf8");
    expect(klien).toContain("setTypeParser(1700");
    expect(klien, "OID 20 kini terdaftar — uji ini kehilangan sebabnya").not.toMatch(
      /setTypeParser\(\s*20\b/,
    );
  });

  it("INTI: tak ada count() yang nilainya sampai ke JS tanpa `::int`", () => {
    const telanjang = hitunganTelanjang(sumber);
    expect(
      telanjang,
      "`count()` di Postgres adalah bigint, dan `pg` memulangkan bigint sebagai STRING " +
        "(OID 20 tak terdaftar di client.ts). `count(*) + 1` menghasilkan \"141\", bukan 15, " +
        "dan `=== 0` selalu false. Tambahkan `::int` di SQL-nya — 66 situs lain sudah — " +
        "atau daftarkan berkasnya di KECUALI beserta sebabnya:\n" + telanjang.join("\n"),
    ).toEqual([]);
  });

  it("INTI: yang dikecualikan memang masih membayar dengan cara lain", () => {
    const inv = sumber["scripts/audit-invarian.ts"];
    expect(inv, "berkas yang dikecualikan lenyap — cabut entrinya dari KECUALI").toBeTruthy();
    // Sebabnya DIPAKU: satu jalur baca, beranotasi jujur, dibungkus Number().
    expect(inv).toMatch(/const n = Number\(\(hasil\.rows\[0\] as \{ n: string \| number \}\)\.n\);/);
    for (const k of Object.keys(KECUALI)) {
      expect(KECUALI[k].length, `${k} tanpa sebab tertulis`).toBeGreaterThan(80);
    }
  });

  it("PASANGAN: pemindainya menuduh — dan diam pada bentuk yang benar", () => {
    const t = (s: string) => hitunganTelanjang({ "a.ts": s });
    expect(t("const q = sql`SELECT count(*) AS n FROM sales`;")).toEqual(["a.ts:1"]);
    // Bentuk yang benar tak tertuduh.
    expect(t("const q = sql`SELECT count(*)::int AS n FROM sales`;")).toEqual([]);
    // Cast SESUDAH FILTER juga bentuk yang benar — versi pertama pemindai ini
    // menyebutnya telanjang, dan itu keliru.
    expect(t("const q = sql`SELECT count(*) FILTER (WHERE x) ::int AS n FROM s`;")).toEqual([]);
    // Tak diproyeksikan: dihitung Postgres, tak pernah dibaca JS.
    expect(t("const q = sql`SELECT a FROM s GROUP BY a HAVING count(*) > 0`;")).toEqual([]);
    expect(t("const q = sql`SELECT a FROM s WHERE count(*) > 0`;")).toEqual([]);
    // Potongan tanpa kata klausa, dipakai sebagai ekspresi URUTAN.
    expect(t("const q = orderBy(desc(sql`count(*)`));")).toEqual([]);
    // …tapi potongan yang sama sebagai nilai select TETAP tertuduh.
    expect(t("const q = db.select({ n: sql`count(*)` });")).toEqual(["a.ts:1"]);
    // Komentar tak dihitung.
    expect(t("// sql`SELECT count(*) AS n FROM sales`")).toEqual([]);
  });
});

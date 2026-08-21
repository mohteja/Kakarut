import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `sql<number>` ADALAH JANJI YANG DITULIS MANUSIA DAN TAK DIPERIKSA SIAPA PUN.
 *
 * Driver `pg` memulangkan `numeric` sebagai STRING — dan bukan cuma `numeric`.
 * Diukur langsung terhadap Postgres 16 yang dipakai repo ini:
 *
 *     SUM(numeric)   → "3000.75"   string        MAX(integer) → 7    number
 *     SUM(integer)   → "10"        string        MIN(integer) → 3    number
 *     AVG(integer)   → "5.0000…"   string        COUNT(*)     → "2"  string
 *     MAX(numeric)   → "2.50"      string        GREATEST(int,int) → 7  number
 *
 * Tak ada aturan yang bisa dipegang seseorang di kepalanya: hasilnya bergantung
 * pada tipe balikan tiap agregat atas tipe tiap kolom. `MAX` aman, `SUM` tidak,
 * dan keduanya ditulis bersebelahan.
 *
 * Yang membuatnya berbahaya: TypeScript berpihak pada yang salah. `sql<number>`
 * membuat nilainya BERTIPE `number` sementara isinya string, jadi kompilernya
 * justru menjamin sesuatu yang tak benar. Dua akibatnya:
 *
 *   1. `a + b` MERANGKAI, bukan menjumlah — `"3000.75" + "3000.75"` menjadi
 *      `"3000.753000.75"`. Pada jalur uang, itu angka yang salahnya tak
 *      terbatas, dan tak ada galat di mana pun.
 *   2. Nilai yang lolos ke `c.json()` melanggar kontrak API: klien menerima
 *      string di tempat `LaporanHarian` menjanjikan `number`. Di mobile
 *      `j['x'] as num` MELEMPAR dan mematikan layarnya; `as num?` memulangkan
 *      null diam-diam.
 *
 * Hari ini repo ini selamat karena DISIPLIN: tiap pemanggil membungkusnya
 * `Number(...)`. Uji ini memindahkan kebenarannya dari disiplin ke struktur —
 * cast di ekspresinya sendiri, sekali, di tempat yang tak bisa dilupakan
 * pemanggil berikutnya.
 *
 * KENAPA CAST-NYA AMAN. `x::float8` menghasilkan float64 yang BIT-PER-BIT sama
 * dengan `Number("x")` — diuji atas nominal ekstrem (99.999.999,99 dan 0,01)
 * dan seluruh barisnya identik. Jadi cast ini tidak mengubah satu angka pun
 * yang sudah dikirim hari ini; ia cuma membuat tipenya jujur.
 */
const SRC = fileURLToPath(new URL("../src", import.meta.url));

function berkasTs(dir: string): string[] {
  const keluar: string[] = [];
  for (const nama of readdirSync(dir)) {
    const p = join(dir, nama);
    if (statSync(p).isDirectory()) keluar.push(...berkasTs(p));
    else if (nama.endsWith(".ts")) keluar.push(p);
  }
  return keluar;
}

/**
 * Buang KOMENTAR sebelum memindai.
 *
 * Percobaan pertama tidak melakukannya, dan uji ini langsung menuduh dua hal:
 * prosa di `porsi-ditagih.ts` yang MENJELASKAN aturan ini — kalimat yang
 * menyebut `sql<number>` sebagai contoh. Penjaga yang menuduh tulisan lebih
 * buruk daripada tak ada penjaga: ia mengajari orang mengabaikannya, dan
 * dokumentasi yang bagus jadi hal yang membuat CI merah.
 *
 * Dibuang dengan hati-hati: blok `/* … *​/` seluruhnya, tapi `//` HANYA saat ia
 * mengawali barisnya. `//` di tengah baris bisa berada di dalam string (mis.
 * "https://…"), dan membuangnya akan ikut memakan kode sesudahnya.
 */
function tanpaKomentar(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((b) => (/^\s*(\/\/|\*)/.test(b) ? "" : b))
    .join("\n");
}

/** Cast yang membuat Postgres memulangkan angka, bukan string. */
const CAST = /::\s*(int|int2|int4|int8|integer|bigint|smallint|float4|float8|real|double precision)\b/;

/**
 * Ekspresi yang SENGAJA tanpa cast, beserta alasannya.
 *
 * Bukan kuburan: tiap barisnya harus tetap cocok dengan sumbernya — uji di
 * bawah menuntutnya, jadi ekspresi yang berubah tak bisa membawa
 * pengecualiannya ikut serta diam-diam.
 */
const DIKECUALIKAN: { potongan: string; kenapa: string }[] = [
  {
    potongan: "GREATEST(0, EXTRACT(EPOCH FROM (",
    kenapa:
      "TIDAK PERNAH dipilih mentah — hanya disisipkan ke ekspresi lain yang " +
      "sudah ber-`::int` (ROUND(AVG(…))::int, MIN(…)::int, PERCENTILE_CONT). " +
      "Dan mencastnya ke float8 BUKAN netral seperti yang lain: `ROUND` atas " +
      "numeric membulatkan setengah MENJAUHI nol, atas float8 membulatkan ke " +
      "genap terdekat. Selisihnya satu detik pada seri, tapi ia perubahan " +
      "perilaku — dan uji ini ada justru untuk melarang perubahan diam-diam.",
  },
];

describe("sql<number> harus benar-benar memulangkan number", () => {
  const berkas = berkasTs(SRC);
  const EKSPRESI = /sql<number(?:\s*\|\s*null)?>`([^`]*)`/g;

  const semua: { file: string; baris: number; ekspresi: string }[] = [];
  for (const p of berkas) {
    const isi = tanpaKomentar(readFileSync(p, "utf8"));
    for (const m of isi.matchAll(EKSPRESI)) {
      semua.push({
        file: p.replace(SRC + "/", ""),
        baris: isi.slice(0, m.index).split("\n").length,
        ekspresi: m[1],
      });
    }
  }

  it("premis: pemindainya benar-benar menemukan ekspresinya", () => {
    // Tanpa ini, regex yang tak lagi cocok (atau jalur yang salah) membuat
    // seluruh uji hijau tanpa memeriksa satu ekspresi pun.
    expect(semua.length).toBeGreaterThan(50);
    expect(semua.some((e) => CAST.test(e.ekspresi))).toBe(true);
  });

  it("INTI: tiap ekspresi bercast, kecuali yang disebut namanya berikut alasannya", () => {
    const telanjang = semua
      .filter((e) => !CAST.test(e.ekspresi))
      .filter((e) => !DIKECUALIKAN.some((d) => e.ekspresi.includes(d.potongan)))
      .map((e) => `${e.file}:${e.baris}  ${e.ekspresi}`);
    expect(
      telanjang,
      "ekspresi ini bertipe `number` di TypeScript tapi tiba sebagai STRING " +
        "saat dijalankan. Tambahkan `::float8` (uang/qty) atau `::int` " +
        "(cacah) di ujungnya — keduanya tak mengubah nilainya, hanya tipenya. " +
        "Kalau memang sengaja telanjang, daftarkan di DIKECUALIKAN dengan " +
        "alasannya",
    ).toEqual([]);
  });

  it("daftar pengecualiannya masih cocok dengan sumbernya — bukan judul basi", () => {
    // Pengecualian yang ekspresinya sudah berubah/hilang diam-diam melebar:
    // ekspresi lain yang kelak lupa dicast tak akan ketahuan.
    for (const d of DIKECUALIKAN) {
      expect(
        semua.some((e) => e.ekspresi.includes(d.potongan)),
        `pengecualian tak lagi cocok dengan sumber mana pun: ${d.potongan}`,
      ).toBe(true);
    }
  });

  it("PASANGAN: pemindainya bisa MENUDUH", () => {
    /*
     * Tanpa ini, "daftar pelanggar kosong" juga hijau seandainya regex CAST
     * kelak cocok dengan apa pun — hijau yang tak menjaga apa-apa.
     */
    expect(CAST.test("COALESCE(SUM(x), 0)")).toBe(false);
    expect(CAST.test("COALESCE(SUM(x), 0)::float8")).toBe(true);
    expect(CAST.test("count(*)::int")).toBe(true);
    // …dan bukan cocok karena kata "int" muncul di mana saja
    expect(CAST.test("SUM(interval_detik)")).toBe(false);
    expect(CAST.test("SUM(x)::interval")).toBe(false);
  });

  it("PASANGAN: pembuang komentar tidak ikut memakan KODE", () => {
    /*
     * Membuang komentar itu yang membuat uji ini berhenti menuduh prosa —
     * tapi pembuang yang terlalu rakus akan menelan ekspresi sungguhan dan
     * membuat daftar pelanggar kosong karena tak ada yang tersisa dibaca.
     */
    const contoh = [
      "// sql<number>`SUM(x)` di komentar baris",
      " * sql<number>`SUM(y)` di dalam blok jsdoc",
      "const a = sql<number>`SUM(z)`; // ini kode, komentarnya di belakang",
      'const url = "https://contoh/x"; const b = sql<number>`SUM(w)`;',
    ].join("\n");
    const bersih = tanpaKomentar(contoh);
    expect(bersih).not.toContain("SUM(x)");
    expect(bersih).not.toContain("SUM(y)");
    expect(bersih, "kode dengan komentar di belakangnya ikut termakan").toContain("SUM(z)");
    expect(bersih, "baris ber-'//' di dalam string ikut termakan").toContain("SUM(w)");
    // …dan blok /* */ memang terbuang seluruhnya
    expect(tanpaKomentar("/* sql<number>`SUM(q)` */ const c = 1;")).not.toContain("SUM(q)");
  });
});

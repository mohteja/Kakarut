import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * SATU ROUND-TRIP PER BARIS DI DALAM TRANSAKSI — RATCHET, bukan larangan.
 *
 * `db` adalah `pg.Pool` bawaan: **10 koneksi**, penunggu antre SELAMANYA.
 * `db.transaction()` memegang satu koneksi sampai commit, jadi loop yang
 * menjalankan satu kueri per baris di dalamnya menahan koneksi itu selama N
 * round-trip BERURUTAN. Bila N ditentukan pengirim, ia jadi tombol berhenti
 * untuk seluruh server.
 *
 * Terukur pada `PUT /menu/urutan` — rute yang komentarnya sendiri menyebut
 * "boleh diakses semua peran termasuk kasir":
 *
 *     10 permintaan serentak       GET /menu
 *     N=28.000 (tanpa batas)       20,07 dtk   ← 2.200× dari senggang
 *     N=2.000  (sesudah dibatasi)   1,47 dtk
 *     N=2.000  (sesudah satu SQL)   0,012 dtk  ← tak terbedakan dari senggang
 *
 * Dan pada tingkat kuerinya sendiri, 2.000 baris terhadap Postgres yang sama:
 * 289 ms berurutan vs **11 ms** satu pernyataan `unnest` — 26×.
 *
 * KENAPA RATCHET DAN BUKAN NOL. Dari 33 situs yang ada, hanya sebagian kecil
 * yang N-nya ditentukan pengirim; sisanya berputar atas data internal yang
 * jumlahnya sudah terbatas dengan sendirinya (jumlah cabang, jumlah hari
 * tertunggak, baris satu faktur). Menuntut nol berarti menulis ulang tiga
 * puluh tempat demi bahaya yang tak ada di kebanyakan darinya — dan uji yang
 * menuntut pekerjaan tanpa alasan akan dilonggarkan orang, bukan dipatuhi.
 *
 * Yang dijaga: JUMLAHNYA TAK BOLEH TUMBUH. Situs baru harus memikirkan
 * bentuknya lebih dulu — dan bila memang perlu, menaikkan angka DASAR di bawah
 * dengan alasan di pesan commit, bukan diam-diam.
 */
const SRC = fileURLToPath(new URL("../src", import.meta.url));

/**
 * `(?<![.\w])` WAJIB di depan `for`/`while`.
 *
 * Tanpa itu `.for("update")` — kunci baris drizzle, bukan perulangan sama
 * sekali — ikut tertangkap. Versi pertama sapuan ini begitu, dan ia "menemukan"
 * tiga loop di dalam `createSale` yang sebenarnya tak ada. Penjaga yang menuduh
 * kode benar merusak sama parahnya dengan yang melewatkan: ia mengajari orang
 * mengabaikan warna merahnya.
 */
const LOOP = /(?<![.\w])for\s+await\s*\(|(?<![.\w])for\s*\(|(?<![.\w])while\s*\(|\.forEach\s*\(|\.map\s*\(\s*async/g;
const KUERI_TX = /await\s+tx\s*\.\s*\w+/;

/**
 * Jumlah situs saat ratchet ini dipasang, sesudah `PUT /menu/urutan` dan
 * `PUT /meja/tata-letak` ditulis ulang jadi satu pernyataan.
 *
 * Turun boleh (dan bagus). Naik berarti ada yang menambahkan loop per-baris
 * baru di dalam transaksi — pikirkan `unnest` lebih dulu.
 */
const DASAR = 31;

function berkasTs(dir: string): string[] {
  const keluar: string[] = [];
  for (const nama of readdirSync(dir)) {
    const p = join(dir, nama);
    if (statSync(p).isDirectory()) keluar.push(...berkasTs(p));
    else if (nama.endsWith(".ts")) keluar.push(p);
  }
  return keluar;
}

function isiSeimbang(s: string, i: number): string {
  let dalam = 0;
  for (let j = i; j < s.length; j += 1) {
    if (s[j] === "(") dalam += 1;
    else if (s[j] === ")") {
      dalam -= 1;
      if (dalam === 0) return s.slice(i + 1, j);
    }
  }
  return "";
}

function situs(): string[] {
  const keluar: string[] = [];
  for (const p of berkasTs(SRC)) {
    const s = readFileSync(p, "utf8");
    for (const m of s.matchAll(/\.transaction\s*\(/g)) {
      const isi = isiSeimbang(s, m.index! + m[0].length - 1);
      if (!isi) continue;
      const baris = s.slice(0, m.index!).split("\n").length;
      for (const L of isi.matchAll(LOOP)) {
        if (KUERI_TX.test(isi.slice(L.index! + L[0].length, L.index! + L[0].length + 1200))) {
          keluar.push(`${p.slice(SRC.length + 1)}:${baris}`);
        }
      }
    }
  }
  return keluar;
}

describe("round-trip per baris di dalam transaksi tak boleh bertambah", () => {
  const daftar = situs();

  it("premis: pemindainya benar-benar membaca badan transaksi", () => {
    // Tanpa ini, regex yang tak lagi cocok membuat ratchetnya hijau dengan
    // hitungan nol — yaitu izin terbuka, bukan penjagaan.
    expect(daftar.length).toBeGreaterThan(10);
  });

  it("INTI: jumlahnya tidak melebihi DASAR", () => {
    expect(
      daftar.length,
      `ada situs loop-per-baris BARU di dalam transaksi. Satu kueri per baris ` +
        `menahan 1 dari 10 koneksi kolam selama N round-trip berurutan — diukur ` +
        `20 detik untuk SELURUH server sebelum dibatasi. Pertimbangkan satu ` +
        `pernyataan ber-unnest (289 ms → 11 ms untuk 2.000 baris), atau naikkan ` +
        `DASAR dengan alasan di pesan commit.\n\nsitus:\n${daftar.join("\n")}`,
    ).toBeLessThanOrEqual(DASAR);
  });

  it("dua rute yang sudah ditulis ulang tak boleh kembali jadi loop", () => {
    // Source-pin, dan disebut apa adanya: ia menjaga BENTUKNYA, bukan
    // perilakunya. Yang menjaga perilakunya §231 di verify-api, yang benar-
    // benar mengurutkan 81 menu lalu membacanya lagi.
    for (const [f, rute] of [
      ["modules/menu/routes.ts", "PUT /menu/urutan"],
      ["modules/meja/routes.ts", "PUT /meja/tata-letak"],
    ] as const) {
      const s = readFileSync(join(SRC, f), "utf8");
      expect(s, `${rute} kehilangan bentuk satu-pernyataannya`).toContain("unnest(");
      expect(s, `${rute}: larik harus dibungkus sql.param, kalau tidak drizzle ` +
        `memecahnya jadi tuple dan Postgres membalas "cannot cast type record"`).toContain(
        "sql.param(",
      );
    }
  });

  it("PASANGAN: pemindainya bisa MENUDUH, dan tak menuduh `.for(` drizzle", () => {
    const cocok = (kode: string) => [...kode.matchAll(LOOP)].length;
    expect(cocok("for (const x of items) {")).toBe(1);
    expect(cocok("for await (const x of it) {")).toBe(1);
    expect(cocok("rows.forEach(async (r) => {")).toBe(1);
    // …dan kunci baris drizzle BUKAN perulangan
    expect(cocok('.for("update")')).toBe(0);
    expect(cocok('.for("share");')).toBe(0);
    expect(cocok("await tx.select().from(x).for('update')")).toBe(0);
  });
});

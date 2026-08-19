import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/**
 * DAFTAR BERPAGINASI WAJIB PUNYA PEMUTUS SERI.
 *
 * `ORDER BY x` pada baris yang nilai `x`-nya SAMA tidak menentukan urutan
 * apa pun — Postgres bebas memulangkannya dalam urutan mana saja, dan urutan
 * itu boleh berbeda antar-query. Dipadu `LIMIT`/`OFFSET`, akibatnya bukan
 * sekadar tampilan yang goyah:
 *
 *   - dua baris yang seri bisa sama-sama muncul di halaman 1 DAN halaman 2;
 *   - sementara baris ketiga TAK MUNCUL DI HALAMAN MANA PUN.
 *
 * Baris yang hilang itu tak meninggalkan gejala. Yang membacanya cuma melihat
 * daftar yang "sepertinya kurang", dan tak ada cara menebak dari mana.
 *
 * SERINYA BUKAN KEBETULAN. Dua sumber yang sudah ada di repo ini:
 *
 *   1. Aksi massal menulis SATU timestamp ke banyak baris sekaligus.
 *      "Selesaikan semua" di papan pesanan memakai satu `new Date()` untuk
 *      seluruh baris kartu — jadi tiap pemakaian melahirkan sekelompok baris
 *      berwaktu identik. Terukur di data uji: ada kelompok seri.
 *   2. `now()` di Postgres STABIL PER TRANSAKSI, jadi seluruh baris yang lahir
 *      dalam satu transaksi berbagi `created_at` yang persis sama.
 *
 * Konvensinya sudah tertulis di `app.ts` (catatan ETag): setiap query daftar
 * memakai ORDER BY dengan pemutus seri. Uji ini menegakkannya untuk yang
 * BERPAGINASI, tempat akibatnya paling mahal.
 */
const AKAR = fileURLToPath(new URL("../src", import.meta.url));

function berkasTs(dir: string, keluar: string[] = []): string[] {
  for (const nama of readdirSync(dir)) {
    const p = join(dir, nama);
    if (statSync(p).isDirectory()) berkasTs(p, keluar);
    else if (nama.endsWith(".ts")) keluar.push(p.slice(AKAR.length + 1));
  }
  return keluar;
}

/** `.orderBy(...)` yang diikuti `.offset(...)` dalam rangkaian yang sama. */
function urutBerpaginasi(rel: string) {
  const isi = readFileSync(join(AKAR, rel), "utf8");
  const temuan: { baris: number; kunci: number }[] = [];
  for (const m of isi.matchAll(/\.orderBy\(/g)) {
    const blok = isi.slice(m.index!, m.index! + 500);
    if (!blok.includes(".offset(")) continue;
    // Bagian di dalam orderBy: sampai `.limit(` / `.offset(` yang mengikutinya.
    const potong = Math.min(
      ...[".limit(", ".offset("].map((t) => (blok.indexOf(t) < 0 ? 1e9 : blok.indexOf(t))),
    );
    const ob = blok.slice(0, potong);
    // Koma di KEDALAMAN ARGUMEN orderBy = pemisah antar-kunci urut. Koma di
    // dalam `desc(sql\`…\`)` tak dihitung, jadi kedalamannya ditelusuri.
    let dalam = 0;
    let kunci = 1;
    for (let i = ".orderBy(".length; i < ob.length; i++) {
      const c = ob[i];
      if (c === "(") dalam++;
      else if (c === ")") dalam--;
      else if (c === "," && dalam === 0) kunci++;
    }
    temuan.push({ baris: isi.slice(0, m.index!).split("\n").length, kunci });
  }
  return temuan;
}

describe("daftar berpaginasi: ORDER BY wajib berpemutus seri", () => {
  const semua = berkasTs(AKAR);

  it("menemukan berkas sumber (bukan lolos karena kosong)", () => {
    expect(semua.length).toBeGreaterThan(30);
  });

  it("penyapunya benar-benar menemukan query berpaginasi", () => {
    // Tanpa ini, pola yang tak lagi cocok membuat uji di bawah hijau selamanya
    // tanpa memeriksa satu query pun.
    const jumlah = semua.reduce((a, f) => a + urutBerpaginasi(f).length, 0);
    expect(jumlah).toBeGreaterThanOrEqual(2);
  });

  it("tak ada ORDER BY berkunci-tunggal pada query ber-OFFSET", () => {
    const pelanggar = semua.flatMap((f) =>
      urutBerpaginasi(f)
        .filter((t) => t.kunci < 2)
        .map((t) => `${f}:${t.baris}`),
    );
    expect(
      pelanggar,
      "tambahkan kunci kedua yang UNIK (mis. `desc(tabel.id)`) — tanpa itu " +
        "baris yang waktunya seri bisa muncul dua kali di halaman berbeda " +
        "sementara baris lain tak muncul sama sekali",
    ).toEqual([]);
  });
});

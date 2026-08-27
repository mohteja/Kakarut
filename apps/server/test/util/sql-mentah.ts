import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * PEMINDAI SQL MENTAH — rumah bersama.
 *
 * Primitif ini lahir di `daftar-tanpa-langit-langit.test.ts` untuk vena "SQL
 * mentah: populasi yang tak pernah disapu aturan mana pun" (2026-08-24), dan
 * hidup privat di sana. Vena bendera-hapus (2026-08-26) butuh pemindai yang
 * sama persis: rantai drizzle punya rumahnya di `kueri-terkurung.ts`, SQL
 * mentah belum punya. Dipindah — bukan disalin — karena dua salinan pengurai
 * template adalah kelas yang sudah dua kali dibayar repo ini.
 */
export const SRC = fileURLToPath(new URL("../../src", import.meta.url));

export function berkasTs(dir: string): string[] {
  const keluar: string[] = [];
  for (const nama of readdirSync(dir)) {
    const p = join(dir, nama);
    if (statSync(p).isDirectory()) keluar.push(...berkasTs(p));
    else if (nama.endsWith(".ts")) keluar.push(p);
  }
  return keluar;
}

/** Seluruh berkas `src` sebagai `{nama, isi}` — bentuk yang dipakai tiap sapuan. */
export function sumberServer(): { nama: string; isi: string }[] {
  return berkasTs(SRC).map((p) => ({
    nama: p.slice(SRC.length + 1),
    isi: readFileSync(p, "utf8"),
  }));
}

/**
 * Rantai sesudah `.from(...)` sampai ujung pernyataannya.
 *
 * BERHENTI DI `,` KEDALAMAN NOL, BUKAN CUMA DI `;`.
 *
 * Dua kueri berdampingan di dalam `Promise.all([a, b])` tak pernah menurunkan
 * kedalaman kurung ke nol sampai `]);` di ujungnya. Tanpa berhenti di koma
 * pemisahnya, ekor kueri PERTAMA menelan seluruh kueri kedua — dan `.limit()`
 * milik yang kedua memaafkan yang pertama.
 *
 * Bukan kemungkinan teoretis: bentuk itulah yang dipakai kartu Riwayat Harga,
 * dan versi pertama penjaga langit-langit menghitungnya DUA LEBIH SEDIKIT dari
 * yang sebenarnya, tepat pada dua kueri tanpa batas yang baru ditambahkan.
 *
 * Koma di dalam `and(a, b)` atau `.select({ x: 1, y: 2 })` selalu berada di
 * kedalaman > 0, jadi tak ikut memotong.
 */
export function ekorPernyataan(s: string, mulai: number, maks = 4000): string {
  let ekor = "";
  let dalam = 0;
  for (let j = mulai; j < s.length && ekor.length < maks; j += 1) {
    const c = s[j];
    if (c === "(") dalam += 1;
    else if (c === ")") dalam -= 1;
    else if ((c === ";" || c === ",") && dalam <= 0) break;
    ekor += c;
  }
  return ekor;
}

/**
 * Awal PERNYATAAN yang memuat posisi `i`.
 *
 * Versi pertama cuma mengambil 500 aksara ke belakang, dan itu bukan sekadar
 * jelek dibaca: potongan tetangga ikut terbaca sebagai bagian kuerinya, jadi
 * `isNull(...)` milik kueri SEBELUMNYA bisa memaafkan kueri yang telanjang.
 *
 * Versi kedua berhenti di `{` mana pun — dan itu MEMOTONG DAFTAR SELECT-nya
 * sendiri: `db.select({ archivedAt: memberships.archivedAt }).from(memberships)`
 * jadi terbaca telanjang padahal benderanya ada di kepala kueri. Kurungnya
 * karena itu diseimbangkan MUNDUR: hanya pembuka yang TAK berpasangan yang
 * jadi batas.
 */
export function awalPernyataan(s: string, i: number): number {
  let d = 0;
  for (let j = i - 1; j >= 0; j -= 1) {
    const c = s[j];
    if (c === ")" || c === "]" || c === "}") d += 1;
    else if (c === "(" || c === "[" || c === "{") {
      if (d === 0) return j + 1; // pembuka tak berpasangan = batas pernyataan
      d -= 1;
    } else if (d === 0 && c === ";") return j + 1;
  }
  return 0;
}

/** Akhir template literal yang dimulai TEPAT SESUDAH backtick pembukanya. */
export function akhirTemplate(s: string, mulai: number): number {
  let j = mulai;
  while (j < s.length) {
    const c = s[j];
    if (c === "\\") {
      j += 2;
      continue;
    }
    if (c === "$" && s[j + 1] === "{") {
      let dalam = 1;
      j += 2;
      while (j < s.length && dalam > 0) {
        const ch = s[j];
        if (ch === "\\") {
          j += 2;
          continue;
        }
        if (ch === "{") dalam += 1;
        else if (ch === "}") dalam -= 1;
        else if (ch === "`") j = akhirTemplate(s, j + 1);
        j += 1;
      }
      continue;
    }
    if (c === "`") break;
    j += 1;
  }
  return j;
}

/** Tiap template `sql`…`` / `sql<T>`…`` beserta posisinya. Menghormati `${}` bersarang. */
export function templateSql(s: string): { pos: number; isi: string }[] {
  const keluar: { pos: number; isi: string }[] = [];
  for (const m of s.matchAll(/\bsql(?:<[^`>]*>)?\s*`/g)) {
    const awal = m.index! + m[0].length;
    keluar.push({ pos: m.index!, isi: s.slice(awal, akhirTemplate(s, awal)) });
  }
  return keluar;
}

/**
 * Kosongkan ISI tiap kurung berkedalaman ≥ 1, kurungnya sendiri dipertahankan.
 *
 * Dengan begini `SUM(pr.qty)` tetap terbaca agregat (`SUM()`), sementara
 * `(SELECT COUNT(*) FROM sales …)` menjadi `()` — subkueri tak lagi bisa
 * menyamar sebagai kueri luar, ke dua arah sekaligus.
 */
export function tanpaSubkueri(s: string): string {
  let dalam = 0;
  let keluar = "";
  for (const c of s) {
    if (c === "(") {
      dalam += 1;
      keluar += c;
    } else if (c === ")") {
      dalam -= 1;
      keluar += c;
    } else keluar += dalam > 0 ? " " : c;
  }
  return keluar;
}

/** Isi template `sql` pertama di dalam definisi `nama` pada berkas yang sama. */
export function badanPembantu(s: string, nama: string): string {
  const def = new RegExp(`(?:function\\s+${nama}\\b|const\\s+${nama}\\s*[=:])`).exec(s);
  if (!def) return "";
  const t = templateSql(s.slice(def.index, def.index + 4000))[0];
  return t ? t.isi : "";
}

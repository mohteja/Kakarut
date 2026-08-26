import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { butaKomentar } from "../../src/scripts/buta-komentar";

/**
 * SAPUAN HTML DIRAKIT TANGAN — instrumen bersama untuk ketiga akar.
 *
 * Vena "HTML surat dirakit dari data pengguna" (2026-08-26) menemukan server
 * merakit badan surat dari nama perusahaan & nama pengguna tanpa satu pun
 * pelolos, sementara web sudah punya `esc()` dan memakainya konsisten. Berkas
 * ini yang membuat literal HTML ber-interpolasi BARU menagih keputusan, bukan
 * lewat diam-diam.
 */
export const AKAR: Record<string, string> = {
  server: fileURLToPath(new URL("../../src", import.meta.url)),
  shared: fileURLToPath(new URL("../../../../packages/shared/src", import.meta.url)),
  web: fileURLToPath(new URL("../../../web/src", import.meta.url)),
};

export type Templat = {
  akar: string;
  berkas: string;
  baris: number;
  isi: string;
  sisip: string[];
};

function berkasSumber(d: string, out: string[] = []): string[] {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) berkasSumber(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

/** Indeks `}` penutup untuk `{` di `mulai`, melewati kutip & templat bersarang. */
function tutupKurawal(s: string, mulai: number): number {
  let i = mulai + 1;
  let d = 1;
  while (i < s.length) {
    const c = s[i];
    if (c === "\\") { i += 2; continue; }
    if (c === "'" || c === '"') { i = lewatiKutip(s, i); continue; }
    if (c === "`") { i = lewatiTemplat(s, i); continue; }
    if (c === "/" && mulaiRegex(s, i)) { i = lewatiRegex(s, i); continue; }
    if (c === "{") d++;
    else if (c === "}") { d--; if (d === 0) return i; }
    i++;
  }
  return s.length;
}

/**
 * Indeks TEPAT SESUDAH `/` penutup sebuah literal regex.
 *
 * Tanpa ini pemindai kabur: `${name.replace(/"/g, '""')}` di `lib/backup.ts`
 * membuat `"` di DALAM regex dibaca sebagai pembuka string, kurawal penutupnya
 * meleset, dan satu "templat" menelan 120 baris berkas berikutnya.
 */
function lewatiRegex(s: string, mulai: number): number {
  let i = mulai + 1;
  let kelas = false;
  while (i < s.length) {
    const c = s[i];
    if (c === "\\") { i += 2; continue; }
    if (c === "\n") return mulai + 1; // bukan regex — ternyata pembagian
    if (c === "[") kelas = true;
    else if (c === "]") kelas = false;
    else if (c === "/" && !kelas) {
      i++;
      while (i < s.length && /[a-z]/.test(s[i])) i++; // bendera
      return i;
    }
    i++;
  }
  return s.length;
}

/** `/` di posisi ini membuka regex, bukan pembagian? */
function mulaiRegex(s: string, i: number): boolean {
  let j = i - 1;
  while (j >= 0 && /\s/.test(s[j])) j--;
  if (j < 0) return true;
  if ("(,=:[!&|?{};+-*%^~<>".includes(s[j])) return true;
  const kata = s.slice(Math.max(0, j - 9), j + 1).match(/[A-Za-z]+$/)?.[0];
  return kata != null && ["return", "typeof", "case", "in", "of", "do", "else", "yield", "await"].includes(kata);
}

/** Indeks TEPAT SESUDAH kutip penutup untuk kutip di `mulai`. */
function lewatiKutip(s: string, mulai: number): number {
  const q = s[mulai];
  let i = mulai + 1;
  while (i < s.length) {
    if (s[i] === "\\") { i += 2; continue; }
    if (s[i] === q) return i + 1;
    if (s[i] === "\n") return i; // kutip tak tertutup (mis. apostrof di komentar sisa)
    i++;
  }
  return s.length;
}

/** Indeks TEPAT SESUDAH backtick penutup untuk templat di `mulai`. */
function lewatiTemplat(s: string, mulai: number): number {
  let i = mulai + 1;
  while (i < s.length) {
    if (s[i] === "\\") { i += 2; continue; }
    if (s[i] === "`") return i + 1;
    if (s[i] === "$" && s[i + 1] === "{") { i = tutupKurawal(s, i + 1) + 1; continue; }
    i++;
  }
  return s.length;
}

/** Semua templat literal (termasuk yang bersarang di dalam `${…}`). */
function templatDi(s: string, mulai: number, akhir: number, keluar: [number, number][]): void {
  let i = mulai;
  while (i < akhir) {
    const c = s[i];
    if (c === "\\") { i += 2; continue; }
    if (c === "'" || c === '"') { i = lewatiKutip(s, i); continue; }
    if (c === "/" && mulaiRegex(s, i)) { i = lewatiRegex(s, i); continue; }
    if (c === "`") {
      const j = lewatiTemplat(s, i);
      keluar.push([i, j]);
      // sisipannya disapu juga — templat bersarang punya vonisnya sendiri
      let k = i + 1;
      while (k < j - 1) {
        if (s[k] === "\\") { k += 2; continue; }
        if (s[k] === "$" && s[k + 1] === "{") {
          const t = tutupKurawal(s, k + 1);
          templatDi(s, k + 2, t, keluar);
          k = t + 1;
          continue;
        }
        k++;
      }
      i = j;
      continue;
    }
    i++;
  }
}

function sisipanDari(t: string): string[] {
  const out: string[] = [];
  let i = 1;
  while (i < t.length - 1) {
    if (t[i] === "\\") { i += 2; continue; }
    if (t[i] === "$" && t[i + 1] === "{") {
      const j = tutupKurawal(t, i + 1);
      out.push(t.slice(i + 2, j));
      i = j + 1;
      continue;
    }
    i++;
  }
  return out;
}

/** Literal yang memuat tag HTML (bukan sekadar `<` aritmetika). */
const BER_TAG = /<\/?[a-zA-Z][\w-]*[\s>/]|<!doctype/i;

/** Semua berkas sumber satu akar, relatif terhadap akarnya. */
export function daftarBerkas(akar: keyof typeof AKAR | string): string[] {
  const dir = AKAR[akar];
  return berkasSumber(dir).map((p) => p.slice(dir.length + 1));
}

/**
 * Sapuan atas SATU teks sumber. Dipisah supaya bukti merah bisa memberi makan
 * isi berkas sungguhan yang pelolosnya dicabut — detektor diuji dengan bahan
 * yang sama persis dengan yang dijaganya, bukan dengan contoh buatan.
 */
export function sapuTeks(akar: string, berkas: string, teks: string): Templat[] {
  const s = butaKomentar(teks);
  const span: [number, number][] = [];
  templatDi(s, 0, s.length, span);
  const out: Templat[] = [];
  for (const [a, b] of span) {
    const isi = s.slice(a, b);
    const sisip = sisipanDari(isi);
    if (sisip.length === 0 || !BER_TAG.test(isi)) continue;
    out.push({ akar, berkas, baris: s.slice(0, a).split("\n").length, isi, sisip });
  }
  return out;
}

/** Semua templat literal ber-tag-HTML DAN ber-interpolasi, di seluruh akar. */
export function templatHtml(): Templat[] {
  const out: Templat[] = [];
  for (const [akar, dir] of Object.entries(AKAR)) {
    for (const p of berkasSumber(dir)) {
      out.push(...sapuTeks(akar, p.slice(dir.length + 1), readFileSync(p, "utf8")));
    }
  }
  return out;
}

/** Sisipan yang TIDAK melewati pelolos, per templat. */
export function kotor(t: Templat): string[] {
  return t.sisip.filter((e) => !PELOLOS.test(e));
}

/** Sisipan dianggap dilolos bila nilainya melewati pelolos bersama. */
export const PELOLOS = /\b(lolosHtml|lolosAtribut|esc)\s*\(/;

export function melolos(t: Templat): boolean {
  return t.sisip.every((e) => PELOLOS.test(e));
}

export function kunci(t: Templat): string {
  return `${t.akar}:${t.berkas}`;
}
